import { describe, expect, it } from "vitest";

import { planAutomatedResolutionEvaluation } from "@/src/domain/automation/resolution-policy";
import type { ResolutionCaseBundle } from "@/src/domain/store/model";
import { initialRefundBundle } from "@/tests/fixtures/domain";

const now = "2026-08-12T17:10:00.000Z";

function eligibleBundle(): ResolutionCaseBundle {
  const bundle = initialRefundBundle();
  bundle.caseRecord = { ...bundle.caseRecord, state: "RESOLUTION_PENDING", version: 6 };
  bundle.evidence.push(
    {
      id: "evidence-provider-success", caseId: bundle.caseRecord.id, type: "PROVIDER_TRANSACTION",
      source: "RESOLVIA DEMO PROVIDER signed Test Mode event", sourceProvider: "resolvia_demo_provider",
      externalReference: "refund-demo-1028", contentSummary: "Demo provider reports succeeded.",
      verificationLevel: "DEMO_PROVIDER_VERIFIED", retrievedAt: now, createdAt: now,
      metadata: { providerStatus: "succeeded" }, relatedClaimIds: [],
    },
    {
      id: "evidence-partner-receipt", caseId: bundle.caseRecord.id, type: "PARTNER_RESPONSE",
      source: "Resolvia Demo Partner structured response", sourceProvider: "resolvia_demo_partner",
      externalReference: "receipt-demo-1028", contentSummary: "Customer receipt confirmed.",
      verificationLevel: "PARTNER_VERIFIED", retrievedAt: now, createdAt: now,
      metadata: { requestedEvidenceType: "CUSTOMER_RECEIPT", responseStatus: "CONFIRMED" }, relatedClaimIds: [],
    },
  );
  bundle.providerTransactions.push({
    id: "transaction-demo-1028", caseId: bundle.caseRecord.id, provider: "resolvia_demo_provider",
    providerObjectId: "refund-demo-1028", kind: "REFUND", status: "SUCCEEDED",
    evidenceId: "evidence-provider-success", observedAt: now, createdAt: now,
  });
  return bundle;
}

describe("planAutomatedResolutionEvaluation", () => {
  it("resolves only from same-case provider success plus independently confirmed customer receipt", () => {
    const result = planAutomatedResolutionEvaluation(eligibleBundle(), now);
    expect(result).toEqual({
      kind: "MUTATION",
      mutation: expect.objectContaining({
        expectedCaseVersion: 6,
        caseRecord: expect.objectContaining({ state: "RESOLVED", version: 7 }),
        transactionsToAdd: [],
        evidenceToAdd: [],
        auditRecordsToAppend: [expect.objectContaining({
          ruleId: "RESOLUTION_PENDING_TO_RESOLVED",
          evidenceIds: ["evidence-provider-success", "evidence-partner-receipt"],
        })],
      }),
    });
  });

  it("keeps UNKNOWN first-class when customer receipt evidence is absent", () => {
    const bundle = eligibleBundle();
    bundle.evidence = bundle.evidence.filter((evidence) => evidence.id !== "evidence-partner-receipt");
    expect(planAutomatedResolutionEvaluation(bundle, now)).toEqual({ kind: "NO_CHANGE", reason: "CUSTOMER_RECEIPT_UNKNOWN" });
  });

  it("fails closed when any same-case claim is contradicted", () => {
    const bundle = eligibleBundle();
    bundle.claims[0] = { ...bundle.claims[0]!, status: "CONTRADICTED" };
    expect(planAutomatedResolutionEvaluation(bundle, now)).toEqual({ kind: "NO_CHANGE", reason: "CONTRADICTION_PRESENT" });
  });
});
