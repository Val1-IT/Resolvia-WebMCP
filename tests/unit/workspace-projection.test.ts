import { describe, expect, it } from "vitest";

import { getCaseWorkspace } from "@/src/application/cases/get-case-workspace";
import { InMemoryResolutionStore } from "@/src/infrastructure/memory/in-memory-resolution-store";
import { makeAgentRun } from "@/tests/fixtures/agent";
import { buildCaseWorkspaceViewModel } from "@/src/ui/case-workspace/model";
import {
  emptySnapshot,
  initialRefundBundle,
  makeClaim,
} from "@/tests/fixtures/domain";

describe("case workspace projection", () => {
  it("projects the refund verification gap without inventing a transaction", () => {
    const view = buildCaseWorkspaceViewModel(initialRefundBundle());

    expect(view.currentState).toBe("INVESTIGATING");
    expect(view.currentBlocker).toBe(
      "Refund transaction has not yet been independently verified.",
    );
    expect(view.nextBestAction).toBe("Obtain traceable provider evidence.");
    expect(view.journey).toEqual([
      expect.objectContaining({
        label: "Merchant claim",
        status: "AUTHENTICATED_CLAIM",
        projectionOnly: false,
      }),
      expect.objectContaining({
        label: "Refund transaction",
        status: "UNVERIFIED",
        projectionOnly: true,
      }),
      expect.objectContaining({
        label: "Processor status",
        status: "UNKNOWN",
        projectionOnly: true,
      }),
      expect.objectContaining({
        label: "Customer received funds",
        status: "UNKNOWN",
        projectionOnly: true,
      }),
    ]);
    expect(view.verificationGap).not.toBeNull();
    expect(view.verificationGap?.expectedEvidence).toBe(
      "Traceable provider refund transaction",
    );
    expect(
      view.truthGraph.nodes.some((node) => node.kind === "TRANSACTION"),
    ).toBe(false);
  });

  it("derives claim evaluation rather than trusting a stale stored status", () => {
    const bundle = initialRefundBundle();
    bundle.claims = [makeClaim({ status: "SUPPORTED" })];

    const view = buildCaseWorkspaceViewModel(bundle);

    expect(view.claims[0]?.status).toBe("UNVERIFIED");
  });

  it("builds timeline and audit explanations from authoritative records", () => {
    const view = buildCaseWorkspaceViewModel(initialRefundBundle());

    expect(view.timeline.map((entry) => entry.id)).toEqual([
      "event-intake",
      "event-initial-evidence",
    ]);
    expect(view.auditTrail).toContainEqual(
      expect.objectContaining({
        id: "audit-transition-1",
        explanation: "NEW → EVIDENCE_COLLECTION — Case intake started.",
      }),
    );
  });

  it("projects the latest immutable AgentRun with current/stale status", () => {
    const bundle = initialRefundBundle();
    bundle.agentRuns = [
      makeAgentRun({
        id: "agent-run-earlier",
        completedAt: "2026-08-09T10:10:00.000Z",
      }),
      makeAgentRun({
        id: "agent-run-latest",
        completedAt: "2026-08-09T10:11:00.000Z",
      }),
    ];

    const current = buildCaseWorkspaceViewModel(bundle);
    expect(current.agentAnalysis).toMatchObject({
      id: "agent-run-latest",
      freshness: "CURRENT",
      outcome: "SUCCEEDED_VALID",
      validationPassed: true,
      modelId: "gemini-2.5-flash",
      basedOnCaseVersion: 4,
    });

    bundle.caseRecord.version = 5;
    expect(buildCaseWorkspaceViewModel(bundle).agentAnalysis?.freshness).toBe(
      "STALE",
    );
  });

  it("projects proposal-free cross-case rejection without unsafe analysis", () => {
    const bundle = initialRefundBundle();
    bundle.agentRuns = [
      makeAgentRun({
        outcome: "REJECTED_VALIDATION",
        summary: undefined,
        assessment: undefined,
        blocker: undefined,
        recommendedAction: undefined,
        uncertainty: undefined,
        openQuestions: undefined,
        observedVerificationGapIds: undefined,
        validationErrors: ["CROSS_CASE_EVIDENCE_REFERENCE"],
      }),
    ];

    const analysis = buildCaseWorkspaceViewModel(bundle).agentAnalysis;

    expect(analysis).toMatchObject({
      outcome: "REJECTED_VALIDATION",
      validationErrors: ["CROSS_CASE_EVIDENCE_REFERENCE"],
    });
    expect(analysis?.summary).toBeUndefined();
    expect(analysis?.recommendedAction).toBeUndefined();
  });

  it("returns null when a case does not exist", async () => {
    const store = new InMemoryResolutionStore(emptySnapshot());

    await expect(getCaseWorkspace(store, "missing")).resolves.toBeNull();
  });
});
