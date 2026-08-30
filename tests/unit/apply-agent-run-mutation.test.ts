import { describe, expect, it } from "vitest";

import { applyAgentRunMutation } from "@/src/domain/store/apply-agent-run-mutation";
import { makeAgentRun, snapshotForAgentRuns } from "@/tests/fixtures/agent";
import { makeCase, makeEvidence } from "@/tests/fixtures/domain";

const digest = `sha256:${"c".repeat(64)}`;

describe("applyAgentRunMutation", () => {
  it("appends only one AgentRun and leaves case version and domain truth unchanged", () => {
    const snapshot = snapshotForAgentRuns();
    const beforeDomain = { ...structuredClone(snapshot), agentRuns: undefined };

    const applied = applyAgentRunMutation(snapshot, {
      agentRun: makeAgentRun(),
      expectedCaseVersion: 4,
    });

    expect(applied.result).toBe("COMMITTED");
    expect(applied.snapshot.agentRuns).toEqual([makeAgentRun()]);
    expect(applied.snapshot.cases[0]?.version).toBe(4);
    expect({ ...applied.snapshot, agentRuns: undefined }).toEqual(beforeDomain);
  });

  it("accepts a proposal-free cross-case-reference rejection with safe metadata", () => {
    const snapshot = snapshotForAgentRuns();
    const rejected = makeAgentRun({
      outcome: "REJECTED_VALIDATION",
      summary: undefined,
      assessment: undefined,
      blocker: undefined,
      recommendedAction: undefined,
      uncertainty: undefined,
      openQuestions: undefined,
      observedVerificationGapIds: undefined,
      rawOutputDigest: digest,
      validationErrors: ["CROSS_CASE_EVIDENCE_REFERENCE"],
    });

    const applied = applyAgentRunMutation(snapshot, {
      agentRun: rejected,
      expectedCaseVersion: 4,
    });

    expect(applied.result).toBe("COMMITTED");
    expect(applied.snapshot.agentRuns[0]).not.toHaveProperty("summary");
    expect(applied.snapshot.agentRuns[0]?.rawOutputDigest).toBe(digest);
  });

  it.each([
    [
      "missing case",
      () => ({ agentRun: makeAgentRun({ caseId: "case-missing" }), expectedCaseVersion: 4 }),
      "CASE_INTEGRITY_ERROR",
    ],
    [
      "expected version mismatch",
      () => ({ agentRun: makeAgentRun(), expectedCaseVersion: 3 }),
      "VERSION_CONFLICT",
    ],
    [
      "future based-on version",
      () => ({ agentRun: makeAgentRun({ basedOnCaseVersion: 5 }), expectedCaseVersion: 4 }),
      "CASE_INTEGRITY_ERROR",
    ],
    [
      "unknown derived verification gap",
      () => ({
        agentRun: makeAgentRun({ suppliedVerificationGapIds: ["verification-gap:missing"] }),
        expectedCaseVersion: 4,
      }),
      "CASE_INTEGRITY_ERROR",
    ],
    [
      "retained reference absent from supplied IDs",
      () => ({
        agentRun: makeAgentRun({ suppliedClaimIds: [] }),
        expectedCaseVersion: 4,
      }),
      "CASE_INTEGRITY_ERROR",
    ],
  ] as const)("fails closed for %s", (_label, mutationFactory, expected) => {
    const snapshot = snapshotForAgentRuns();
    const applied = applyAgentRunMutation(snapshot, mutationFactory());

    expect(applied.result).toBe(expected);
    expect(applied.snapshot).toBe(snapshot);
    expect(applied.snapshot).toEqual(snapshotForAgentRuns());
  });

  it("rejects duplicate run IDs without changing the snapshot", () => {
    const existing = makeAgentRun();
    const snapshot = { ...snapshotForAgentRuns(), agentRuns: [existing] };

    const applied = applyAgentRunMutation(snapshot, {
      agentRun: makeAgentRun(),
      expectedCaseVersion: 4,
    });

    expect(applied.result).toBe("CASE_INTEGRITY_ERROR");
    expect(applied.snapshot).toBe(snapshot);
  });

  it("rejects a supplied evidence ID owned by another case", () => {
    const snapshot = snapshotForAgentRuns();
    snapshot.cases.push(
      makeCase({ id: "case-other", displayId: "RV-OTHER", parties: [] }),
    );
    snapshot.evidence.push(
      makeEvidence({
        id: "evidence-other",
        caseId: "case-other",
        relatedClaimIds: [],
      }),
    );

    const applied = applyAgentRunMutation(snapshot, {
      agentRun: makeAgentRun({
        suppliedEvidenceIds: ["evidence-other"],
      }),
      expectedCaseVersion: 4,
    });

    expect(applied.result).toBe("CASE_INTEGRITY_ERROR");
    expect(applied.snapshot).toBe(snapshot);
  });
});
