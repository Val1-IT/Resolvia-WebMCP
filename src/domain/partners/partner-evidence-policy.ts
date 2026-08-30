import { z } from "zod";

import { AuditRecordSchema } from "@/src/domain/audit/model";
import { ClaimRecordSchema } from "@/src/domain/claims/model";
import { EvidenceRecordSchema } from "@/src/domain/evidence/model";
import type { ResolutionEvent } from "@/src/domain/events/model";
import type { CaseMutation, ResolutionCaseBundle } from "@/src/domain/store/model";

const PartnerEvidencePayloadSchema = z.object({
  partnerRequestId: z.string().min(1).max(128),
  requestedEvidenceType: z.enum(["SETTLEMENT_OCCURRED", "CUSTOMER_RECEIPT"]),
  responseStatus: z.enum(["CONFIRMED", "NOT_CONFIRMED"]),
  responseReference: z.string().min(1).max(128),
  responseSummary: z.string().min(1).max(500),
}).strict();

export type PartnerEvidencePolicyResult =
  | { ok: true; mutation: CaseMutation }
  | { ok: false; error: "INVALID_PARTNER_EVENT" };

export function planPartnerEvidenceMutation(
  bundle: ResolutionCaseBundle,
  event: ResolutionEvent,
  now: () => string,
): PartnerEvidencePolicyResult {
  const payload = PartnerEvidencePayloadSchema.safeParse(event.payload);
  const request = (bundle.partnerRequests ?? []).find(
    (record) => record.id === payload.data?.partnerRequestId,
  );
  const receipt = (bundle.partnerTokenReceipts ?? []).find(
    (record) => record.requestId === request?.id,
  );
  if (
    !payload.success ||
    event.caseId !== bundle.caseRecord.id ||
    event.kind !== "PARTNER_EVIDENCE_SUBMITTED" ||
    event.source.category !== "PARTNER" ||
    event.source.runtimeMode !== "CONNECTED" ||
    event.source.provider !== "resolvia_demo_partner" ||
    event.source.actorId !== "resolvia-demo-partner" ||
    event.correlationId !== payload.data.partnerRequestId ||
    !request ||
    !receipt ||
    request.caseId !== event.caseId ||
    request.requestedEvidenceType !== payload.data.requestedEvidenceType ||
    receipt.caseId !== event.caseId ||
    receipt.state !== "PUBLISHED" ||
    receipt.submissionEventId !== event.id
  ) {
    return { ok: false, error: "INVALID_PARTNER_EVENT" };
  }

  const committedAt = now();
  const evidenceId = `evidence:${event.id}`;
  const partnerPartyId = `party:resolvia_demo_partner:${event.caseId}`;
  const claimId = `claim:partner:${payload.data.requestedEvidenceType.toLowerCase()}:${request.id}`;
  const relationshipKind = payload.data.responseStatus === "CONFIRMED"
    ? "SUPPORTS_PROPOSITION" as const
    : "CONTRADICTS_PROPOSITION" as const;
  const existingPartner = bundle.caseRecord.parties.find((party) => party.id === partnerPartyId);
  if (existingPartner && (existingPartner.caseId !== event.caseId || existingPartner.kind !== "PARTNER")) {
    return { ok: false, error: "INVALID_PARTNER_EVENT" };
  }

  const evidence = EvidenceRecordSchema.parse({
    id: evidenceId,
    caseId: event.caseId,
    type: "PARTNER_RESPONSE",
    source: "Resolvia Demo Partner structured response",
    sourceProvider: "resolvia_demo_partner",
    externalReference: payload.data.responseReference,
    contentSummary: payload.data.responseSummary,
    verificationLevel: "PARTNER_VERIFIED",
    retrievedAt: committedAt,
    createdAt: committedAt,
    metadata: {
      partnerRequestId: request.id,
      requestedEvidenceType: request.requestedEvidenceType,
      responseStatus: payload.data.responseStatus,
    },
    relatedClaimIds: [claimId],
  });
  const statement = request.requestedEvidenceType === "CUSTOMER_RECEIPT"
    ? "Customer receipt of the refund is confirmed."
    : "Settlement of the refund is confirmed.";
  const claim = ClaimRecordSchema.parse({
    id: claimId,
    caseId: event.caseId,
    statement,
    claimantPartyId: partnerPartyId,
    sourceEventId: event.id,
    status: payload.data.responseStatus === "CONFIRMED" ? "SUPPORTED" : "CONTRADICTED",
    evidenceRelationships: [{ evidenceId, kind: relationshipKind }],
    createdAt: committedAt,
    updatedAt: committedAt,
  });
  const receiptConfirmed = request.requestedEvidenceType === "CUSTOMER_RECEIPT" && payload.data.responseStatus === "CONFIRMED";
  const providerSucceeded = bundle.providerTransactions.some((transaction) => transaction.status === "SUCCEEDED");
  const resultingState = receiptConfirmed && providerSucceeded
    ? "RESOLUTION_PENDING" as const
    : bundle.caseRecord.state;
  const caseRecord = {
    ...bundle.caseRecord,
    state: resultingState,
    version: bundle.caseRecord.version + 1,
    parties: existingPartner ? bundle.caseRecord.parties : [
      ...bundle.caseRecord.parties,
      { id: partnerPartyId, caseId: event.caseId, kind: "PARTNER" as const, name: "Resolvia Demo Partner" },
    ],
    currentBlocker: resultingState === "RESOLUTION_PENDING"
      ? "Resolution evidence is assembled and awaits deterministic closure review."
      : bundle.caseRecord.currentBlocker,
    nextBestAction: resultingState === "RESOLUTION_PENDING"
      ? "Review the independently supported provider and customer-receipt evidence."
      : bundle.caseRecord.nextBestAction,
    updatedAt: committedAt,
  };
  const audit = AuditRecordSchema.parse({
    id: `audit:${event.id}`,
    caseId: event.caseId,
    timestamp: committedAt,
    triggeringEventId: event.id,
    ruleId: "PARTNER_EVIDENCE_RECORDED",
    actor: { category: "PARTNER", id: "resolvia-demo-partner" },
    previousState: bundle.caseRecord.state,
    resultingState,
    reason: "Partner evidence was recorded as independently scoped evidence.",
    evidenceIds: [evidenceId],
    changedFields: ["version", "updatedAt"],
  });

  return {
    ok: true,
    mutation: {
      caseRecord,
      expectedCaseVersion: bundle.caseRecord.version,
      eventsToAppend: [event],
      evidenceToAdd: [evidence],
      claimsToSave: [claim],
      auditRecordsToAppend: [audit],
      transactionsToAdd: [],
    },
  };
}