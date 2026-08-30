import type { ResolutionStore } from "@/src/application/ports/resolution-store";
import { transitionCase, TransitionCaseError } from "@/src/application/cases/transition-case";
import {
  RV_1028_CASE_ID,
  RV_1028_TIMESTAMPS,
  rv1028EvidenceEvent,
  rv1028InitialCase,
  rv1028IntakeEvent,
  rv1028MerchantMessage,
  rv1028RefundClaim,
} from "@/src/demo/rv-1028";

export async function seedDemoCase(store: ResolutionStore): Promise<void> {
  if (await store.loadCaseBundle(RV_1028_CASE_ID)) return;

  ensureCommitted(
    await store.commitCaseMutation({
      caseRecord: rv1028InitialCase,
      expectedCaseVersion: null,
      eventsToAppend: [],
      evidenceToAdd: [],
      claimsToSave: [],
      auditRecordsToAppend: [],
      transactionsToAdd: [],
    }),
  );

  await transitionCase(store, {
    caseId: RV_1028_CASE_ID,
    targetState: "EVIDENCE_COLLECTION",
    triggerEvent: rv1028IntakeEvent,
    reason: "Case intake started.",
    evidenceIds: [],
    occurredAt: RV_1028_TIMESTAMPS.intake,
    auditId: "audit-intake-to-evidence",
  });

  const evidenceCollection = await store.loadCaseBundle(RV_1028_CASE_ID);
  if (!evidenceCollection) throw new TransitionCaseError("CASE_NOT_FOUND");

  ensureCommitted(
    await store.commitCaseMutation({
      caseRecord: {
        ...evidenceCollection.caseRecord,
        version: evidenceCollection.caseRecord.version + 1,
        currentBlocker:
          "Refund transaction has not yet been independently verified.",
        nextBestAction: "Obtain traceable provider evidence.",
        updatedAt: RV_1028_TIMESTAMPS.evidence,
      },
      expectedCaseVersion: evidenceCollection.caseRecord.version,
      eventsToAppend: [rv1028EvidenceEvent],
      evidenceToAdd: [rv1028MerchantMessage],
      claimsToSave: [rv1028RefundClaim],
      auditRecordsToAppend: [],
      transactionsToAdd: [],
    }),
  );

  await transitionCase(store, {
    caseId: RV_1028_CASE_ID,
    targetState: "INVESTIGATING",
    triggerEvent: rv1028EvidenceEvent,
    reason: "Initial authenticated communication recorded; proposition verification remains open.",
    evidenceIds: [rv1028MerchantMessage.id],
    occurredAt: RV_1028_TIMESTAMPS.investigating,
    auditId: "audit-evidence-to-investigating",
  });
}

function ensureCommitted(result: Awaited<ReturnType<ResolutionStore["commitCaseMutation"]>>): void {
  if (result !== "COMMITTED") throw new TransitionCaseError(result);
}
