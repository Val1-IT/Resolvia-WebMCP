import { describe, expect, it } from "vitest";

import { planRetentionBatch } from "@/src/domain/privacy/retention-policy";
import { makeAgentRun, snapshotForAgentRuns } from "@/tests/fixtures/agent";

describe("retention policy", () => {
  it("selects only expired non-authoritative records in a bounded deterministic batch", () => {
    const snapshot = snapshotForAgentRuns();
    snapshot.agentRuns = [{
      ...makeAgentRun(),
      id: "old-run",
      completedAt: "2026-01-01T00:00:00.000Z",
    }];
    snapshot.partnerTokenReceipts = [{
      digest: `sha256:${"a".repeat(64)}`,
      requestId: "request-old",
      caseId: "case-rv-1028",
      expiresAt: "2026-01-01T00:00:00.000Z",
      state: "USED",
    }];

    expect(planRetentionBatch(snapshot, "2026-08-12T00:00:00.000Z", 1)).toEqual([
      { kind: "PARTNER_TOKEN_RECEIPT", id: `sha256:${"a".repeat(64)}` },
    ]);
  });

  it("does not select active tokens or authoritative evidence and audit history", () => {
    const snapshot = snapshotForAgentRuns();
    snapshot.agentRuns = [];
    snapshot.partnerTokenReceipts = [{
      digest: `sha256:${"b".repeat(64)}`,
      requestId: "request-active",
      caseId: "case-rv-1028",
      expiresAt: "2026-01-01T00:00:00.000Z",
      state: "OPEN",
    }];
    expect(planRetentionBatch(snapshot, "2026-08-12T00:00:00.000Z", 100)).toEqual([]);
    expect(snapshot.evidence.length).toBeGreaterThan(0);
    expect(snapshot.auditRecords.length).toBeGreaterThan(0);
  });

  it("rejects unbounded batch sizes", () => {
    expect(() => planRetentionBatch(snapshotForAgentRuns(), "2026-08-12T00:00:00.000Z", 501)).toThrow();
  });
});
