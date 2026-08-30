import type { ResolutionCase } from "@/src/domain/cases/model";
import type { ClaimRecord } from "@/src/domain/claims/model";
import type { EvidenceRecord } from "@/src/domain/evidence/model";
import type { ResolutionEvent } from "@/src/domain/events/model";

export const RV_1028_CASE_ID = "case-rv-1028";
export const RV_1028_CORRELATION_ID = "corr-rv-1028";

export const RV_1028_TIMESTAMPS = {
  created: "2026-08-09T10:00:00.000Z",
  intake: "2026-08-09T10:01:00.000Z",
  evidence: "2026-08-09T10:02:00.000Z",
  investigating: "2026-08-09T10:03:00.000Z",
} as const;

export const rv1028InitialCase: ResolutionCase = {
  id: RV_1028_CASE_ID,
  displayId: "RV-1028",
  ownerUserId: "resolvia-demo-user",
  issueType: "SAAS_SUBSCRIPTION_REFUND",
  title: "SaaS subscription refund",
  summary:
    "Northstar SaaS says a subscription refund was processed, but no provider transaction has been verified.",
  state: "NEW",
  version: 1,
  parties: [
    {
      id: "party-customer",
      caseId: RV_1028_CASE_ID,
      kind: "CUSTOMER",
      name: "Maya Chen",
    },
    {
      id: "party-merchant",
      caseId: RV_1028_CASE_ID,
      kind: "MERCHANT",
      name: "Northstar SaaS",
    },
  ],
  currentBlocker: "Initial evidence has not been collected.",
  nextBestAction: "Authenticate the merchant communication.",
  createdAt: RV_1028_TIMESTAMPS.created,
  updatedAt: RV_1028_TIMESTAMPS.created,
};

export const rv1028IntakeEvent: ResolutionEvent = {
  id: "event-intake",
  caseId: RV_1028_CASE_ID,
  kind: "CASE_INTAKE_STARTED",
  source: {
    category: "SYSTEM",
    runtimeMode: "LOCAL",
    actorId: "resolvia-local-seed",
  },
  occurredAt: RV_1028_TIMESTAMPS.intake,
  receivedAt: RV_1028_TIMESTAMPS.intake,
  correlationId: RV_1028_CORRELATION_ID,
  payload: { channel: "DETERMINISTIC_DEMO_SEED" },
};

export const rv1028EvidenceEvent: ResolutionEvent = {
  id: "event-initial-evidence",
  caseId: RV_1028_CASE_ID,
  kind: "INITIAL_EVIDENCE_RECORDED",
  source: {
    category: "SYSTEM",
    runtimeMode: "LOCAL",
    actorId: "resolvia-local-seed",
  },
  occurredAt: RV_1028_TIMESTAMPS.evidence,
  receivedAt: RV_1028_TIMESTAMPS.evidence,
  correlationId: RV_1028_CORRELATION_ID,
  causationId: rv1028IntakeEvent.id,
  payload: { evidenceId: "evidence-merchant-message" },
};

export const rv1028MerchantMessage: EvidenceRecord = {
  id: "evidence-merchant-message",
  caseId: RV_1028_CASE_ID,
  type: "COMMUNICATION",
  source: "Northstar SaaS support email",
  sourceProvider: "LOCAL_DEMO_FIXTURE",
  externalReference: "demo-message-northstar-001",
  contentSummary: 'Merchant states: “Your refund has been processed.”',
  verificationLevel: "AUTHENTICATED_SOURCE",
  retrievedAt: RV_1028_TIMESTAMPS.evidence,
  createdAt: RV_1028_TIMESTAMPS.evidence,
  metadata: {
    simulation: true,
    disclosure: "Deterministic local demo evidence; no live mailbox accessed.",
  },
  relatedClaimIds: ["claim-refund-processed"],
};

export const rv1028RefundClaim: ClaimRecord = {
  id: "claim-refund-processed",
  caseId: RV_1028_CASE_ID,
  statement: "Refund processed",
  claimantPartyId: "party-merchant",
  sourceEventId: rv1028EvidenceEvent.id,
  status: "UNVERIFIED",
  evidenceRelationships: [
    {
      evidenceId: rv1028MerchantMessage.id,
      kind: "AUTHENTICATES_ASSERTION",
    },
  ],
  createdAt: RV_1028_TIMESTAMPS.evidence,
  updatedAt: RV_1028_TIMESTAMPS.evidence,
};
