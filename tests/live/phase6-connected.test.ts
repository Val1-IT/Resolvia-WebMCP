import { exec } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

import { Firestore } from "@google-cloud/firestore";
import { describe, expect, it } from "vitest";

import { analyzeCase } from "@/src/application/agents/analyze-case";
import { evaluateClaimStatus } from "@/src/domain/claims/model";
import { GeminiAdkAgentService } from "@/src/infrastructure/agent/gemini-adk-agent-service";
import { getGeminiConfig } from "@/src/infrastructure/agent/gemini-config";
import { buildTruthGraph } from "@/src/domain/truth-graph/build-truth-graph";
import { FirestoreResolutionStore } from "@/src/infrastructure/google/firestore-resolution-store";
import { getDemoProviderSecret } from "@/src/infrastructure/google/demo-provider-secret";
import { resetConnectedRv1028 } from "@/src/infrastructure/google/reset-connected-rv1028";
import { signDemoProviderRequest, type DemoProviderRequest } from "@/src/infrastructure/providers/demo/demo-provider-adapter";
import { buildCaseWorkspaceViewModel } from "@/src/ui/case-workspace/model";

const execAsync = promisify(exec);
const liveEnabled = process.env.RUN_PHASE6_CONNECTED_SMOKE === "1";
const liveGeminiEnabled = liveEnabled && process.env.RUN_PHASE6_CONNECTED_GEMINI === "1" && Boolean(process.env.GEMINI_API_KEY?.trim());
const required = ["GOOGLE_CLOUD_PROJECT", "RESOLVIA_WEB_URL", "RESOLVIA_FIRESTORE_DATABASE"] as const;

type LiveConfig = {
  projectId: string;
  webUrl: string;
  databaseId: string;
};

describe.skipIf(!liveEnabled)("Task 6.7 connected RV-1028 proof", () => {
  it("commits one signed Demo Provider event through Cloud Run, Pub/Sub, and Firestore", async () => {
    const config = liveConfig();
    const firestore = new Firestore({ projectId: config.projectId, databaseId: config.databaseId });
    const store = new FirestoreResolutionStore(firestore, "resolvia");
    const before = await resetConnectedRv1028({ firestore, store, collectionPrefix: "resolvia", runtimeMode: "CONNECTED", confirmed: true });
    expect(before.caseRecord).toMatchObject({ state: "INVESTIGATING", version: 4 });
    expect(before.claims.find((claim) => claim.id === "claim-refund-processed") && evaluateClaimStatus(before.claims.find((claim) => claim.id === "claim-refund-processed")!)).toBe("UNVERIFIED");
    expect(before.evidence).toMatchObject([{ verificationLevel: "AUTHENTICATED_SOURCE" }]);
    expect(before.providerTransactions).toEqual([]);
    expect(before.agentRuns).toMatchObject([{ basedOnCaseVersion: 4, outcome: "FAILED_CONFIGURATION" }]);

    const secret = await getDemoProviderSecret(config.projectId);
    const eventId = `g7_${crypto.randomUUID().replaceAll("-", "")}`;
    const providerObjectId = `demo_refund_${crypto.randomUUID().replaceAll("-", "")}`;
    const accepted = await postSigned(config, secret, demoPayload(eventId, providerObjectId));
    expect(accepted.status).toBe(202);

    const after = await waitForVersion(store, 5, 60_000);
    expect(after.caseRecord).toMatchObject({ state: "INVESTIGATING", version: 5 });
    expect(after.events.filter((event) => event.id === `resolvia_demo_provider:${eventId}`)).toHaveLength(1);
    expect(after.evidence.filter((record) => record.sourceProvider === "resolvia_demo_provider")).toMatchObject([{ verificationLevel: "DEMO_PROVIDER_VERIFIED" }]);
    expect(after.providerTransactions).toMatchObject([{ provider: "resolvia_demo_provider", providerObjectId, caseId: "case-rv-1028" }]);
    expect(after.auditRecords.filter((record) => record.triggeringEventId === `resolvia_demo_provider:${eventId}`)).toHaveLength(1);
    expect(after.claims.find((claim) => claim.id === "claim-refund-processed") && evaluateClaimStatus(after.claims.find((claim) => claim.id === "claim-refund-processed")!)).toBe("UNVERIFIED");
    const graph = buildTruthGraph(after);
    expect(graph.nodes).toContainEqual(expect.objectContaining({ id: "verification-gap:claim-refund-processed", label: "Outcome verification remains open", authoritative: false, placeholder: true }));
    expect(buildCaseWorkspaceViewModel(after).agentAnalysis).toMatchObject({ basedOnCaseVersion: 4, freshness: "STALE" });

    const replay = await postSigned(config, secret, demoPayload(eventId, providerObjectId));
    expect(replay.status).toBe(202);
    await delay(5_000);
    const duplicate = await store.loadCaseBundle("case-rv-1028");
    expect(duplicate?.caseRecord.version).toBe(5);
    expect(duplicate?.events.filter((event) => event.id === `resolvia_demo_provider:${eventId}`)).toHaveLength(1);
    expect(duplicate?.evidence.filter((record) => record.sourceProvider === "resolvia_demo_provider")).toHaveLength(1);
    expect(duplicate?.providerTransactions).toHaveLength(1);
    expect(duplicate?.auditRecords.filter((record) => record.triggeringEventId === `resolvia_demo_provider:${eventId}`)).toHaveLength(1);

    const invalid = await postSigned(config, secret, demoPayload(`g7_bad_${crypto.randomUUID().replaceAll("-", "")}`, `demo_refund_bad_${crypto.randomUUID().replaceAll("-", "")}`), { invalidSignature: true });
    expect(invalid.status).toBe(400);
    const stale = await postSigned(config, secret, demoPayload(`g7_stale_${crypto.randomUUID().replaceAll("-", "")}`, `demo_refund_stale_${crypto.randomUUID().replaceAll("-", "")}`, new Date(Date.now() - 600_000).toISOString()));
    expect(stale.status).toBe(400);
    const crossCase = await postSigned(config, secret, { ...demoPayload(`g7_cross_${crypto.randomUUID().replaceAll("-", "")}`, `demo_refund_cross_${crypto.randomUUID().replaceAll("-", "")}`), caseId: "case-other" });
    expect(crossCase.status).toBe(202);
    await delay(2_000);
    const final = await store.loadCaseBundle("case-rv-1028");
    expect(final?.caseRecord.version).toBe(5);
    expect(final?.providerTransactions).toHaveLength(1);
  }, 95_000);

  it.skipIf(!liveGeminiEnabled)("records a real Gemini v5 analysis without changing connected authority", async () => {
    const config = liveConfig();
    const firestore = new Firestore({ projectId: config.projectId, databaseId: config.databaseId });
    const store = new FirestoreResolutionStore(firestore, "resolvia");
    const before = await store.loadCaseBundle("case-rv-1028");
    expect(before?.caseRecord.version).toBe(5);

    const result = await analyzeCase(
      store,
      new GeminiAdkAgentService(getGeminiConfig()),
      "case-rv-1028",
      {
        createRunId: () => `agent-run-g7-v5-${crypto.randomUUID()}`,
        now: () => new Date().toISOString(),
      },
    );
    const after = await store.loadCaseBundle("case-rv-1028");

    expect(result).toMatchObject({ kind: "RECORDED", run: { basedOnCaseVersion: 5, validationErrors: [] } });
    if (result.kind !== "RECORDED") throw new Error("Expected a recorded Gemini AgentRun.");
    expect(["SUCCEEDED_VALID", "FAILED_MALFORMED_OUTPUT", "FAILED_NETWORK"]).toContain(result.run.outcome);
    expect(authoritative(after)).toEqual(authoritative(before));
    expect(after?.agentRuns.find((run) => run.id === result.run.id)).toMatchObject({ basedOnCaseVersion: 5, outcome: result.run.outcome });
    if (result.run.outcome !== "SUCCEEDED_VALID") {
      expect(result.run.summary).toBeUndefined();
      expect(result.run.assessment).toBeUndefined();
    }
  }, 95_000);
});

function liveConfig(): LiveConfig {
  if (process.env.RESOLVIA_RUNTIME_MODE !== "CONNECTED" || required.some((name) => !process.env[name]?.trim())) {
    throw new Error("Task 6.7 requires explicit CONNECTED Google Cloud configuration.");
  }
  return {
    projectId: process.env.GOOGLE_CLOUD_PROJECT!,
    webUrl: process.env.RESOLVIA_WEB_URL!,
    databaseId: process.env.RESOLVIA_FIRESTORE_DATABASE!,
  };
}

function demoPayload(eventId: string, providerObjectId: string, timestamp = new Date().toISOString()): DemoProviderRequest {
  return {
    schemaVersion: "resolvia-demo-provider-v1",
    provider: "resolvia_demo_provider",
    timestamp,
    nonce: `nonce_${crypto.randomUUID().replaceAll("-", "")}`,
    eventId,
    caseId: "case-rv-1028",
    eventType: "refund.observed",
    providerObjectId,
    providerObjectCreatedAt: timestamp,
    status: "pending",
  };
}

async function postSigned(config: LiveConfig, secret: Buffer, payload: DemoProviderRequest, options: { invalidSignature?: boolean } = {}): Promise<Response> {
  const rawBody = JSON.stringify(payload);
  const signature = options.invalidSignature ? "x".repeat(43) : signDemoProviderRequest(rawBody, payload.timestamp, secret);
  const token = await operatorIdentityToken();
  return fetch(`${config.webUrl}/api/providers/demo/webhook`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-resolvia-demo-timestamp": payload.timestamp,
      "x-resolvia-demo-signature": signature,
    },
    body: rawBody,
  });
}

async function operatorIdentityToken(): Promise<string> {
  const gcloud = process.env.GCLOUD_PATH?.trim() || `${process.env.LOCALAPPDATA}\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd`;
  if (!/^[A-Za-z]:\\[^"&|<>\r\n]+gcloud\.cmd$/iu.test(gcloud)) {
    throw new Error("Validated gcloud command path is unavailable.");
  }
  const { stdout } = await execAsync(`"${gcloud}" auth print-identity-token`, {
    windowsHide: true,
  });
  const token = stdout.trim();
  if (!token) throw new Error("Operator identity token is unavailable.");
  return token;
}
async function waitForVersion(store: FirestoreResolutionStore, version: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const bundle = await store.loadCaseBundle("case-rv-1028");
    if (bundle?.caseRecord.version === version) return bundle;
    await delay(1_000);
  }
  throw new Error(`Timed out waiting for connected RV-1028 v${version}.`);
}

function authoritative(bundle: Awaited<ReturnType<FirestoreResolutionStore["loadCaseBundle"]>>) {
  if (!bundle) return null;
  return {
    caseRecord: bundle.caseRecord,
    events: bundle.events,
    evidence: bundle.evidence,
    claims: bundle.claims,
    auditRecords: bundle.auditRecords,
    providerTransactions: bundle.providerTransactions,
  };
}
