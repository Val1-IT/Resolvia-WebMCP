import type { ResolutionStore } from "@/src/application/ports/resolution-store";
import {
  planCaseTransition,
  type TransitionInput,
} from "@/src/domain/cases/state-machine";
import type { CommitResult } from "@/src/domain/store/model";

export type TransitionCaseInput = Omit<TransitionInput, "caseRecord"> & {
  caseId: string;
};

export type TransitionCaseErrorCode =
  | "CASE_NOT_FOUND"
  | "INVALID_TRANSITION"
  | "INVALID_TRANSITION_CONTEXT"
  | Exclude<CommitResult, "COMMITTED">;

export class TransitionCaseError extends Error {
  constructor(public readonly code: TransitionCaseErrorCode) {
    super(`Case transition failed: ${code}`);
    this.name = "TransitionCaseError";
  }
}

export async function transitionCase(
  store: ResolutionStore,
  input: TransitionCaseInput,
) {
  const bundle = await store.loadCaseBundle(input.caseId);
  if (!bundle) throw new TransitionCaseError("CASE_NOT_FOUND");

  const plan = planCaseTransition({
    caseRecord: bundle.caseRecord,
    targetState: input.targetState,
    triggerEvent: input.triggerEvent,
    reason: input.reason,
    evidenceIds: input.evidenceIds,
    occurredAt: input.occurredAt,
    auditId: input.auditId,
  });
  if (!plan.ok) throw new TransitionCaseError(plan.error);

  const eventAlreadyStored = bundle.events.some(
    (event) => event.id === input.triggerEvent.id,
  );
  const result = await store.commitCaseMutation({
    caseRecord: plan.caseRecord,
    expectedCaseVersion: bundle.caseRecord.version,
    eventsToAppend: eventAlreadyStored ? [] : [input.triggerEvent],
    evidenceToAdd: [],
    claimsToSave: [],
    auditRecordsToAppend: [plan.auditRecord],
    transactionsToAdd: [],
  });

  if (result !== "COMMITTED") throw new TransitionCaseError(result);
  return plan.caseRecord;
}
