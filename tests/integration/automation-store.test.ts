import { describe, expect, it } from "vitest";

import { attachAutomationOutbox } from "@/src/domain/automation/outbox-policy";
import type { CaseMutation } from "@/src/domain/store/model";
import { InMemoryResolutionStore } from "@/src/infrastructure/memory/in-memory-resolution-store";
import { initialRefundBundle } from "@/tests/fixtures/domain";

const now = "2026-08-12T17:00:00.000Z";

function storeAndMutation() {
  const bundle = initialRefundBundle();
  const store = new InMemoryResolutionStore({
    cases: [bundle.caseRecord], events: bundle.events, evidence: bundle.evidence,
    claims: bundle.claims, auditRecords: bundle.auditRecords,
    providerTransactions: bundle.providerTransactions, agentRuns: bundle.agentRuns,
    partnerRequests: [], partnerTokenReceipts: [], automationRequests: [], deadlines: [],
  });
  const mutation: CaseMutation = {
    caseRecord: { ...bundle.caseRecord, version: 5, updatedAt: now },
    expectedCaseVersion: 4, eventsToAppend: [], evidenceToAdd: [], claimsToSave: [],
    auditRecordsToAppend: [], transactionsToAdd: [],
  };
  return { store, mutation: attachAutomationOutbox(mutation, now) };
}

describe("durable automation store", () => {
  it("lists bounded due work, grants one lease, and completes only for its owner", async () => {
    const { store, mutation } = storeAndMutation();
    await store.commitCaseMutation(mutation);
    const due = await store.listDueAutomationRequests("2026-08-12T17:01:00.000Z", 2);
    expect(due.map((request) => request.kind)).toEqual(["RUN_AGENT_ANALYSIS", "RECALCULATE_GUIDANCE"]);

    const requestId = due[0]!.id;
    expect(await store.claimAutomationRequest({ requestId, workerId: "worker-a", now: "2026-08-12T17:01:00.000Z", leaseUntil: "2026-08-12T17:03:00.000Z" })).toBe("COMMITTED");
    expect(await store.claimAutomationRequest({ requestId, workerId: "worker-b", now: "2026-08-12T17:01:10.000Z", leaseUntil: "2026-08-12T17:03:10.000Z" })).toBe("NOT_CLAIMABLE");
    expect(await store.completeAutomationRequest({ requestId, workerId: "worker-b", now: "2026-08-12T17:02:00.000Z", outcome: "SUCCEEDED" })).toBe("NOT_CLAIMABLE");
    expect(await store.completeAutomationRequest({ requestId, workerId: "worker-a", now: "2026-08-12T17:02:00.000Z", outcome: "SUCCEEDED" })).toBe("COMMITTED");

    const after = await store.loadCaseBundle("case-rv-1028");
    expect(after?.automationRequests?.find((request) => request.id === requestId)?.state).toBe("SUCCEEDED");
  });
});
