import { describe, expect, it } from "vitest";

import { attachAutomationOutbox } from "@/src/domain/automation/outbox-policy";
import { AutomationRequestRecordSchema } from "@/src/domain/automation/model";
import { applyCaseMutation } from "@/src/domain/store/apply-mutation";
import type { CaseMutation } from "@/src/domain/store/model";
import { initialRefundBundle } from "@/tests/fixtures/domain";
import { InMemoryResolutionStore } from "@/src/infrastructure/memory/in-memory-resolution-store";

const now = "2026-08-12T17:00:00.000Z";

function semanticMutation(): CaseMutation {
  const bundle = initialRefundBundle();
  return {
    caseRecord: {
      ...bundle.caseRecord,
      version: bundle.caseRecord.version + 1,
      updatedAt: now,
    },
    expectedCaseVersion: bundle.caseRecord.version,
    eventsToAppend: [],
    evidenceToAdd: [],
    claimsToSave: [],
    auditRecordsToAppend: [],
    transactionsToAdd: [],
  };
}

describe("attachAutomationOutbox", () => {
  it("adds one deterministic version-pinned request for each safe internal automation kind", () => {
    const mutation = attachAutomationOutbox(semanticMutation(), now);

    expect(mutation.automationRequestsToCreate).toEqual([
      expect.objectContaining({
        id: "automation:case-rv-1028:v5:RUN_AGENT_ANALYSIS",
        automationKey: "case-rv-1028:v5:RUN_AGENT_ANALYSIS",
        caseId: "case-rv-1028",
        basedOnCaseVersion: 5,
        kind: "RUN_AGENT_ANALYSIS",
        state: "PENDING",
        retryCount: 0,
        nextAttemptAt: now,
      }),
      expect.objectContaining({ kind: "RECALCULATE_GUIDANCE" }),
      expect.objectContaining({ kind: "EVALUATE_RESOLUTION" }),
    ]);
    for (const request of mutation.automationRequestsToCreate ?? []) {
      expect(AutomationRequestRecordSchema.safeParse(request).success).toBe(true);
      expect(request.leaseUntil).toBeUndefined();
    }
    expect(mutation.deadlinesToSave).toEqual([
      expect.objectContaining({
        id: "deadline:case-rv-1028:v5:PROVIDER_FOLLOW_UP",
        caseId: "case-rv-1028",
        basedOnCaseVersion: 5,
        kind: "PROVIDER_FOLLOW_UP",
        dueAt: "2026-08-13T17:00:00.000Z",
        state: "OPEN",
      }),
    ]);
  });

  it("does not create automation work for a non-semantic AgentRun append", () => {
    expect(attachAutomationOutbox({ ...semanticMutation(), caseRecord: initialRefundBundle().caseRecord }, now)
      .automationRequestsToCreate).toEqual([]);
  });

  it("persists outbox work atomically and rejects a duplicate automation key", () => {
    const bundle = initialRefundBundle();
    const snapshot = {
      cases: [bundle.caseRecord], events: bundle.events, evidence: bundle.evidence,
      claims: bundle.claims, auditRecords: bundle.auditRecords,
      providerTransactions: bundle.providerTransactions, agentRuns: bundle.agentRuns,
      partnerRequests: [], partnerTokenReceipts: [], automationRequests: [], deadlines: [],
    };
    const mutation = attachAutomationOutbox(semanticMutation(), now);
    const committed = applyCaseMutation(snapshot, mutation);

    expect(committed.result).toBe("COMMITTED");
    expect(committed.snapshot.automationRequests).toHaveLength(3);
    expect(committed.snapshot.deadlines).toHaveLength(1);

    const duplicate = applyCaseMutation(
      { ...snapshot, automationRequests: [mutation.automationRequestsToCreate![0]!] },
      mutation,
    );
    expect(duplicate.result).toBe("CASE_INTEGRITY_ERROR");
    expect(duplicate.snapshot.cases[0]?.version).toBe(4);
  });

  it("returns durable automation and deadline records with the case bundle", async () => {
    const bundle = initialRefundBundle();
    const store = new InMemoryResolutionStore({
      cases: [bundle.caseRecord], events: bundle.events, evidence: bundle.evidence,
      claims: bundle.claims, auditRecords: bundle.auditRecords,
      providerTransactions: bundle.providerTransactions, agentRuns: bundle.agentRuns,
      partnerRequests: [], partnerTokenReceipts: [], automationRequests: [], deadlines: [],
    });
    expect(await store.commitCaseMutation(attachAutomationOutbox(semanticMutation(), now))).toBe("COMMITTED");
    const loaded = await store.loadCaseBundle("case-rv-1028");
    expect(loaded?.automationRequests).toHaveLength(3);
    expect(loaded?.deadlines).toHaveLength(1);
  });
});
