import type {
  DocumentData,
  DocumentReference,
  Firestore,
  Transaction,
} from "@google-cloud/firestore";

import type { ResolutionStore } from "@/src/application/ports/resolution-store";
import { AgentRunMutationSchema, type AgentRunMutation } from "@/src/domain/agent/model";
import { AutomationRequestRecordSchema, type AutomationClaimInput, type AutomationCompletionInput, type AutomationMutationResult, type AutomationRequestRecord } from "@/src/domain/automation/model";
import { claimAutomationRequest as applyClaim, compareAutomationRequests, completeAutomationRequest as applyCompletion } from "@/src/domain/automation/lease-policy";
import {
  PartnerRequestMutationSchema,
  PartnerRequestRecordSchema,
  PartnerSubmissionPublicationSchema,
  PartnerSubmissionReservationSchema,
  PartnerSubmissionReleaseSchema,
  PartnerTokenReceiptSchema,
  type PartnerRequestAccess,
  type PartnerRequestMutation,
  type PartnerSubmissionPublication,
  type PartnerSubmissionReservation,
  type PartnerSubmissionRelease,
} from "@/src/domain/partners/model";
import { applyPartnerRequestMutation } from "@/src/domain/partners/apply-mutation";
import { applyPartnerSubmissionReservation } from "@/src/domain/partners/apply-submission-reservation";
import { applyPartnerSubmissionPublication } from "@/src/domain/partners/apply-submission-publication";
import { applyPartnerSubmissionRelease } from "@/src/domain/partners/apply-submission-release";
import { applyAgentRunMutation } from "@/src/domain/store/apply-agent-run-mutation";
import {
  ResolutionSnapshotSchema,
  emptyResolutionSnapshot,
  type AppendAgentRunResult,
  type CreatePartnerRequestResult,
  type CaseMutation,
  type CommitResult,
  type ResolutionCaseBundle,
  type ResolutionSnapshot,
} from "@/src/domain/store/model";
import { classifyEventReceipts } from "@/src/infrastructure/google/firestore-event-receipts";
import { validateCaseMutationView } from "@/src/domain/store/validate-mutation";
import { resolutionEventDigest } from "@/src/domain/events/canonical";
import {
  firestoreCollection,
  firestoreDocumentId,
  providerObjectReceiptId,
  recordOwnershipId,
  toFirestoreData,
  type FirestoreCollectionName,
} from "@/src/infrastructure/google/firestore-codec";

const MAX_CASE_COLLECTION_RECORDS = 500;

export class CaseCollectionLimitExceededError extends Error {
  readonly code = "CASE_COLLECTION_LIMIT_EXCEEDED";
  constructor() {
    super("A case collection exceeds the local MVP safety limit.");
    this.name = "CaseCollectionLimitExceededError";
  }
}

type OwnedKind =
  | "party"
  | "event"
  | "evidence"
  | "claim"
  | "auditRecord"
  | "providerTransaction"
  | "agentRun"
  | "partnerRequest"
  | "partnerTokenReceipt"
  | "automationRequest"
  | "deadline";

type OwnedRecord = { kind: OwnedKind; id: string; caseId: string; appendOnly: boolean };

export class FirestoreResolutionStore implements ResolutionStore {
  constructor(
    private readonly firestore: Firestore,
    private readonly collectionPrefix: string,
  ) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(collectionPrefix)) {
      throw new Error("Invalid Firestore collection prefix.");
    }
  }

  async loadPartnerRequest(
    requestId: string,
  ): Promise<PartnerRequestAccess | null> {
    const requestSnapshot = await this.recordDoc("partnerRequests", requestId).get();
    if (!requestSnapshot.exists) return null;
    const request = PartnerRequestRecordSchema.parse(requestSnapshot.data());
    const receipts = await this.firestore
      .collection(firestoreCollection(this.collectionPrefix, "partnerTokenReceipts"))
      .where("requestId", "==", requestId)
      .limit(2)
      .get();
    if (receipts.size !== 1) return null;
    const tokenReceipt = PartnerTokenReceiptSchema.parse(receipts.docs[0]?.data());
    if (
      tokenReceipt.requestId !== request.id ||
      tokenReceipt.caseId !== request.caseId
    ) {
      return null;
    }
    return { request, tokenReceipt };
  }
  async getCaseOwnerUserId(caseId: string): Promise<string | null> {
    const snapshot = await this.recordDoc("cases", caseId).get();
    if (!snapshot.exists) return null;
    const parsed = ResolutionSnapshotSchema.shape.cases.element.safeParse(snapshot.data());
    return parsed.success ? parsed.data.ownerUserId : null;
  }
  async loadCaseBundle(caseId: string): Promise<ResolutionCaseBundle | null> {
    const snapshot = await this.loadCaseSnapshot(caseId);
    const caseRecord = snapshot.cases[0];
    return caseRecord ? bundleFromSnapshot(snapshot, caseRecord.id) : null;
  }

  async commitCaseMutation(mutation: CaseMutation): Promise<CommitResult> {
    return this.firestore.runTransaction(async (transaction) => {
      const eventReceiptRefs = mutation.eventsToAppend.map((event) =>
        this.doc("eventReceipts", firestoreDocumentId(event.id)),
      );
      const providerReceiptRefs = mutation.transactionsToAdd.map((record) =>
        this.doc(
          "providerObjectReceipts",
          providerObjectReceiptId(
            record.caseId,
            record.provider,
            record.providerObjectId,
          ),
        ),
      );
      const ownedRecords = ownedRecordsForMutation(mutation);
      const ownershipRefs = ownedRecords.map((record) =>
        this.doc(
          "recordOwnership",
          recordOwnershipId(record.kind, record.id),
        ),
      );

      const [stored, eventReceipts, providerReceipts, ownership] =
        await Promise.all([
          this.loadCaseSnapshotInTransaction(transaction, mutation.caseRecord.id),
          getAll(transaction, eventReceiptRefs),
          getAll(transaction, providerReceiptRefs),
          getAll(transaction, ownershipRefs),
        ]);

      const receiptResult = classifyEventReceipts(
        mutation.eventsToAppend,
        eventReceipts,
      );
      if (receiptResult) return receiptResult;
      if (providerReceipts.some((receipt) => receipt.exists)) {
        return "CASE_INTEGRITY_ERROR";
      }
      if (!ownershipIsValid(ownedRecords, ownership)) {
        return "CASE_INTEGRITY_ERROR";
      }

      const applied = validateCaseMutationView(stored, mutation);
      if (applied.result !== "COMMITTED") return applied.result;

      transaction.set(
        this.recordDoc("cases", mutation.caseRecord.id),
        toFirestoreData(mutation.caseRecord),
      );
      writeRecords(transaction, this, "events", mutation.eventsToAppend);
      writeRecords(transaction, this, "evidence", mutation.evidenceToAdd);
      writeRecords(transaction, this, "claims", mutation.claimsToSave);
      writeRecords(
        transaction,
        this,
        "auditRecords",
        mutation.auditRecordsToAppend,
      );
      writeRecords(
        transaction,
        this,
        "providerTransactions",
        mutation.transactionsToAdd,
      );
      writeRecords(transaction, this, "automationRequests", mutation.automationRequestsToCreate ?? []);
      writeRecords(transaction, this, "deadlines", mutation.deadlinesToSave ?? []);

      ownedRecords.forEach((record, index) => {
        if (!ownership[index]?.exists) {
          transaction.create(ownershipRefs[index]!, {
            kind: record.kind,
            recordId: record.id,
            caseId: record.caseId,
          });
        }
      });
      mutation.eventsToAppend.forEach((event, index) => {
        transaction.create(eventReceiptRefs[index]!, {
          eventId: event.id,
          caseId: event.caseId,
          receivedAt: event.receivedAt,
          payloadDigest: resolutionEventDigest(event),
        });
      });
      mutation.transactionsToAdd.forEach((record, index) => {
        transaction.create(providerReceiptRefs[index]!, {
          caseId: record.caseId,
          provider: record.provider,
          providerObjectId: record.providerObjectId,
          transactionId: record.id,
        });
      });

      return "COMMITTED";
    });
  }

  async reservePartnerSubmission(
    input: PartnerSubmissionReservation,
  ): Promise<CreatePartnerRequestResult> {
    const parsed = PartnerSubmissionReservationSchema.safeParse(input);
    if (!parsed.success) return "CASE_INTEGRITY_ERROR";
    return this.updatePartnerReceipt(parsed.data.requestId, (stored) =>
      applyPartnerSubmissionReservation(stored, parsed.data),
    );
  }

  async releasePartnerSubmission(
    input: PartnerSubmissionRelease,
  ): Promise<CreatePartnerRequestResult> {
    const parsed = PartnerSubmissionReleaseSchema.safeParse(input);
    if (!parsed.success) return "CASE_INTEGRITY_ERROR";
    return this.updatePartnerReceipt(parsed.data.requestId, (stored) =>
      applyPartnerSubmissionRelease(stored, parsed.data),
    );
  }

  async markPartnerSubmissionPublished(
    input: PartnerSubmissionPublication,
  ): Promise<CreatePartnerRequestResult> {
    const parsed = PartnerSubmissionPublicationSchema.safeParse(input);
    if (!parsed.success) return "CASE_INTEGRITY_ERROR";
    return this.updatePartnerReceipt(parsed.data.requestId, (stored) =>
      applyPartnerSubmissionPublication(stored, parsed.data),
    );
  }
  async createPartnerRequest(
    input: PartnerRequestMutation,
  ): Promise<CreatePartnerRequestResult> {
    const parsed = PartnerRequestMutationSchema.safeParse(input);
    if (!parsed.success) return "CASE_INTEGRITY_ERROR";
    const mutation = parsed.data;
    const requestOwnershipRef = this.doc(
      "recordOwnership",
      recordOwnershipId("partnerRequest", mutation.request.id),
    );
    const receiptOwnershipRef = this.doc(
      "recordOwnership",
      recordOwnershipId("partnerTokenReceipt", mutation.tokenReceipt.digest),
    );

    return this.firestore.runTransaction(async (transaction) => {
      const [stored, requestOwnership, receiptOwnership] = await Promise.all([
        this.loadCaseSnapshotInTransaction(transaction, mutation.request.caseId),
        transaction.get(requestOwnershipRef),
        transaction.get(receiptOwnershipRef),
      ]);
      if (requestOwnership.exists || receiptOwnership.exists) {
        return "CASE_INTEGRITY_ERROR";
      }

      const applied = applyPartnerRequestMutation(stored, mutation);
      if (applied.result !== "COMMITTED") return applied.result;

      transaction.create(
        this.recordDoc("partnerRequests", mutation.request.id),
        toFirestoreData(mutation.request),
      );
      transaction.create(
        this.recordDoc("partnerTokenReceipts", mutation.tokenReceipt.digest),
        toFirestoreData(mutation.tokenReceipt),
      );
      transaction.create(requestOwnershipRef, {
        kind: "partnerRequest",
        recordId: mutation.request.id,
        caseId: mutation.request.caseId,
      });
      transaction.create(receiptOwnershipRef, {
        kind: "partnerTokenReceipt",
        recordId: mutation.tokenReceipt.digest,
        caseId: mutation.tokenReceipt.caseId,
      });
      return "COMMITTED";
    });
  }
  async appendAgentRun(
    input: AgentRunMutation,
  ): Promise<AppendAgentRunResult> {
    const parsed = AgentRunMutationSchema.safeParse(input);
    if (!parsed.success) return "CASE_INTEGRITY_ERROR";
    const mutation = parsed.data;
    const ownershipRef = this.doc(
      "recordOwnership",
      recordOwnershipId("agentRun", mutation.agentRun.id),
    );

    return this.firestore.runTransaction(async (transaction) => {
      const [stored, ownership] = await Promise.all([
        this.loadCaseSnapshotInTransaction(transaction, mutation.agentRun.caseId),
        transaction.get(ownershipRef),
      ]);
      if (ownership.exists) return "CASE_INTEGRITY_ERROR";

      const applied = applyAgentRunMutation(stored, mutation);
      if (applied.result !== "COMMITTED") return applied.result;

      transaction.create(
        this.recordDoc("agentRuns", mutation.agentRun.id),
        toFirestoreData(mutation.agentRun),
      );
      transaction.create(ownershipRef, {
        kind: "agentRun",
        recordId: mutation.agentRun.id,
        caseId: mutation.agentRun.caseId,
      });
      return "COMMITTED";
    });
  }

  async listDueAutomationRequests(now: string, limit: number): Promise<AutomationRequestRecord[]> {
    const boundedLimit = Math.max(0, Math.min(limit, 50));
    if (boundedLimit === 0) return [];
    const snapshot = await this.firestore
      .collection(firestoreCollection(this.collectionPrefix, "automationRequests"))
      .where("nextAttemptAt", "<=", now)
      .limit(boundedLimit * 3)
      .get();
    const timestamp = Date.parse(now);
    return snapshot.docs
      .map((document) => AutomationRequestRecordSchema.parse(document.data()))
      .filter((request) =>
        request.state === "PENDING" || request.state === "FAILED_RETRYABLE" ||
        (request.state === "LEASED" && Boolean(request.leaseUntil) && Date.parse(request.leaseUntil!) <= timestamp))
      .sort(compareAutomationRequests)
      .slice(0, boundedLimit);
  }

  claimAutomationRequest(input: AutomationClaimInput): Promise<AutomationMutationResult> {
    return this.updateAutomation(input.requestId, (request) => applyClaim(request, input));
  }

  completeAutomationRequest(input: AutomationCompletionInput): Promise<AutomationMutationResult> {
    return this.updateAutomation(input.requestId, (request) => applyCompletion(request, input));
  }

  private updateAutomation(
    requestId: string,
    apply: (request: AutomationRequestRecord) => { ok: true; request: AutomationRequestRecord } | { ok: false },
  ): Promise<AutomationMutationResult> {
    return this.firestore.runTransaction(async (transaction) => {
      const reference = this.recordDoc("automationRequests", requestId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) return "NOT_FOUND";
      const result = apply(AutomationRequestRecordSchema.parse(snapshot.data()));
      if (!result.ok) return "NOT_CLAIMABLE";
      transaction.set(reference, toFirestoreData(result.request));
      return "COMMITTED";
    });
  }

  private async updatePartnerReceipt(
    requestId: string,
    apply: (snapshot: ResolutionSnapshot) => {
      result: CreatePartnerRequestResult;
      snapshot: ResolutionSnapshot;
    },
  ): Promise<CreatePartnerRequestResult> {
    return this.firestore.runTransaction(async (transaction) => {
      const requestSnapshot = await transaction.get(
        this.recordDoc("partnerRequests", requestId),
      );
      if (!requestSnapshot.exists) return "CASE_INTEGRITY_ERROR";
      const request = PartnerRequestRecordSchema.parse(requestSnapshot.data());
      const stored = await this.loadCaseSnapshotInTransaction(
        transaction,
        request.caseId,
      );
      const applied = apply(stored);
      if (applied.result !== "COMMITTED") return applied.result;
      const changedReceipt = (applied.snapshot.partnerTokenReceipts ?? []).find(
        (receipt) => receipt.requestId === requestId,
      );
      if (!changedReceipt) return "CASE_INTEGRITY_ERROR";
      transaction.set(
        this.recordDoc("partnerTokenReceipts", changedReceipt.digest),
        toFirestoreData(changedReceipt),
      );
      return "COMMITTED";
    });
  }
  recordDoc(
    collection: Exclude<FirestoreCollectionName, "recordOwnership" | "eventReceipts" | "providerObjectReceipts">,
    id: string,
  ): DocumentReference<DocumentData> {
    return this.doc(collection, firestoreDocumentId(id));
  }

  private doc(
    collection: FirestoreCollectionName,
    id: string,
  ): DocumentReference<DocumentData> {
    return this.firestore.collection(
      firestoreCollection(this.collectionPrefix, collection),
    ).doc(id);
  }

  private async loadCaseSnapshot(caseId: string): Promise<ResolutionSnapshot> {
    const caseSnapshot = await this.recordDoc("cases", caseId).get();
    if (!caseSnapshot.exists) return emptyResolutionSnapshot();

    const collections = await Promise.all(
      caseCollections.map((name) =>
        this.firestore
          .collection(firestoreCollection(this.collectionPrefix, name))
          .where("caseId", "==", caseId)
          .limit(MAX_CASE_COLLECTION_RECORDS + 1)
          .get(),
      ),
    );
    assertCaseCollectionsBounded(collections);
    return parseSnapshot(caseSnapshot.data(), collections.map(toData));
  }

  private async loadCaseSnapshotInTransaction(
    transaction: Transaction,
    caseId: string,
  ): Promise<ResolutionSnapshot> {
    const caseSnapshot = await transaction.get(this.recordDoc("cases", caseId));
    if (!caseSnapshot.exists) return emptyResolutionSnapshot();
    const collections = await Promise.all(
      caseCollections.map((name) =>
        transaction.get(
          this.firestore
            .collection(firestoreCollection(this.collectionPrefix, name))
            .where("caseId", "==", caseId)
            .limit(MAX_CASE_COLLECTION_RECORDS + 1),
        ),
      ),
    );
    assertCaseCollectionsBounded(collections);
    return parseSnapshot(caseSnapshot.data(), collections.map(toData));
  }
}

const caseCollections = [
  "events",
  "evidence",
  "claims",
  "auditRecords",
  "providerTransactions",
  "agentRuns",
  "partnerRequests",
  "partnerTokenReceipts",
  "automationRequests",
  "deadlines",
] as const;

function assertCaseCollectionsBounded(snapshots: Array<{ size: number }>): void {
  if (snapshots.some((snapshot) => snapshot.size > MAX_CASE_COLLECTION_RECORDS)) {
    throw new CaseCollectionLimitExceededError();
  }
}

function toData(snapshot: { docs: Array<{ data(): DocumentData }> }): DocumentData[] {
  return snapshot.docs.map((document) => document.data());
}

function parseSnapshot(
  caseData: DocumentData | undefined,
  collections: DocumentData[][],
): ResolutionSnapshot {
  if (!caseData) return emptyResolutionSnapshot();
  return ResolutionSnapshotSchema.parse({
    cases: [caseData],
    events: collections[0],
    evidence: collections[1],
    claims: collections[2],
    auditRecords: collections[3],
    providerTransactions: collections[4],
    agentRuns: collections[5],
    partnerRequests: collections[6],
    partnerTokenReceipts: collections[7],
    automationRequests: collections[8],
    deadlines: collections[9],
  });
}

function bundleFromSnapshot(
  snapshot: ResolutionSnapshot,
  caseId: string,
): ResolutionCaseBundle {
  const caseRecord = snapshot.cases[0];
  if (!caseRecord) throw new Error("Case snapshot is missing its case record.");
  return {
    caseRecord,
    events: snapshot.events.filter((record) => record.caseId === caseId),
    evidence: snapshot.evidence.filter((record) => record.caseId === caseId),
    claims: snapshot.claims.filter((record) => record.caseId === caseId),
    auditRecords: snapshot.auditRecords.filter((record) => record.caseId === caseId),
    providerTransactions: snapshot.providerTransactions.filter(
      (record) => record.caseId === caseId,
    ),
    agentRuns: snapshot.agentRuns.filter((record) => record.caseId === caseId),
    partnerRequests: (snapshot.partnerRequests ?? []).filter(
      (record) => record.caseId === caseId,
    ),
    partnerTokenReceipts: (snapshot.partnerTokenReceipts ?? []).filter(
      (record) => record.caseId === caseId,
    ),
    automationRequests: (snapshot.automationRequests ?? []).filter(
      (record) => record.caseId === caseId,
    ),
    deadlines: (snapshot.deadlines ?? []).filter(
      (record) => record.caseId === caseId,
    ),
  };
}

function ownedRecordsForMutation(mutation: CaseMutation): OwnedRecord[] {
  return [
    ...mutation.caseRecord.parties.map((record) => ({
      kind: "party" as const,
      id: record.id,
      caseId: record.caseId,
      appendOnly: false,
    })),
    ...mutation.eventsToAppend.map((record) => owned("event", record, true)),
    ...mutation.evidenceToAdd.map((record) => owned("evidence", record, true)),
    ...mutation.claimsToSave.map((record) => owned("claim", record, false)),
    ...mutation.auditRecordsToAppend.map((record) =>
      owned("auditRecord", record, true),
    ),
    ...mutation.transactionsToAdd.map((record) =>
      owned("providerTransaction", record, true),
    ),
    ...(mutation.automationRequestsToCreate ?? []).map((record) =>
      owned("automationRequest", record, true),
    ),
    ...(mutation.deadlinesToSave ?? []).map((record) =>
      owned("deadline", record, false),
    ),
  ];
}

function owned(
  kind: OwnedKind,
  record: { id: string; caseId: string },
  appendOnly: boolean,
): OwnedRecord {
  return { kind, id: record.id, caseId: record.caseId, appendOnly };
}

function ownershipIsValid(
  records: OwnedRecord[],
  snapshots: Array<{ exists: boolean; data(): DocumentData | undefined }>,
): boolean {
  return records.every((record, index) => {
    const snapshot = snapshots[index];
    if (!snapshot?.exists) return true;
    const owner = snapshot.data();
    return !record.appendOnly && owner?.caseId === record.caseId;
  });
}

function writeRecords(
  transaction: Transaction,
  store: FirestoreResolutionStore,
  collection: "events" | "evidence" | "claims" | "auditRecords" | "providerTransactions" | "automationRequests" | "deadlines",
  records: Array<{ id: string }>,
): void {
  for (const record of records) {
    transaction.set(store.recordDoc(collection, record.id), toFirestoreData(record));
  }
}

async function getAll(
  transaction: Transaction,
  references: DocumentReference<DocumentData>[],
) {
  return references.length === 0 ? [] : transaction.getAll(...references);
}
