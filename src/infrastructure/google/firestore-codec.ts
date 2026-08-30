import { createHash } from "node:crypto";

export type FirestoreCollectionName =
  | "cases"
  | "events"
  | "evidence"
  | "claims"
  | "auditRecords"
  | "providerTransactions"
  | "agentRuns"
  | "partnerRequests"
  | "partnerTokenReceipts"
  | "automationRequests"
  | "deadlines"
  | "recordOwnership"
  | "eventReceipts"
  | "providerObjectReceipts"
  | "rateLimits"
  | "ingressReplayReceipts";

export function firestoreDocumentId(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

export function firestoreCollection(
  prefix: string,
  name: FirestoreCollectionName,
): string {
  return `${prefix}__${name}`;
}

export function recordOwnershipId(kind: string, recordId: string): string {
  return firestoreDocumentId(`${kind}\u0000${recordId}`);
}

export function providerObjectReceiptId(
  caseId: string,
  provider: string,
  providerObjectId: string,
): string {
  return firestoreDocumentId(
    `${provider}\u0000${caseId}\u0000${providerObjectId}`,
  );
}

export function toFirestoreData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
