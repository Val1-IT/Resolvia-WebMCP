import { exec } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import { Firestore } from "@google-cloud/firestore";
import { describe, expect, it } from "vitest";

import { evaluateClaimStatus } from "@/src/domain/claims/model";
import { createPartnerRequest } from "@/src/domain/partners/policy";
import type { ResolutionCaseBundle } from "@/src/domain/store/model";
import { buildTruthGraph } from "@/src/domain/truth-graph/build-truth-graph";
import { FirestoreResolutionStore } from "@/src/infrastructure/google/firestore-resolution-store";
import { getDemoProviderSecret } from "@/src/infrastructure/google/demo-provider-secret";
import { resetConnectedRv1028 } from "@/src/infrastructure/google/reset-connected-rv1028";
import {
  signDemoProviderRequest,
  type DemoProviderRequest,
} from "@/src/infrastructure/providers/demo/demo-provider-adapter";
import { buildCaseWorkspaceViewModel } from "@/src/ui/case-workspace/model";

const execAsync = promisify(exec);
const enabled = process.env.RUN_RELEASE_CONNECTED_REHEARSAL === "1";
const CASE_ID = "case-rv-1028";

type LiveConfig = {
  projectId: string;
  region: string;
  webUrl: string;
  databaseId: string;
  schedulerJob: string;
  gcloudPath: string;
};

describe.skipIf(!enabled).sequential("G13 canonical connected rehearsals", () => {
  it.each([1, 2])(
    "rehearsal %i preserves evidence authority while resolving RV-1028 exactly once",
    async (rehearsal) => {
      const config = liveConfig();
      const firestore = new Firestore({
        projectId: config.projectId,
        databaseId: config.databaseId,
      });
      const store = new FirestoreResolutionStore(firestore, "resolvia");
      const before = await resetConnectedRv1028({
        firestore,
        store,
        collectionPrefix: "resolvia",
        runtimeMode: "CONNECTED",
        confirmed: true,
      });
      assertBaseline(before);

      const secret = await getDemoProviderSecret(config.projectId);
      const suffix = `${rehearsal}_${randomUUID().replaceAll("-", "")}`;
      const providerPayload = demoProviderPayload(suffix);
      const providerAccepted = await postSignedProvider(config, secret, providerPayload);
      expect(providerAccepted.status).toBe(202);

      const versionFive = await waitForBundle(store, (bundle) => bundle.caseRecord.version === 5, 90_000);
      assertProviderVersion(versionFive, providerPayload);

      const exactReplay = await postSignedProvider(config, secret, providerPayload);
      expect(exactReplay.status).toBe(202);
      expect(await exactReplay.json()).toMatchObject({ status: "DUPLICATE", published: 0 });
      const replayConflict = await postSignedProvider(config, secret, {
        ...providerPayload,
        providerObjectId: `${providerPayload.providerObjectId}_conflict`,
      });
      expect(replayConflict.status).toBe(503);
      const invalidSignature = await postSignedProvider(
        config,
        secret,
        demoProviderPayload(`invalid_${suffix}`),
        true,
      );
      expect(invalidSignature.status).toBe(400);
      expect((await store.loadCaseBundle(CASE_ID))?.caseRecord.version).toBe(5);

      await triggerScheduler(config);
      const automatedFive = await waitForBundle(
        store,
        (bundle) => automationSucceeded(bundle, 5) && hasValidCurrentRun(bundle, 5),
        180_000,
      );
      expect(automatedFive.caseRecord).toMatchObject({ version: 5, state: "INVESTIGATING" });
      expect(authoritativeSemanticView(automatedFive)).toEqual(authoritativeSemanticView(versionFive));

      const rawToken = randomBytes(32).toString("base64url");
      const requestId = `partner-release-${suffix}`;
      const partnerRequest = createPartnerRequest({
        caseRecord: automatedFive.caseRecord,
        requestId,
        rawToken,
        now: new Date().toISOString(),
      });
      expect(
        await store.createPartnerRequest({
          ...partnerRequest,
          expectedCaseVersion: 5,
        }),
      ).toBe("COMMITTED");

      const operatorToken = await operatorIdentityToken(config);
      const access = await partnerPost(config, operatorToken, requestId, "access", {
        token: rawToken,
      });
      expect(access.status).toBe(200);

      const response = {
        token: rawToken,
        requestedEvidenceType: "CUSTOMER_RECEIPT",
        responseStatus: "CONFIRMED",
        responseReference: `demo-receipt-${suffix}`,
        responseSummary: "Synthetic Resolvia Demo Partner confirms the customer receipt.",
      } as const;
      const partnerAccepted = await partnerPost(
        config,
        operatorToken,
        requestId,
        "submit",
        response,
      );
      expect(partnerAccepted.status).toBe(202);

      const versionSix = await waitForBundle(store, (bundle) => bundle.caseRecord.version === 6, 90_000);
      expect(versionSix.caseRecord).toMatchObject({ version: 6, state: "RESOLUTION_PENDING" });
      expect(versionSix.providerTransactions).toHaveLength(1);
      expect(
        versionSix.evidence.filter(
          (record) => record.verificationLevel === "PARTNER_VERIFIED",
        ),
      ).toHaveLength(1);
      expect(merchantClaimStatus(versionSix)).toBe("UNVERIFIED");

      const partnerReplay = await partnerPost(
        config,
        operatorToken,
        requestId,
        "submit",
        response,
      );
      expect(partnerReplay.status).toBe(202);
      const wrongToken = await partnerPost(
        config,
        operatorToken,
        requestId,
        "access",
        { token: randomBytes(32).toString("base64url") },
      );
      expect(wrongToken.status).toBe(404);
      const crossRequest = await partnerPost(
        config,
        operatorToken,
        `missing-${requestId}`,
        "access",
        { token: rawToken },
      );
      expect(crossRequest.status).toBe(404);
      await delay(4_000);
      expect((await store.loadCaseBundle(CASE_ID))?.caseRecord.version).toBe(6);

      await triggerScheduler(config);
      const versionSeven = await waitForBundle(
        store,
        (bundle) => bundle.caseRecord.version === 7 && automationSucceeded(bundle, 6),
        180_000,
      );
      expect(versionSeven.caseRecord).toMatchObject({ version: 7, state: "RESOLVED" });
      expect(versionSeven.auditRecords).toContainEqual(
        expect.objectContaining({ ruleId: "RESOLUTION_PENDING_TO_RESOLVED" }),
      );
      expect(versionSeven.providerTransactions).toHaveLength(1);
      expect(merchantClaimStatus(versionSeven)).toBe("UNVERIFIED");
      expect(
        buildTruthGraph(versionSeven).nodes.every(
          (node) => node.kind !== "VERIFICATION_GAP" || (!node.authoritative && node.placeholder),
        ),
      ).toBe(true);

      await triggerScheduler(config);
      const final = await waitForBundle(
        store,
        (bundle) => automationSucceeded(bundle, 7) && hasValidCurrentRun(bundle, 7),
        180_000,
      );
      const stableSemanticView = authoritativeSemanticView(final);
      const stableCounts = recordCounts(final);
      await triggerScheduler(config);
      await delay(8_000);
      const duplicateScheduler = await store.loadCaseBundle(CASE_ID);
      expect(duplicateScheduler).not.toBeNull();
      expect(authoritativeSemanticView(duplicateScheduler!)).toEqual(stableSemanticView);
      expect(recordCounts(duplicateScheduler!)).toEqual(stableCounts);
      expect(buildCaseWorkspaceViewModel(duplicateScheduler!).agentAnalysis).toMatchObject({
        basedOnCaseVersion: 7,
        freshness: "CURRENT",
        outcome: "SUCCEEDED_VALID",
      });

      console.info(
        JSON.stringify({
          gate: "G13",
          rehearsal,
          caseId: CASE_ID,
          providerEventId: providerPayload.eventId,
          providerObjectId: providerPayload.providerObjectId,
          partnerRequestId: requestId,
          initialVersion: 4,
          finalVersion: duplicateScheduler!.caseRecord.version,
          finalState: duplicateScheduler!.caseRecord.state,
          transactionCount: duplicateScheduler!.providerTransactions.length,
          partnerEvidenceCount: duplicateScheduler!.evidence.filter(
            (record) => record.verificationLevel === "PARTNER_VERIFIED",
          ).length,
          merchantClaimStatus: merchantClaimStatus(duplicateScheduler!),
          currentAgentRunOutcome: buildCaseWorkspaceViewModel(duplicateScheduler!).agentAnalysis?.outcome,
        }),
      );
    },
    600_000,
  );
});

function liveConfig(): LiveConfig {
  const values = {
    projectId: process.env.GOOGLE_CLOUD_PROJECT?.trim(),
    region: process.env.RESOLVIA_GCP_REGION?.trim(),
    webUrl: process.env.RESOLVIA_WEB_URL?.trim(),
    databaseId: process.env.RESOLVIA_FIRESTORE_DATABASE?.trim(),
    schedulerJob: process.env.RESOLVIA_SCHEDULER_JOB?.trim(),
    gcloudPath: process.env.GCLOUD_PATH?.trim(),
  };
  if (
    process.env.RESOLVIA_RUNTIME_MODE !== "CONNECTED" ||
    Object.values(values).some((value) => !value)
  ) {
    throw new Error("Release rehearsal requires explicit CONNECTED configuration.");
  }
  if (!/^[A-Za-z]:\\[^"&|<>\r\n]+gcloud\.cmd$/iu.test(values.gcloudPath!)) {
    throw new Error("Validated gcloud command path is unavailable.");
  }
  if (
    !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/u.test(values.projectId!) ||
    !/^[a-z]+-[a-z]+\d$/u.test(values.region!) ||
    !/^[A-Za-z0-9_-]{1,500}$/u.test(values.schedulerJob!)
  ) {
    throw new Error("Connected command configuration is invalid.");
  }
  return {
    projectId: values.projectId!,
    region: values.region!,
    webUrl: values.webUrl!,
    databaseId: values.databaseId!,
    schedulerJob: values.schedulerJob!,
    gcloudPath: values.gcloudPath!,
  };
}

function assertBaseline(bundle: ResolutionCaseBundle): void {
  expect(bundle.caseRecord).toMatchObject({ version: 4, state: "INVESTIGATING" });
  expect(merchantClaimStatus(bundle)).toBe("UNVERIFIED");
  expect(bundle.evidence).toMatchObject([{ verificationLevel: "AUTHENTICATED_SOURCE" }]);
  expect(bundle.providerTransactions).toEqual([]);
  expect(bundle.agentRuns).toMatchObject([
    { basedOnCaseVersion: 4, outcome: "FAILED_CONFIGURATION" },
  ]);
}

function assertProviderVersion(
  bundle: ResolutionCaseBundle,
  payload: DemoProviderRequest,
): void {
  expect(bundle.caseRecord).toMatchObject({ version: 5, state: "INVESTIGATING" });
  expect(bundle.providerTransactions).toMatchObject([
    {
      caseId: CASE_ID,
      provider: "resolvia_demo_provider",
      providerObjectId: payload.providerObjectId,
      status: "SUCCEEDED",
    },
  ]);
  expect(
    bundle.evidence.filter(
      (record) => record.verificationLevel === "DEMO_PROVIDER_VERIFIED",
    ),
  ).toHaveLength(1);
  expect(merchantClaimStatus(bundle)).toBe("UNVERIFIED");
  expect(buildCaseWorkspaceViewModel(bundle).agentAnalysis).toMatchObject({
    basedOnCaseVersion: 4,
    freshness: "STALE",
  });
}

function demoProviderPayload(suffix: string): DemoProviderRequest {
  const timestamp = new Date().toISOString();
  return {
    schemaVersion: "resolvia-demo-provider-v1",
    provider: "resolvia_demo_provider",
    timestamp,
    nonce: `nonce_${suffix}`,
    eventId: `release_provider_${suffix}`,
    caseId: CASE_ID,
    eventType: "refund.observed",
    providerObjectId: `demo_refund_${suffix}`,
    providerObjectCreatedAt: timestamp,
    status: "succeeded",
  };
}

async function postSignedProvider(
  config: LiveConfig,
  secret: Buffer,
  payload: DemoProviderRequest,
  invalidSignature = false,
): Promise<Response> {
  const rawBody = JSON.stringify(payload);
  const signature = invalidSignature
    ? "x".repeat(43)
    : signDemoProviderRequest(rawBody, payload.timestamp, secret);
  return fetch(`${config.webUrl}/api/providers/demo/webhook`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${await operatorIdentityToken(config)}`,
      "content-type": "application/json",
      "x-resolvia-demo-timestamp": payload.timestamp,
      "x-resolvia-demo-signature": signature,
    },
    body: rawBody,
  });
}

async function partnerPost(
  config: LiveConfig,
  token: string,
  requestId: string,
  operation: "access" | "submit",
  body: unknown,
): Promise<Response> {
  return fetch(
    `${config.webUrl}/api/partner/requests/${encodeURIComponent(requestId)}/${operation}`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

async function operatorIdentityToken(config: LiveConfig): Promise<string> {
  const { stdout } = await execAsync(
    `"${config.gcloudPath}" auth print-identity-token`,
    { windowsHide: true },
  );
  const token = stdout.trim();
  if (!token) throw new Error("Operator identity token is unavailable.");
  return token;
}

async function triggerScheduler(config: LiveConfig): Promise<void> {
  await execAsync(
    `"${config.gcloudPath}" scheduler jobs run ${config.schedulerJob} --project=${config.projectId} --location=${config.region} --quiet`,
    { windowsHide: true },
  );
}

async function waitForBundle(
  store: FirestoreResolutionStore,
  predicate: (bundle: ResolutionCaseBundle) => boolean,
  timeoutMs: number,
): Promise<ResolutionCaseBundle> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const bundle = await store.loadCaseBundle(CASE_ID);
    if (bundle && predicate(bundle)) return bundle;
    await delay(1_000);
  }
  throw new Error("Timed out waiting for the connected rehearsal condition.");
}

function automationSucceeded(bundle: ResolutionCaseBundle, version: number): boolean {
  const requests = (bundle.automationRequests ?? []).filter(
    (request) => request.basedOnCaseVersion === version,
  );
  return requests.length === 3 && requests.every((request) => request.state === "SUCCEEDED");
}

function hasValidCurrentRun(bundle: ResolutionCaseBundle, version: number): boolean {
  return bundle.agentRuns.some(
    (run) => run.basedOnCaseVersion === version && run.outcome === "SUCCEEDED_VALID",
  );
}

function merchantClaimStatus(bundle: ResolutionCaseBundle) {
  const claim = bundle.claims.find((record) => record.id === "claim-refund-processed");
  if (!claim) throw new Error("Merchant claim is missing.");
  return evaluateClaimStatus(claim);
}

function authoritativeSemanticView(bundle: ResolutionCaseBundle) {
  return {
    caseRecord: bundle.caseRecord,
    events: bundle.events,
    evidence: bundle.evidence,
    claims: bundle.claims,
    auditRecords: bundle.auditRecords,
    providerTransactions: bundle.providerTransactions,
  };
}

function recordCounts(bundle: ResolutionCaseBundle) {
  return {
    events: bundle.events.length,
    evidence: bundle.evidence.length,
    claims: bundle.claims.length,
    auditRecords: bundle.auditRecords.length,
    providerTransactions: bundle.providerTransactions.length,
    agentRuns: bundle.agentRuns.length,
    automationRequests: (bundle.automationRequests ?? []).length,
  };
}
