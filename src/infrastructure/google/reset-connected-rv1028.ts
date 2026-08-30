import type { DocumentReference, Firestore } from "@google-cloud/firestore";

import { seedDemoCase } from "@/src/application/cases/seed-demo-case";
import type { ResolutionStore } from "@/src/application/ports/resolution-store";
import { AgentRunRecordSchema, type AgentRunRecord } from "@/src/domain/agent/model";
import type { ResolutionCaseBundle } from "@/src/domain/store/model";
import { RV_1028_CASE_ID } from "@/src/demo/rv-1028";
import {
  firestoreCollection,
  firestoreDocumentId,
  type FirestoreCollectionName,
} from "@/src/infrastructure/google/firestore-codec";

const MAX_RESET_DOCUMENTS = 100;

export class ConnectedDemoResetError extends Error {
  constructor(public readonly code: "INVALID_SCOPE" | "RESET_LIMIT_EXCEEDED" | "SEED_FAILED") {
    super(code);
    this.name = "ConnectedDemoResetError";
  }
}

/**
 * Deletes only the existing synthetic RV-1028 records in this collection prefix,
 * then recreates the deterministic v4 baseline. It deliberately has no generic
 * reset API and is intended only for the opt-in connected proof utility.
 */
export async function resetConnectedRv1028(input: {
  firestore: Firestore;
  store: ResolutionStore;
  collectionPrefix: string;
  runtimeMode: "LOCAL" | "CONNECTED";
  confirmed: boolean;
}): Promise<ResolutionCaseBundle> {
  if (
    input.runtimeMode !== "CONNECTED" ||
    input.confirmed !== true ||
    !/^[A-Za-z0-9_-]{1,100}$/u.test(input.collectionPrefix)
  ) {
    throw new ConnectedDemoResetError("INVALID_SCOPE");
  }
  const deletions = await deletionPlan(input.firestore, input.collectionPrefix);
  if (deletions.length > 0) {
    const batch = input.firestore.batch();
    for (const deletion of deletions) {
      batch.delete(deletion);
    }
    await batch.commit();
  }

  await seedDemoCase(input.store);
  const seeded = await input.store.loadCaseBundle(RV_1028_CASE_ID);
  if (!seeded || seeded.caseRecord.version !== 4 || seeded.caseRecord.state !== "INVESTIGATING") {
    throw new ConnectedDemoResetError("SEED_FAILED");
  }

  const baselineRun = deterministicBaselineRun();
  const appendResult = await input.store.appendAgentRun({
    agentRun: baselineRun,
    expectedCaseVersion: seeded.caseRecord.version,
  });
  if (appendResult !== "COMMITTED") throw new ConnectedDemoResetError("SEED_FAILED");

  const result = await input.store.loadCaseBundle(RV_1028_CASE_ID);
  if (!result || result.caseRecord.version !== 4) {
    throw new ConnectedDemoResetError("SEED_FAILED");
  }
  return result;
}

const CASE_SCOPED_COLLECTIONS: ReadonlyArray<FirestoreCollectionName> = [
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
  "recordOwnership",
  "eventReceipts",
  "providerObjectReceipts",
];

async function deletionPlan(
  firestore: Firestore,
  prefix: string,
): Promise<DocumentReference[]> {
  const caseReference = firestore
    .collection(firestoreCollection(prefix, "cases"))
    .doc(firestoreDocumentId(RV_1028_CASE_ID));
  const caseSnapshot = await caseReference.get();
  const plan: DocumentReference[] = [];

  if (caseSnapshot.exists) {
    if (caseSnapshot.data()?.id !== RV_1028_CASE_ID) {
      throw new ConnectedDemoResetError("INVALID_SCOPE");
    }
    plan.push(caseReference);
  }

  for (const collectionName of CASE_SCOPED_COLLECTIONS) {
    const snapshot = await firestore
      .collection(firestoreCollection(prefix, collectionName))
      .where("caseId", "==", RV_1028_CASE_ID)
      .limit(MAX_RESET_DOCUMENTS + 1)
      .get();
    if (
      snapshot.docs.some(
        (document) => document.data().caseId !== RV_1028_CASE_ID,
      )
    ) {
      throw new ConnectedDemoResetError("INVALID_SCOPE");
    }
    plan.push(...snapshot.docs.map((document) => document.ref));
    if (plan.length > MAX_RESET_DOCUMENTS) {
      throw new ConnectedDemoResetError("RESET_LIMIT_EXCEEDED");
    }
  }

  return plan;
}
function deterministicBaselineRun(): AgentRunRecord {
  return AgentRunRecordSchema.parse({
    id: "agent-run-rv-1028-connected-baseline",
    caseId: RV_1028_CASE_ID,
    basedOnCaseVersion: 4,
    agentName: "resolvia_resolution_agent",
    modelId: "deterministic-connected-baseline",
    promptVersion: "resolution-agent-v1",
    schemaVersion: "agent-resolution-proposal-v1",
    validatorVersion: "agent-proposal-validator-v1",
    startedAt: "2026-08-09T10:04:00.000Z",
    completedAt: "2026-08-09T10:04:00.000Z",
    inputDigest: `sha256:${"0".repeat(64)}`,
    suppliedPartyIds: ["party-customer", "party-merchant"],
    suppliedClaimIds: ["claim-refund-processed"],
    suppliedEvidenceIds: ["evidence-merchant-message"],
    suppliedEventIds: ["event-intake", "event-initial-evidence"],
    suppliedVerificationGapIds: ["verification-gap:claim-refund-processed"],
    outcome: "FAILED_CONFIGURATION",
    validationErrors: [],
  });
}