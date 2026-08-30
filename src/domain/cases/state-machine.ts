import type { AuditRecord } from "@/src/domain/audit/model";
import type {
  CaseState,
  ResolutionCase,
} from "@/src/domain/cases/model";
import type {
  ResolutionEvent,
  ResolutionEventKind,
} from "@/src/domain/events/model";

type TransitionRule = {
  from: CaseState;
  to: CaseState;
  triggers: readonly ResolutionEventKind[];
  ruleId: string;
};

export const TRANSITION_MATRIX = [
  {
    from: "NEW",
    to: "EVIDENCE_COLLECTION",
    triggers: ["CASE_INTAKE_STARTED"],
    ruleId: "NEW_TO_EVIDENCE_COLLECTION",
  },
  {
    from: "EVIDENCE_COLLECTION",
    to: "INVESTIGATING",
    triggers: ["INITIAL_EVIDENCE_RECORDED"],
    ruleId: "EVIDENCE_COLLECTION_TO_INVESTIGATING",
  },
  {
    from: "INVESTIGATING",
    to: "WAITING_EXTERNAL",
    triggers: ["EXTERNAL_EVIDENCE_REQUESTED"],
    ruleId: "INVESTIGATING_TO_WAITING_EXTERNAL",
  },
  {
    from: "INVESTIGATING",
    to: "ACTION_REQUIRED",
    triggers: ["USER_ACTION_REQUIRED"],
    ruleId: "INVESTIGATING_TO_ACTION_REQUIRED",
  },
  {
    from: "INVESTIGATING",
    to: "ESCALATION_REQUIRED",
    triggers: ["ESCALATION_NEEDED"],
    ruleId: "INVESTIGATING_TO_ESCALATION_REQUIRED",
  },
  {
    from: "INVESTIGATING",
    to: "RESOLUTION_PENDING",
    triggers: ["RESOLUTION_PROVISIONAL"],
    ruleId: "INVESTIGATING_TO_RESOLUTION_PENDING",
  },
  {
    from: "WAITING_EXTERNAL",
    to: "INVESTIGATING",
    triggers: ["RELEVANT_EVIDENCE_RECEIVED"],
    ruleId: "WAITING_EXTERNAL_TO_INVESTIGATING",
  },
  {
    from: "ACTION_REQUIRED",
    to: "INVESTIGATING",
    triggers: ["REQUIRED_ACTION_COMPLETED", "RELEVANT_EVIDENCE_RECEIVED"],
    ruleId: "ACTION_REQUIRED_TO_INVESTIGATING",
  },
  {
    from: "ESCALATION_REQUIRED",
    to: "INVESTIGATING",
    triggers: ["ESCALATION_COMPLETED", "RELEVANT_EVIDENCE_RECEIVED"],
    ruleId: "ESCALATION_REQUIRED_TO_INVESTIGATING",
  },
  {
    from: "RESOLUTION_PENDING",
    to: "RESOLVED",
    triggers: ["RESOLUTION_EVIDENCE_SATISFIED"],
    ruleId: "RESOLUTION_PENDING_TO_RESOLVED",
  },
  {
    from: "RESOLUTION_PENDING",
    to: "INVESTIGATING",
    triggers: ["RESOLUTION_EVIDENCE_INVALIDATED"],
    ruleId: "RESOLUTION_PENDING_TO_INVESTIGATING",
  },
  {
    from: "RESOLVED",
    to: "INVESTIGATING",
    triggers: ["CASE_REOPENED"],
    ruleId: "RESOLVED_TO_INVESTIGATING",
  },
  {
    from: "RESOLVED",
    to: "CLOSED",
    triggers: ["CASE_CLOSED"],
    ruleId: "RESOLVED_TO_CLOSED",
  },
] as const satisfies readonly TransitionRule[];

export type TransitionInput = {
  caseRecord: ResolutionCase;
  targetState: CaseState;
  triggerEvent: ResolutionEvent;
  reason: string;
  evidenceIds: string[];
  occurredAt: string;
  auditId: string;
};

export type TransitionPlanResult =
  | {
      ok: true;
      caseRecord: ResolutionCase;
      auditRecord: AuditRecord;
    }
  | {
      ok: false;
      error: "INVALID_TRANSITION" | "INVALID_TRANSITION_CONTEXT";
    };

export function isTerminalState(state: CaseState): boolean {
  return state === "CLOSED";
}

export function planCaseTransition(
  input: TransitionInput,
): TransitionPlanResult {
  const rule = TRANSITION_MATRIX.find(
    (candidate) =>
      candidate.from === input.caseRecord.state &&
      candidate.to === input.targetState,
  );

  if (!rule) {
    return { ok: false, error: "INVALID_TRANSITION" };
  }

  if (
    input.triggerEvent.caseId !== input.caseRecord.id ||
    !rule.triggers.some((trigger) => trigger === input.triggerEvent.kind) ||
    input.reason.trim().length === 0
  ) {
    return { ok: false, error: "INVALID_TRANSITION_CONTEXT" };
  }

  if (
    input.triggerEvent.kind === "CASE_REOPENED" &&
    input.evidenceIds.length === 0
  ) {
    return { ok: false, error: "INVALID_TRANSITION_CONTEXT" };
  }

  const nextCase: ResolutionCase = {
    ...input.caseRecord,
    state: input.targetState,
    version: input.caseRecord.version + 1,
    updatedAt: input.occurredAt,
  };

  if (input.targetState === "RESOLVED") {
    nextCase.resolvedAt = input.occurredAt;
  }

  if (input.targetState === "CLOSED") {
    nextCase.closedAt = input.occurredAt;
  }

  if (
    input.caseRecord.state === "RESOLVED" &&
    input.targetState === "INVESTIGATING"
  ) {
    delete nextCase.resolvedAt;
  }

  return {
    ok: true,
    caseRecord: nextCase,
    auditRecord: {
      id: input.auditId,
      caseId: input.caseRecord.id,
      timestamp: input.occurredAt,
      triggeringEventId: input.triggerEvent.id,
      ruleId: rule.ruleId,
      actor: {
        category: input.triggerEvent.source.category,
        id:
          input.triggerEvent.source.actorId ??
          input.triggerEvent.source.provider ??
          "resolvia-engine",
      },
      previousState: input.caseRecord.state,
      resultingState: input.targetState,
      reason: input.reason.trim(),
      evidenceIds: [...input.evidenceIds],
      changedFields: ["state", "version", "updatedAt"],
    },
  };
}
