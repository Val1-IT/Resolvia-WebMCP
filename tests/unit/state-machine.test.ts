import { describe, expect, it } from "vitest";

import type { CaseState } from "@/src/domain/cases/model";
import {
  isTerminalState,
  planCaseTransition,
  type TransitionInput,
} from "@/src/domain/cases/state-machine";
import type {
  ResolutionEventKind,
} from "@/src/domain/events/model";
import { FIXED_NOW, makeCase, makeEvent } from "@/tests/fixtures/domain";

function makeTransitionInput(
  from: CaseState,
  to: CaseState,
  kind: ResolutionEventKind,
  overrides: Partial<TransitionInput> = {},
): TransitionInput {
  return {
    caseRecord: makeCase({ state: from }),
    targetState: to,
    triggerEvent: makeEvent({ kind }),
    reason:
      kind === "CASE_REOPENED"
        ? "New contradictory evidence received."
        : "Rule conditions satisfied.",
    evidenceIds:
      kind === "CASE_REOPENED" ? ["evidence-qualifying"] : [],
    occurredAt: FIXED_NOW,
    auditId: `audit-${from}-${to}`,
    ...overrides,
  };
}

const validTransitions = [
  ["NEW", "EVIDENCE_COLLECTION", "CASE_INTAKE_STARTED"],
  ["EVIDENCE_COLLECTION", "INVESTIGATING", "INITIAL_EVIDENCE_RECORDED"],
  ["INVESTIGATING", "WAITING_EXTERNAL", "EXTERNAL_EVIDENCE_REQUESTED"],
  ["INVESTIGATING", "ACTION_REQUIRED", "USER_ACTION_REQUIRED"],
  ["INVESTIGATING", "ESCALATION_REQUIRED", "ESCALATION_NEEDED"],
  ["INVESTIGATING", "RESOLUTION_PENDING", "RESOLUTION_PROVISIONAL"],
  ["WAITING_EXTERNAL", "INVESTIGATING", "RELEVANT_EVIDENCE_RECEIVED"],
  ["ACTION_REQUIRED", "INVESTIGATING", "REQUIRED_ACTION_COMPLETED"],
  ["ESCALATION_REQUIRED", "INVESTIGATING", "ESCALATION_COMPLETED"],
  ["ESCALATION_REQUIRED", "INVESTIGATING", "RELEVANT_EVIDENCE_RECEIVED"],
  ["RESOLUTION_PENDING", "RESOLVED", "RESOLUTION_EVIDENCE_SATISFIED"],
  [
    "RESOLUTION_PENDING",
    "INVESTIGATING",
    "RESOLUTION_EVIDENCE_INVALIDATED",
  ],
  ["RESOLVED", "INVESTIGATING", "CASE_REOPENED"],
  ["RESOLVED", "CLOSED", "CASE_CLOSED"],
] as const satisfies ReadonlyArray<
  readonly [CaseState, CaseState, ResolutionEventKind]
>;

describe("case state machine", () => {
  it.each(validTransitions)(
    "allows %s to %s for %s",
    (from, to, kind) => {
      const result = planCaseTransition(
        makeTransitionInput(from, to, kind),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.caseRecord.state).toBe(to);
        expect(result.caseRecord.version).toBe(2);
        expect(result.auditRecord.triggeringEventId).toBe("event-intake");
      }
    },
  );

  it("keeps CLOSED as the only terminal state", () => {
    expect(isTerminalState("CLOSED")).toBe(true);
    expect(isTerminalState("ESCALATION_REQUIRED")).toBe(false);
  });

  it.each([
    "NEW",
    "EVIDENCE_COLLECTION",
    "INVESTIGATING",
    "WAITING_EXTERNAL",
    "ACTION_REQUIRED",
    "ESCALATION_REQUIRED",
    "RESOLUTION_PENDING",
    "RESOLVED",
  ] as const)("rejects CLOSED to %s", (targetState) => {
    expect(
      planCaseTransition(
        makeTransitionInput("CLOSED", targetState, "CASE_INTAKE_STARTED"),
      ),
    ).toEqual({ ok: false, error: "INVALID_TRANSITION" });
  });

  it("rejects an undeclared transition", () => {
    expect(
      planCaseTransition(
        makeTransitionInput("NEW", "RESOLVED", "RESOLUTION_EVIDENCE_SATISFIED"),
      ),
    ).toEqual({ ok: false, error: "INVALID_TRANSITION" });
  });

  it("rejects the wrong trigger for an allowed state pair", () => {
    expect(
      planCaseTransition(
        makeTransitionInput(
          "NEW",
          "EVIDENCE_COLLECTION",
          "RELEVANT_EVIDENCE_RECEIVED",
        ),
      ),
    ).toEqual({ ok: false, error: "INVALID_TRANSITION_CONTEXT" });
  });

  it("rejects a trigger event from another case", () => {
    expect(
      planCaseTransition(
        makeTransitionInput("NEW", "EVIDENCE_COLLECTION", "CASE_INTAKE_STARTED", {
          triggerEvent: makeEvent({ caseId: "case-other" }),
        }),
      ),
    ).toEqual({ ok: false, error: "INVALID_TRANSITION_CONTEXT" });
  });

  it("requires reopen reason and qualifying evidence", () => {
    expect(
      planCaseTransition(
        makeTransitionInput("RESOLVED", "INVESTIGATING", "CASE_REOPENED", {
          reason: "",
          evidenceIds: [],
        }),
      ),
    ).toEqual({ ok: false, error: "INVALID_TRANSITION_CONTEXT" });
  });
});
