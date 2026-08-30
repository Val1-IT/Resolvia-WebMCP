import { exec } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import { Firestore } from "@google-cloud/firestore";
import { describe, expect, it } from "vitest";

import { evaluateClaimStatus } from "@/src/domain/claims/model";
import { createPartnerRequest } from "@/src/domain/partners/policy";
import { buildTruthGraph } from "@/src/domain/truth-graph/build-truth-graph";
import { FirestoreResolutionStore } from "@/src/infrastructure/google/firestore-resolution-store";
import { resetConnectedRv1028 } from "@/src/infrastructure/google/reset-connected-rv1028";
import { buildCaseWorkspaceViewModel } from "@/src/ui/case-workspace/model";

const execAsync = promisify(exec);
const enabled = process.env.RUN_PHASE7_CONNECTED_SMOKE === "1";

type LiveConfig = { projectId: string; webUrl: string; databaseId: string };

describe.skipIf(!enabled)("Task 7 G8 connected Partner Portal proof", () => {
  it("accepts one scoped synthetic Demo Partner response through private Cloud Run, Pub/Sub, and Firestore", async () => {
    const config = liveConfig();
    const firestore = new Firestore({ projectId: config.projectId, databaseId: config.databaseId });
    const store = new FirestoreResolutionStore(firestore, "resolvia");
    const before = await resetConnectedRv1028({ firestore, store, collectionPrefix: "resolvia", runtimeMode: "CONNECTED", confirmed: true });
    expect(before.caseRecord).toMatchObject({ state: "INVESTIGATING", version: 4 });

    const rawToken = randomBytes(32).toString("base64url");
    const requestId = `partner-request-g8-${crypto.randomUUID().replaceAll("-", "")}`;
    const created = createPartnerRequest({
      caseRecord: before.caseRecord,
      requestId,
      rawToken,
      now: new Date().toISOString(),
    });
    expect(await store.createPartnerRequest({ ...created, expectedCaseVersion: 4 })).toBe("COMMITTED");
    expect(JSON.stringify(await store.loadCaseBundle("case-rv-1028"))).not.toContain(rawToken);

    const token = await operatorIdentityToken();
    const access = await partnerPost(config, token, requestId, "access", { token: rawToken });
    expect(access.status).toBe(200);
    expect(await access.json()).toMatchObject({
      requestId,
      caseDisplayId: "RV-1028",
      requestedEvidenceType: "CUSTOMER_RECEIPT",
    });

    const payload = {
      token: rawToken,
      requestedEvidenceType: "CUSTOMER_RECEIPT",
      responseStatus: "CONFIRMED",
      responseReference: `demo-receipt-${crypto.randomUUID().replaceAll("-", "")}`,
      responseSummary: "Synthetic Resolvia Demo Partner confirms the customer receipt.",
    };
    const accepted = await partnerPost(config, token, requestId, "submit", payload);
    expect(accepted.status).toBe(202);
    expect(await accepted.json()).toEqual({ status: "ACCEPTED" });

    const after = await waitForVersion(store, 5, 60_000);
    const event = after.events.find((record) => record.correlationId === requestId);
    expect(after.caseRecord).toMatchObject({ state: "INVESTIGATING", version: 5 });
    expect(event).toMatchObject({ kind: "PARTNER_EVIDENCE_SUBMITTED", source: { category: "PARTNER", provider: "resolvia_demo_partner" } });
    expect(after.evidence.filter((record) => record.sourceProvider === "resolvia_demo_partner")).toMatchObject([{ verificationLevel: "PARTNER_VERIFIED", type: "PARTNER_RESPONSE" }]);
    expect(after.providerTransactions).toEqual([]);
    expect(after.claims.find((claim) => claim.id === "claim-refund-processed") && evaluateClaimStatus(after.claims.find((claim) => claim.id === "claim-refund-processed")!)).toBe("UNVERIFIED");
    expect(buildTruthGraph(after).nodes.some((node) => node.kind === "VERIFICATION_GAP" && node.authoritative)).toBe(false);
    expect(buildCaseWorkspaceViewModel(after).agentAnalysis).toMatchObject({ basedOnCaseVersion: 4, freshness: "STALE" });

    const replay = await partnerPost(config, token, requestId, "submit", payload);
    expect(replay.status).toBe(202);
    await delay(4_000);
    const duplicate = await store.loadCaseBundle("case-rv-1028");
    expect(duplicate?.caseRecord.version).toBe(5);
    expect(duplicate?.events.filter((record) => record.correlationId === requestId)).toHaveLength(1);
    expect(duplicate?.evidence.filter((record) => record.sourceProvider === "resolvia_demo_partner")).toHaveLength(1);
    expect(duplicate?.auditRecords.filter((record) => record.triggeringEventId === event?.id)).toHaveLength(1);

    const unknown = await partnerPost(config, token, `missing-${requestId}`, "access", { token: rawToken });
    expect(unknown.status).toBe(404);
  }, 95_000);
});

function liveConfig(): LiveConfig {
  if (process.env.RESOLVIA_RUNTIME_MODE !== "CONNECTED" || !process.env.GOOGLE_CLOUD_PROJECT || !process.env.RESOLVIA_WEB_URL || !process.env.RESOLVIA_FIRESTORE_DATABASE) {
    throw new Error("Task 7 requires explicit CONNECTED Google Cloud configuration.");
  }
  return { projectId: process.env.GOOGLE_CLOUD_PROJECT, webUrl: process.env.RESOLVIA_WEB_URL, databaseId: process.env.RESOLVIA_FIRESTORE_DATABASE };
}

async function partnerPost(config: LiveConfig, token: string, requestId: string, operation: "access" | "submit", body: unknown): Promise<Response> {
  return fetch(`${config.webUrl}/api/partner/requests/${encodeURIComponent(requestId)}/${operation}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function operatorIdentityToken(): Promise<string> {
  const gcloud = process.env.GCLOUD_PATH?.trim() || `${process.env.LOCALAPPDATA}\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd`;
  if (!/^[A-Za-z]:\\[^"&|<>\r\n]+gcloud\.cmd$/iu.test(gcloud)) throw new Error("Validated gcloud command path is unavailable.");
  const { stdout } = await execAsync(`"${gcloud}" auth print-identity-token`, { windowsHide: true });
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