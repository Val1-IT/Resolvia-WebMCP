import type { AuditRecord } from "@/src/domain/audit/model";
import type { PartyRecord, ResolutionCase } from "@/src/domain/cases/model";
import type { ClaimRecord } from "@/src/domain/claims/model";
import type { EvidenceRecord } from "@/src/domain/evidence/model";
import type { ResolutionEvent } from "@/src/domain/events/model";
import type { ProviderTransactionRecord } from "@/src/domain/transactions/model";
import {
  CaseMutationSchema,
  type CaseMutation,
  type CommitResult,
  type ResolutionSnapshot,
} from "@/src/domain/store/model";

export type ApplyMutationResult = {
  result: CommitResult;
  snapshot: ResolutionSnapshot;
};

export function applyCaseMutation(
  stored: ResolutionSnapshot,
  input: CaseMutation,
): ApplyMutationResult {
  const parsed = CaseMutationSchema.safeParse(input);
  if (!parsed.success) {
    return unchanged(stored, "CASE_INTEGRITY_ERROR");
  }

  const mutation = parsed.data;
  if (authoritativeWriteCount(mutation) > 100) {
    return unchanged(stored, "CASE_INTEGRITY_ERROR");
  }

  const storedCase = stored.cases.find(
    (candidate) => candidate.id === mutation.caseRecord.id,
  );
  const versionResult = validateVersion(storedCase, mutation);
  if (versionResult) return unchanged(stored, versionResult);

  if (!hasValidPartyOwnership(stored, mutation.caseRecord)) {
    return unchanged(stored, "CASE_INTEGRITY_ERROR");
  }

  if (!allMutationRecordsBelongToCase(mutation)) {
    return unchanged(stored, "CASE_INTEGRITY_ERROR");
  }

  if (hasDuplicateEventId(stored.events, mutation.eventsToAppend)) {
    return unchanged(stored, "DUPLICATE_EVENT");
  }

  if (
    hasDuplicateAppendOnlyId(stored.evidence, mutation.evidenceToAdd) ||
    hasDuplicateAppendOnlyId(stored.auditRecords, mutation.auditRecordsToAppend) ||
    hasDuplicateAppendOnlyId(
      stored.providerTransactions,
      mutation.transactionsToAdd,
    ) ||
    hasDuplicateProviderObject(stored.providerTransactions, mutation.transactionsToAdd) ||
    hasDuplicateIds(mutation.claimsToSave.map((claim) => claim.id)) ||
    mutation.claimsToSave.some((claim) =>
      stored.claims.some(
        (storedClaim) =>
          storedClaim.id === claim.id && storedClaim.caseId !== claim.caseId,
      ),
    ) ||
    hasDuplicateAutomationRequest(stored, mutation) ||
    hasInvalidDeadline(stored, mutation)
  ) {
    return unchanged(stored, "CASE_INTEGRITY_ERROR");
  }

  const combinedEvents = [...stored.events, ...mutation.eventsToAppend];
  const combinedEvidence = [...stored.evidence, ...mutation.evidenceToAdd];
  const combinedClaims = upsertClaims(stored.claims, mutation.claimsToSave);
  const combinedAudits = [
    ...stored.auditRecords,
    ...mutation.auditRecordsToAppend,
  ];
  const combinedTransactions = [
    ...stored.providerTransactions,
    ...mutation.transactionsToAdd,
  ];

  if (
    !referencesAreValid({
      caseRecord: mutation.caseRecord,
      storedCase,
      newEvents: mutation.eventsToAppend,
      newAudits: mutation.auditRecordsToAppend,
      events: combinedEvents,
      evidence: combinedEvidence,
      claims: combinedClaims,
      audits: combinedAudits,
      transactions: combinedTransactions,
    })
  ) {
    return unchanged(stored, "CASE_INTEGRITY_ERROR");
  }

  return {
    result: "COMMITTED",
    snapshot: {
      cases: upsertCase(stored.cases, mutation.caseRecord),
      events: combinedEvents,
      evidence: combinedEvidence,
      claims: combinedClaims,
      auditRecords: combinedAudits,
      providerTransactions: combinedTransactions,
      agentRuns: stored.agentRuns,
      partnerRequests: stored.partnerRequests ?? [],
      partnerTokenReceipts: stored.partnerTokenReceipts ?? [],
      automationRequests: [
        ...(stored.automationRequests ?? []),
        ...(mutation.automationRequestsToCreate ?? []),
      ],
      deadlines: upsertById(stored.deadlines ?? [], mutation.deadlinesToSave ?? []),
    },
  };
}

function upsertById<T extends { id: string }>(stored: T[], incoming: T[]): T[] {
  const incomingIds = new Set(incoming.map((record) => record.id));
  return [...stored.filter((record) => !incomingIds.has(record.id)), ...incoming];
}

function hasInvalidDeadline(stored: ResolutionSnapshot, mutation: CaseMutation): boolean {
  const incoming = mutation.deadlinesToSave ?? [];
  return incoming.some((deadline) =>
    deadline.caseId !== mutation.caseRecord.id ||
    deadline.basedOnCaseVersion !== mutation.caseRecord.version ||
    (stored.deadlines ?? []).some((existing) => existing.id === deadline.id && existing.caseId !== deadline.caseId)
  ) || hasDuplicateIds(incoming.map((deadline) => deadline.id));
}

function unchanged(
  snapshot: ResolutionSnapshot,
  result: Exclude<CommitResult, "COMMITTED">,
): ApplyMutationResult {
  return { result, snapshot };
}

function validateVersion(
  storedCase: ResolutionCase | undefined,
  mutation: CaseMutation,
): "VERSION_CONFLICT" | null {
  if (mutation.expectedCaseVersion === null) {
    return !storedCase && mutation.caseRecord.version === 1
      ? null
      : "VERSION_CONFLICT";
  }

  if (
    !storedCase ||
    mutation.expectedCaseVersion !== storedCase.version ||
    mutation.caseRecord.version !== storedCase.version + 1
  ) {
    return "VERSION_CONFLICT";
  }

  return null;
}

function hasValidPartyOwnership(
  stored: ResolutionSnapshot,
  caseRecord: ResolutionCase,
): boolean {
  const storedCase = stored.cases.find((candidate) => candidate.id === caseRecord.id);
  if (storedCase && storedCase.ownerUserId !== caseRecord.ownerUserId) return false;
  const partyIds = caseRecord.parties.map((party) => party.id);
  if (
    hasDuplicateIds(partyIds) ||
    caseRecord.parties.some((party) => party.caseId !== caseRecord.id)
  ) {
    return false;
  }

  return !stored.cases.some(
    (otherCase) =>
      otherCase.id !== caseRecord.id &&
      otherCase.parties.some((party) => partyIds.includes(party.id)),
  );
}

function allMutationRecordsBelongToCase(mutation: CaseMutation): boolean {
  const caseId = mutation.caseRecord.id;
  return [
    ...mutation.eventsToAppend,
    ...mutation.evidenceToAdd,
    ...mutation.claimsToSave,
    ...mutation.auditRecordsToAppend,
    ...mutation.transactionsToAdd,
  ].every((record) => record.caseId === caseId);
}

function hasDuplicateAutomationRequest(
  stored: ResolutionSnapshot,
  mutation: CaseMutation,
): boolean {
  const incoming = mutation.automationRequestsToCreate ?? [];
  const storedKeys = new Set((stored.automationRequests ?? []).map((request) => request.automationKey));
  return (
    incoming.some((request) => request.caseId !== mutation.caseRecord.id || request.basedOnCaseVersion !== mutation.caseRecord.version) ||
    hasDuplicateIds(incoming.map((request) => request.id)) ||
    hasDuplicateIds(incoming.map((request) => request.automationKey)) ||
    incoming.some((request) => storedKeys.has(request.automationKey))
  );
}

function hasDuplicateEventId(
  stored: ResolutionEvent[],
  incoming: ResolutionEvent[],
): boolean {
  return hasDuplicateAppendOnlyId(stored, incoming);
}

function hasDuplicateAppendOnlyId<T extends { id: string }>(
  stored: T[],
  incoming: T[],
): boolean {
  const existingIds = new Set(stored.map((record) => record.id));
  const incomingIds = incoming.map((record) => record.id);
  return (
    hasDuplicateIds(incomingIds) ||
    incomingIds.some((id) => existingIds.has(id))
  );
}

function hasDuplicateIds(ids: string[]): boolean {
  return new Set(ids).size !== ids.length;
}

function hasDuplicateProviderObject(
  stored: ProviderTransactionRecord[],
  incoming: ProviderTransactionRecord[],
): boolean {
  const key = (record: ProviderTransactionRecord) =>
    `${record.caseId}\u0000${record.provider}\u0000${record.providerObjectId}`;
  const storedKeys = new Set(stored.map(key));
  const incomingKeys = incoming.map(key);
  return (
    hasDuplicateIds(incomingKeys) ||
    incomingKeys.some((providerObjectKey) => storedKeys.has(providerObjectKey))
  );
}

type ReferenceView = {
  caseRecord: ResolutionCase;
  storedCase: ResolutionCase | undefined;
  newEvents: ResolutionEvent[];
  newAudits: AuditRecord[];
  events: ResolutionEvent[];
  evidence: EvidenceRecord[];
  claims: ClaimRecord[];
  audits: AuditRecord[];
  transactions: ProviderTransactionRecord[];
};

function referencesAreValid(view: ReferenceView): boolean {
  const caseId = view.caseRecord.id;
  const partyIds = idsForCase(view.caseRecord.parties, caseId);
  const eventsById = recordsById(view.events);
  const evidenceById = recordsById(view.evidence);
  const claimsById = recordsById(view.claims);

  const caseClaims = view.claims.filter((claim) => claim.caseId === caseId);
  const caseEvidence = view.evidence.filter(
    (evidence) => evidence.caseId === caseId,
  );
  const caseAudits = view.audits.filter((audit) => audit.caseId === caseId);
  const caseTransactions = view.transactions.filter(
    (transaction) => transaction.caseId === caseId,
  );

  if (
    caseClaims.some(
      (claim) =>
        !partyIds.has(claim.claimantPartyId) ||
        !isRecordInCase(eventsById.get(claim.sourceEventId), caseId) ||
        claim.evidenceRelationships.some(
          (relationship) =>
            !isRecordInCase(evidenceById.get(relationship.evidenceId), caseId),
        ),
    )
  ) {
    return false;
  }

  if (
    caseEvidence.some((evidence) =>
      evidence.relatedClaimIds.some(
        (claimId) => !isRecordInCase(claimsById.get(claimId), caseId),
      ),
    )
  ) {
    return false;
  }

  if (
    caseAudits.some(
      (audit) =>
        !isRecordInCase(eventsById.get(audit.triggeringEventId), caseId) ||
        audit.evidenceIds.some(
          (evidenceId) =>
            !isRecordInCase(evidenceById.get(evidenceId), caseId),
        ),
    )
  ) {
    return false;
  }

  if (
    view.newEvents.some(
      (event) =>
        event.causationId !== undefined &&
        (event.causationId === event.id ||
          !isRecordInCase(eventsById.get(event.causationId), caseId)),
    )
  ) {
    return false;
  }

  if (
    caseTransactions.some((transaction) =>
      !evidenceAuthenticatesProviderTransaction(
        transaction,
        evidenceById.get(transaction.evidenceId),
      ),
    )
  ) {
    return false;
  }

  if (view.storedCase && view.storedCase.state !== view.caseRecord.state) {
    const matchingAudit = view.newAudits.some(
      (audit) =>
        audit.previousState === view.storedCase?.state &&
        audit.resultingState === view.caseRecord.state,
    );
    if (!matchingAudit) return false;
  }

  return view.newAudits.every(
    (audit) =>
      !view.storedCase ||
      (audit.previousState === view.storedCase.state &&
        audit.resultingState === view.caseRecord.state),
  );
}

function authoritativeWriteCount(mutation: CaseMutation): number {
  return (
    1 +
    mutation.eventsToAppend.length +
    mutation.evidenceToAdd.length +
    mutation.claimsToSave.length +
    mutation.auditRecordsToAppend.length +
    mutation.transactionsToAdd.length
    + (mutation.automationRequestsToCreate?.length ?? 0)
    + (mutation.deadlinesToSave?.length ?? 0)
  );
}

function evidenceAuthenticatesProviderTransaction(
  transaction: ProviderTransactionRecord,
  evidence: EvidenceRecord | undefined,
): boolean {
  if (
    !evidence ||
    evidence.caseId !== transaction.caseId ||
    evidence.sourceProvider !== transaction.provider
  ) {
    return false;
  }

  return transaction.provider === "stripe"
    ? evidence.verificationLevel === "PROVIDER_VERIFIED"
    : evidence.verificationLevel === "DEMO_PROVIDER_VERIFIED";
}

function idsForCase(records: PartyRecord[], caseId: string): Set<string> {
  return new Set(
    records.filter((record) => record.caseId === caseId).map((record) => record.id),
  );
}

function recordsById<T extends { id: string }>(records: T[]): Map<string, T> {
  return new Map(records.map((record) => [record.id, record]));
}

function isRecordInCase(
  record: { caseId: string } | undefined,
  caseId: string,
): boolean {
  return record?.caseId === caseId;
}

function upsertCase(
  stored: ResolutionCase[],
  incoming: ResolutionCase,
): ResolutionCase[] {
  const existingIndex = stored.findIndex((record) => record.id === incoming.id);
  if (existingIndex < 0) return [...stored, incoming];
  return stored.map((record, index) =>
    index === existingIndex ? incoming : record,
  );
}

function upsertClaims(
  stored: ClaimRecord[],
  incoming: ClaimRecord[],
): ClaimRecord[] {
  const updates = new Map(incoming.map((claim) => [claim.id, claim]));
  const result = stored.map((claim) => updates.get(claim.id) ?? claim);
  const storedIds = new Set(stored.map((claim) => claim.id));
  result.push(...incoming.filter((claim) => !storedIds.has(claim.id)));
  return result;
}
