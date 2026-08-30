import {
  findConfirmedCustomerReceipt,
  findSucceededProviderOutcome,
  hasContradictionBlockingResolution,
} from "@/src/domain/automation/resolution-evidence-gates";
import { planCaseTransition } from "@/src/domain/cases/state-machine";
import type { CaseMutation, ResolutionCaseBundle } from "@/src/domain/store/model";

type Result =
  | { kind: "MUTATION"; mutation: CaseMutation }
  | {
      kind: "NO_CHANGE";
      reason:
        | "STATE_NOT_ELIGIBLE"
        | "PROVIDER_OUTCOME_UNKNOWN"
        | "CUSTOMER_RECEIPT_UNKNOWN"
        | "CONTRADICTION_PRESENT";
    };

export function planAutomatedResolutionEvaluation(
  bundle: ResolutionCaseBundle,
  now: string,
): Result {
  if (bundle.caseRecord.state !== "RESOLUTION_PENDING") {
    return { kind: "NO_CHANGE", reason: "STATE_NOT_ELIGIBLE" };
  }
  if (hasContradictionBlockingResolution(bundle)) {
    return { kind: "NO_CHANGE", reason: "CONTRADICTION_PRESENT" };
  }

  const providerOutcome = findSucceededProviderOutcome(bundle);
  if (!providerOutcome) {
    return { kind: "NO_CHANGE", reason: "PROVIDER_OUTCOME_UNKNOWN" };
  }

  const receiptEvidence = findConfirmedCustomerReceipt(bundle);
  if (!receiptEvidence) {
    return { kind: "NO_CHANGE", reason: "CUSTOMER_RECEIPT_UNKNOWN" };
  }

  const eventId = `automation:resolution:${bundle.caseRecord.id}:v${bundle.caseRecord.version}`;
  const event = {
    id: eventId,
    caseId: bundle.caseRecord.id,
    kind: "RESOLUTION_EVIDENCE_SATISFIED" as const,
    source: {
      category: "SYSTEM" as const,
      runtimeMode: "CONNECTED" as const,
      actorId: "resolvia-automation",
    },
    occurredAt: now,
    receivedAt: now,
    correlationId: eventId,
    payload: { policyVersion: "resolution-evaluation-v1" },
  };
  const evidenceIds = [providerOutcome.evidence.id, receiptEvidence.id];
  const transition = planCaseTransition({
    caseRecord: bundle.caseRecord,
    targetState: "RESOLVED",
    triggerEvent: event,
    reason:
      "Persisted same-case provider success and independently confirmed customer receipt satisfy deterministic resolution policy.",
    evidenceIds,
    occurredAt: now,
    auditId: `audit:${eventId}`,
  });
  if (!transition.ok) return { kind: "NO_CHANGE", reason: "STATE_NOT_ELIGIBLE" };
  return {
    kind: "MUTATION",
    mutation: {
      caseRecord: {
        ...transition.caseRecord,
        currentBlocker:
          "No unresolved evidence blocker remains for the demonstrated refund outcome.",
        nextBestAction: "Review the audit trail before closing the case.",
      },
      expectedCaseVersion: bundle.caseRecord.version,
      eventsToAppend: [event],
      evidenceToAdd: [],
      claimsToSave: [],
      auditRecordsToAppend: [
        {
          ...transition.auditRecord,
          changedFields: [
            ...transition.auditRecord.changedFields,
            "currentBlocker",
            "nextBestAction",
          ],
        },
      ],
      transactionsToAdd: [],
    },
  };
}
