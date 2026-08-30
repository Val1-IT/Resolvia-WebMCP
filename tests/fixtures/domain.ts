import { AuditRecordSchema, type AuditRecord } from "@/src/domain/audit/model";
import {
  ResolutionCaseSchema,
  type ResolutionCase,
} from "@/src/domain/cases/model";
import { ClaimRecordSchema, type ClaimRecord } from "@/src/domain/claims/model";
import {
  EvidenceRecordSchema,
  type EvidenceRecord,
} from "@/src/domain/evidence/model";
import {
  ResolutionEventSchema,
  type ResolutionEvent,
} from "@/src/domain/events/model";
import {
  ProviderTransactionRecordSchema,
  type ProviderTransactionRecord,
} from "@/src/domain/transactions/model";
import type {
  CaseMutation,
  ResolutionCaseBundle,
  ResolutionSnapshot,
} from "@/src/domain/store/model";

export const FIXED_NOW = "2026-08-09T10:00:00.000Z";

export function makeCase(
  overrides: Partial<ResolutionCase> = {},
): ResolutionCase {
  return ResolutionCaseSchema.parse({
    id: "case-rv-1028",
    displayId: "RV-1028",
    ownerUserId: "resolvia-demo-user",
    issueType: "SAAS_SUBSCRIPTION_REFUND",
    title: "SaaS subscription refund",
    summary: "Merchant claims refund processed.",
    state: "NEW",
    version: 1,
    parties: [
      {
        id: "party-merchant",
        caseId: "case-rv-1028",
        kind: "MERCHANT",
        name: "Northstar SaaS",
      },
      {
        id: "party-customer",
        caseId: "case-rv-1028",
        kind: "CUSTOMER",
        name: "Demo Customer",
      },
    ],
    currentBlocker: "Initial evidence not collected.",
    nextBestAction: "Collect initial evidence.",
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  });
}

export function makeEvent(
  overrides: Partial<ResolutionEvent> = {},
): ResolutionEvent {
  return ResolutionEventSchema.parse({
    id: "event-intake",
    caseId: "case-rv-1028",
    kind: "CASE_INTAKE_STARTED",
    source: { category: "SYSTEM", runtimeMode: "LOCAL" },
    occurredAt: FIXED_NOW,
    receivedAt: FIXED_NOW,
    correlationId: "corr-rv-1028",
    payload: {},
    ...overrides,
  });
}

export function makeEvidence(
  overrides: Partial<EvidenceRecord> = {},
): EvidenceRecord {
  return EvidenceRecordSchema.parse({
    id: "evidence-merchant-message",
    caseId: "case-rv-1028",
    type: "COMMUNICATION",
    source: "Merchant support message",
    contentSummary: "Merchant states the refund was processed.",
    verificationLevel: "AUTHENTICATED_SOURCE",
    retrievedAt: FIXED_NOW,
    createdAt: FIXED_NOW,
    metadata: {},
    relatedClaimIds: ["claim-refund-processed"],
    ...overrides,
  });
}

export function makeClaim(
  overrides: Partial<ClaimRecord> = {},
): ClaimRecord {
  return ClaimRecordSchema.parse({
    id: "claim-refund-processed",
    caseId: "case-rv-1028",
    statement: "Refund processed",
    claimantPartyId: "party-merchant",
    sourceEventId: "event-initial-evidence",
    status: "UNVERIFIED",
    evidenceRelationships: [
      {
        evidenceId: "evidence-merchant-message",
        kind: "AUTHENTICATES_ASSERTION",
      },
    ],
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  });
}

export function makeAudit(
  overrides: Partial<AuditRecord> = {},
): AuditRecord {
  return AuditRecordSchema.parse({
    id: "audit-transition-1",
    caseId: "case-rv-1028",
    timestamp: FIXED_NOW,
    triggeringEventId: "event-intake",
    ruleId: "NEW_TO_EVIDENCE_COLLECTION",
    actor: { category: "SYSTEM", id: "resolvia-engine" },
    previousState: "NEW",
    resultingState: "EVIDENCE_COLLECTION",
    reason: "Case intake started.",
    evidenceIds: [],
    changedFields: ["state", "version", "updatedAt"],
    ...overrides,
  });
}

export function makeProviderTransaction(
  overrides: Partial<ProviderTransactionRecord> = {},
): ProviderTransactionRecord {
  return ProviderTransactionRecordSchema.parse({
    id: "transaction-stripe-refund-re-test",
    caseId: "case-rv-1028",
    provider: "stripe",
    providerObjectId: "re_test_refund",
    kind: "REFUND",
    status: "PENDING",
    evidenceId: "evidence-stripe-refund-re-test",
    observedAt: FIXED_NOW,
    createdAt: FIXED_NOW,
    ...overrides,
  });
}

export const emptySnapshot = (): ResolutionSnapshot => ({
  cases: [],
  events: [],
  evidence: [],
  claims: [],
  auditRecords: [],
  providerTransactions: [],
  agentRuns: [],
  partnerRequests: [],
  partnerTokenReceipts: [],
});

export const snapshotWithCase = (version: number): ResolutionSnapshot => ({
  ...emptySnapshot(),
  cases: [makeCase({ version })],
});

export function makeMutation(
  overrides: Partial<CaseMutation> = {},
): CaseMutation {
  return {
    caseRecord: makeCase({ version: 2 }),
    expectedCaseVersion: 1,
    eventsToAppend: [],
    evidenceToAdd: [],
    claimsToSave: [],
    auditRecordsToAppend: [],
    transactionsToAdd: [],
    ...overrides,
  };
}

export function snapshotWithTwoCases(): ResolutionSnapshot {
  return {
    cases: [
      makeCase(),
      makeCase({ id: "case-other", displayId: "RV-OTHER", parties: [] }),
    ],
    events: [],
    evidence: [
      makeEvidence({
        id: "evidence-other",
        caseId: "case-other",
        relatedClaimIds: [],
      }),
    ],
    claims: [],
    auditRecords: [],
    providerTransactions: [],
    agentRuns: [],
    partnerRequests: [],
    partnerTokenReceipts: [],
  };
}

export const crossCaseClaimMutation = (): CaseMutation =>
  makeMutation({
    claimsToSave: [
      makeClaim({
        evidenceRelationships: [
          {
            evidenceId: "evidence-other",
            kind: "SUPPORTS_PROPOSITION",
          },
        ],
      }),
    ],
  });

export const createCaseMutation = (): CaseMutation => ({
  caseRecord: makeCase({ version: 1 }),
  expectedCaseVersion: null,
  eventsToAppend: [],
  evidenceToAdd: [],
  claimsToSave: [],
  auditRecordsToAppend: [],
  transactionsToAdd: [],
});

export const nextMutation = (): CaseMutation => makeMutation();

export function initialRefundBundle(): ResolutionCaseBundle {
  return {
    caseRecord: makeCase({
      state: "INVESTIGATING",
      version: 4,
      currentBlocker:
        "Refund transaction has not yet been independently verified.",
      nextBestAction: "Obtain traceable provider evidence.",
    }),
    events: [
      makeEvent(),
      makeEvent({
        id: "event-initial-evidence",
        kind: "INITIAL_EVIDENCE_RECORDED",
      }),
    ],
    evidence: [makeEvidence()],
    claims: [makeClaim()],
    auditRecords: [
      makeAudit(),
      makeAudit({
        id: "audit-transition-2",
        triggeringEventId: "event-initial-evidence",
        ruleId: "EVIDENCE_COLLECTION_TO_INVESTIGATING",
        previousState: "EVIDENCE_COLLECTION",
        resultingState: "INVESTIGATING",
        reason: "Initial evidence recorded.",
      }),
    ],
    providerTransactions: [],
    agentRuns: [],
    partnerRequests: [],
    partnerTokenReceipts: [],
  };
}
