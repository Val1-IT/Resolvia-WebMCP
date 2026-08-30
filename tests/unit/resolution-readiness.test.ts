import { describe, expect, it } from "vitest";

import { projectResolutionReadiness, listResolutionGaps } from "@/src/domain/resolution/resolution-readiness";
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

describe("projectResolutionReadiness", () => {
  it("derives readiness from deterministic resolution policy gates", () => {
    const readiness = projectResolutionReadiness(eligibleBundle(), now);
    expect(readiness.ready).toBe(true);
    expect(readiness.satisfiedRequirements).toBe(3);
    expect(readiness.totalRequirements).toBe(3);
    expect(readiness.nextAllowedAction).toBe("REVIEW_FOR_RESOLUTION");
    expect(readiness.requirements.every((row) => row.status === "SATISFIED")).toBe(true);
  });

  it("marks customer receipt MISSING and not ready for seeded RV-1028-like state", () => {
    const bundle = eligibleBundle();
    bundle.evidence = bundle.evidence.filter((row) => row.id !== "evidence-partner-receipt");
    const readiness = projectResolutionReadiness(bundle, now);
    expect(readiness.ready).toBe(false);
    expect(readiness.satisfiedRequirements).toBe(2);
    expect(
      readiness.requirements.find((row) => row.id === "customer_receipt_confirmation")?.status,
    ).toBe("MISSING");
    expect(readiness.nextAllowedAction).toBe("REQUEST_EVIDENCE");
    expect(listResolutionGaps(readiness)).toEqual([
      expect.objectContaining({
        type: "MISSING_EVIDENCE",
        requirement: "customer_receipt_confirmation",
        nextAllowedAction: "REQUEST_EVIDENCE",
      }),
    ]);
  });

  it("does not invent an opaque confidence score", () => {
    const readiness = projectResolutionReadiness(eligibleBundle(), now);
    expect(readiness).not.toHaveProperty("confidence");
    expect(readiness).not.toHaveProperty("score");
  });
});
