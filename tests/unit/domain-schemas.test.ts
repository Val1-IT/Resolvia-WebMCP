import { describe, expect, it } from "vitest";

import { ResolutionCaseSchema } from "@/src/domain/cases/model";
import { ClaimRecordSchema } from "@/src/domain/claims/model";
import { EvidenceRecordSchema } from "@/src/domain/evidence/model";

const fixedNow = "2026-08-09T10:00:00.000Z";

describe("domain schemas", () => {
  it("rejects a case whose initial version is below one", () => {
    const result = ResolutionCaseSchema.safeParse({
      id: "case-rv-1028",
      displayId: "RV-1028",
      ownerUserId: "resolvia-demo-user",
      issueType: "SAAS_SUBSCRIPTION_REFUND",
      title: "SaaS subscription refund",
      summary: "Merchant claims refund processed.",
      state: "NEW",
      version: 0,
      parties: [],
      currentBlocker: "Initial evidence not collected.",
      nextBestAction: "Collect initial evidence.",
      createdAt: fixedNow,
      updatedAt: fixedNow,
    });

    expect(result.success).toBe(false);
  });

  it("keeps an authenticated assertion relationship on a claim", () => {
    const claim = ClaimRecordSchema.parse({
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
      createdAt: fixedNow,
      updatedAt: fixedNow,
    });

    expect(claim.status).toBe("UNVERIFIED");
    expect(claim.evidenceRelationships[0]?.kind).toBe(
      "AUTHENTICATES_ASSERTION",
    );
  });

  it("keeps authenticated evidence separate from its related claim", () => {
    const evidence = EvidenceRecordSchema.parse({
      id: "evidence-merchant-message",
      caseId: "case-rv-1028",
      type: "COMMUNICATION",
      source: "Merchant support message",
      contentSummary: "Merchant states the refund was processed.",
      verificationLevel: "AUTHENTICATED_SOURCE",
      retrievedAt: fixedNow,
      createdAt: fixedNow,
      metadata: {},
      relatedClaimIds: ["claim-refund-processed"],
    });

    expect(evidence.verificationLevel).toBe("AUTHENTICATED_SOURCE");
    expect(evidence.relatedClaimIds).toEqual(["claim-refund-processed"]);
    expect(evidence).not.toHaveProperty("status", "SUPPORTED");
  });
});
