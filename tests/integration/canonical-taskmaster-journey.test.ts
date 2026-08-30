import { describe, expect, it, vi } from "vitest";

import { runAutomationBatch } from "@/src/application/automation/run-automation-batch";
import { processPartnerEvent } from "@/src/application/events/process-partner-event";
import { processProviderEvent } from "@/src/application/events/process-provider-event";
import type { AgentService } from "@/src/application/ports/external-services";
import { submitPartnerResponse } from "@/src/application/partners/submit-partner-response";
import { createPartnerRequest } from "@/src/domain/partners/policy";
import {
  DemoProviderAdapter,
  signDemoProviderRequest,
  type DemoProviderRequest,
} from "@/src/infrastructure/providers/demo/demo-provider-adapter";
import { InMemoryResolutionStore } from "@/src/infrastructure/memory/in-memory-resolution-store";
import { buildCaseWorkspaceViewModel } from "@/src/ui/case-workspace/model";
import { makeAgentRun } from "@/tests/fixtures/agent";
import { initialRefundBundle } from "@/tests/fixtures/domain";

const secret = Buffer.alloc(32, 7);
const providerAt = "2026-08-13T08:00:00.000Z";
const partnerAt = "2026-08-13T08:02:00.000Z";
const rawToken = "partner-token-abcdefghijklmnopqrstuvwxyz0123456789";

function canonicalStore(): InMemoryResolutionStore {
  const bundle = initialRefundBundle();
  return new InMemoryResolutionStore({
    cases: [bundle.caseRecord],
    events: bundle.events,
    evidence: bundle.evidence,
    claims: bundle.claims,
    auditRecords: bundle.auditRecords,
    providerTransactions: [],
    agentRuns: [makeAgentRun({ id: "agent-run-canonical-v4", basedOnCaseVersion: 4 })],
    partnerRequests: [],
    partnerTokenReceipts: [],
    automationRequests: [],
    deadlines: [],
  });
}

async function providerEvent() {
  const request: DemoProviderRequest = {
    schemaVersion: "resolvia-demo-provider-v1",
    provider: "resolvia_demo_provider",
    timestamp: providerAt,
    nonce: "nonce_canonical_123456",
    eventId: "canonical_provider_succeeded",
    caseId: "case-rv-1028",
    eventType: "refund.observed",
    providerObjectId: "demo_refund_canonical_123",
    providerObjectCreatedAt: providerAt,
    status: "succeeded",
  };
  const rawBody = JSON.stringify(request);
  const adapter = new DemoProviderAdapter({ secret, now: () => providerAt });
  const [event] = await adapter.normalize(
    await adapter.authenticate({
      rawBody,
      signature: signDemoProviderRequest(rawBody, providerAt, secret),
      timestamp: providerAt,
    }),
  );
  return event!;
}

function degradedAgent(): AgentService {
  return {
    proposeResolution: vi.fn(async () => ({
      kind: "FAILURE" as const,
      outcome: "FAILED_CONFIGURATION" as const,
      modelId: "deterministic-no-network-agent",
    })),
  };
}

async function drainVersion(
  store: InMemoryResolutionStore,
  agentService: AgentService,
  version: number,
): Promise<void> {
  let run = 0;
  const result = await runAutomationBatch({
    store,
    agentService,
    workerId: `worker-v${version}`,
    limit: 50,
    now: () => new Date(Date.parse(providerAt) + version * 60_000).toISOString(),
    createRunId: () => `agent-run-canonical-v${version}-${++run}`,
  });
  expect(result.claimed).toBeGreaterThan(0);
  expect(result.retryable).toBe(0);
}

describe("canonical local Taskmaster journey", () => {
  it("moves v4 to v7 through signed provider, scoped partner, and no-click deterministic automation", async () => {
    const store = canonicalStore();
    const agentService = degradedAgent();

    expect(await processProviderEvent(store, await providerEvent(), () => providerAt)).toEqual({
      kind: "COMMITTED",
      caseVersion: 5,
    });
    expect(await processProviderEvent(store, await providerEvent(), () => providerAt)).toEqual({
      kind: "DUPLICATE_EVENT",
    });
    expect(
      buildCaseWorkspaceViewModel(
        (await store.loadCaseBundle("case-rv-1028"))!,
      ).agentAnalysis,
    ).toMatchObject({ freshness: "STALE" });

    await drainVersion(store, agentService, 5);
    const versionFive = (await store.loadCaseBundle("case-rv-1028"))!;
    expect(versionFive.caseRecord).toMatchObject({ version: 5, state: "INVESTIGATING" });
    expect(versionFive.agentRuns.some((run) => run.basedOnCaseVersion === 5)).toBe(true);

    const request = createPartnerRequest({
      caseRecord: versionFive.caseRecord,
      requestId: "partner-request-canonical",
      rawToken,
      now: partnerAt,
    });
    expect(
      await store.createPartnerRequest({ ...request, expectedCaseVersion: 5 }),
    ).toBe("COMMITTED");
    const submitted = await submitPartnerResponse({
      store,
      now: () => partnerAt,
      requestId: request.request.id,
      rawToken,
      response: {
        requestedEvidenceType: "CUSTOMER_RECEIPT",
        responseStatus: "CONFIRMED",
        responseReference: "demo-receipt-canonical",
        responseSummary: "Synthetic Demo Partner confirms customer receipt.",
      },
      publisher: {
        publish: async (event) => {
          const result = await processPartnerEvent(store, event, () => partnerAt);
          if (result.kind !== "COMMITTED" && result.kind !== "DUPLICATE_EVENT") {
            throw new Error(result.kind);
          }
        },
      },
    });
    expect(submitted.kind).toBe("PUBLISHED");

    const versionSix = (await store.loadCaseBundle("case-rv-1028"))!;
    expect(versionSix.caseRecord).toMatchObject({
      version: 6,
      state: "RESOLUTION_PENDING",
    });
    expect(versionSix.providerTransactions).toHaveLength(1);
    expect(
      versionSix.evidence.filter(
        (record) => record.verificationLevel === "PARTNER_VERIFIED",
      ),
    ).toHaveLength(1);

    await drainVersion(store, agentService, 6);
    const resolved = (await store.loadCaseBundle("case-rv-1028"))!;
    expect(resolved.caseRecord).toMatchObject({ version: 7, state: "RESOLVED" });
    expect(resolved.auditRecords).toContainEqual(
      expect.objectContaining({
        ruleId: "RESOLUTION_PENDING_TO_RESOLVED",
      }),
    );

    await drainVersion(store, agentService, 7);
    const final = (await store.loadCaseBundle("case-rv-1028"))!;
    expect(final.caseRecord).toMatchObject({ version: 7, state: "RESOLVED" });
    expect(buildCaseWorkspaceViewModel(final).agentAnalysis).toMatchObject({
      basedOnCaseVersion: 7,
      freshness: "CURRENT",
    });
    expect(final.claims.find((claim) => claim.id === "claim-refund-processed")?.status).toBe("UNVERIFIED");
  });
});
