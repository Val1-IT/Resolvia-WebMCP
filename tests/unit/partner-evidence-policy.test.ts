import { describe, expect, it } from "vitest";

import { planPartnerEvidenceMutation } from "@/src/domain/partners/partner-evidence-policy";
import { createPartnerRequest } from "@/src/domain/partners/policy";
import { initialRefundBundle } from "@/tests/fixtures/domain";

const rawToken = "partner-token-abcdefghijklmnopqrstuvwxyz0123456789";
const now = "2026-08-12T13:11:00.000Z";

describe("planPartnerEvidenceMutation", () => {
  it("records independently partner-verified customer-receipt evidence without fabricating provider truth", () => {
    const bundle = initialRefundBundle();
    const created = createPartnerRequest({
      caseRecord: bundle.caseRecord,
      requestId: "partner-request-evidence",
      rawToken,
      now: "2026-08-12T13:10:00.000Z",
    });
    bundle.partnerRequests = [created.request];
    bundle.partnerTokenReceipts = [{
      ...created.tokenReceipt,
      state: "PUBLISHED",
      submissionEventId: "partner:partner-request-evidence:response-1",
      publishedAt: now,
    }];
    const event = {
      id: "partner:partner-request-evidence:response-1",
      caseId: bundle.caseRecord.id,
      kind: "PARTNER_EVIDENCE_SUBMITTED" as const,
      source: { category: "PARTNER" as const, runtimeMode: "CONNECTED" as const, provider: "resolvia_demo_partner", actorId: "resolvia-demo-partner" },
      occurredAt: now,
      receivedAt: now,
      correlationId: "partner-request-evidence",
      payload: {
        partnerRequestId: "partner-request-evidence",
        requestedEvidenceType: "CUSTOMER_RECEIPT",
        responseStatus: "CONFIRMED",
        responseReference: "demo-receipt-1028",
        responseSummary: "Customer receipt was confirmed by the demo partner.",
      },
    };

    const result = planPartnerEvidenceMutation(bundle, event, () => now);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mutation.caseRecord.version).toBe(5);
    expect(result.mutation.caseRecord.state).toBe("INVESTIGATING");
    expect(result.mutation.evidenceToAdd).toMatchObject([{ verificationLevel: "PARTNER_VERIFIED", type: "PARTNER_RESPONSE" }]);
    expect(result.mutation.transactionsToAdd).toEqual([]);
    expect(result.mutation.claimsToSave[0]?.status).toBe("SUPPORTED");
  });
});