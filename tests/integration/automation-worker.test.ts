import { describe, expect, it, vi } from "vitest";

import { runAutomationBatch } from "@/src/application/automation/run-automation-batch";
import type { AgentService } from "@/src/application/ports/external-services";
import { attachAutomationOutbox } from "@/src/domain/automation/outbox-policy";
import type { CaseMutation } from "@/src/domain/store/model";
import { InMemoryResolutionStore } from "@/src/infrastructure/memory/in-memory-resolution-store";
import { makeAgentRun } from "@/tests/fixtures/agent";
import { initialRefundBundle } from "@/tests/fixtures/domain";

const timestamp = "2026-08-12T17:00:00.000Z";

function versionFiveStore() {
  const bundle = initialRefundBundle();
  const store = new InMemoryResolutionStore({
    cases: [bundle.caseRecord], events: bundle.events, evidence: bundle.evidence,
    claims: bundle.claims, auditRecords: bundle.auditRecords,
    providerTransactions: bundle.providerTransactions,
    agentRuns: [makeAgentRun({ id: "agent-run-v4", basedOnCaseVersion: 4 })],
    partnerRequests: [], partnerTokenReceipts: [], automationRequests: [], deadlines: [],
  });
  const mutation: CaseMutation = {
    caseRecord: { ...bundle.caseRecord, version: 5, updatedAt: timestamp },
    expectedCaseVersion: 4, eventsToAppend: [], evidenceToAdd: [], claimsToSave: [],
    auditRecordsToAppend: [], transactionsToAdd: [],
  };
  return { store, mutation: attachAutomationOutbox(mutation, timestamp) };
}

describe("runAutomationBatch", () => {
  it("leases due analysis, appends a version-matched degraded AgentRun, and never changes semantic case state", async () => {
    const { store, mutation } = versionFiveStore();
    await store.commitCaseMutation(mutation);
    const proposeResolution = vi.fn<AgentService["proposeResolution"]>(async () => ({
      kind: "FAILURE", outcome: "FAILED_CONFIGURATION", modelId: "gemini-not-configured",
    }));

    const result = await runAutomationBatch({
      store, agentService: { proposeResolution }, workerId: "worker-a", limit: 1,
      now: () => "2026-08-12T17:01:00.000Z", createRunId: () => "agent-run-v5-auto",
    });

    expect(result).toEqual({ scanned: 1, claimed: 1, succeeded: 1, retryable: 0, terminal: 0 });
    expect(proposeResolution).toHaveBeenCalledTimes(1);
    const after = await store.loadCaseBundle("case-rv-1028");
    expect(after?.caseRecord).toMatchObject({ version: 5, state: "INVESTIGATING" });
    expect(after?.agentRuns.find((run) => run.id === "agent-run-v5-auto")).toMatchObject({
      basedOnCaseVersion: 5, outcome: "FAILED_CONFIGURATION",
    });
    expect(after?.automationRequests?.find((request) => request.kind === "RUN_AGENT_ANALYSIS")?.state).toBe("SUCCEEDED");
  });

  it("terminalizes stale version work without calling Gemini", async () => {
    const { store, mutation } = versionFiveStore();
    await store.commitCaseMutation(mutation);
    await store.commitCaseMutation({
      caseRecord: { ...mutation.caseRecord, version: 6, updatedAt: "2026-08-12T17:00:30.000Z" },
      expectedCaseVersion: 5, eventsToAppend: [], evidenceToAdd: [], claimsToSave: [], auditRecordsToAppend: [], transactionsToAdd: [],
    });
    const proposeResolution = vi.fn<AgentService["proposeResolution"]>();
    const result = await runAutomationBatch({
      store, agentService: { proposeResolution }, workerId: "worker-a", limit: 1,
      now: () => "2026-08-12T17:01:00.000Z", createRunId: () => "must-not-run",
    });
    expect(result.terminal).toBe(1);
    expect(proposeResolution).not.toHaveBeenCalled();
  });
});
