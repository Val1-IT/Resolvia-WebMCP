import { describe, expect, it, vi } from "vitest";

import { submitPartnerResponse } from "@/src/application/partners/submit-partner-response";
import { createPartnerRequest } from "@/src/domain/partners/policy";
import { InMemoryResolutionStore } from "@/src/infrastructure/memory/in-memory-resolution-store";
import { initialRefundBundle } from "@/tests/fixtures/domain";

const token = "partner-token-abcdefghijklmnopqrstuvwxyz0123456789";
const now = "2026-08-12T13:11:00.000Z";

function storeWithRequest() {
  const bundle = initialRefundBundle();
  const created = createPartnerRequest({ caseRecord: bundle.caseRecord, requestId: "partner-request-submit", rawToken: token, now: "2026-08-12T13:10:00.000Z" });
  return new InMemoryResolutionStore({
    cases: [bundle.caseRecord], events: bundle.events, evidence: bundle.evidence,
    claims: bundle.claims, auditRecords: bundle.auditRecords,
    providerTransactions: [], agentRuns: [], partnerRequests: [created.request], partnerTokenReceipts: [created.tokenReceipt],
  });
}

describe("submitPartnerResponse", () => {
  it("reserves, publishes one normalized event, then marks the digest receipt PUBLISHED without a direct case mutation", async () => {
    const store = storeWithRequest();
    const publish = vi.fn(async () => undefined);

    const result = await submitPartnerResponse({
      store, publisher: { publish }, now: () => now,
      requestId: "partner-request-submit", rawToken: token,
      response: { requestedEvidenceType: "CUSTOMER_RECEIPT", responseStatus: "CONFIRMED", responseReference: "receipt-1028", responseSummary: "Customer receipt confirmed." },
    });

    expect(result.kind).toBe("PUBLISHED");
    expect(publish).toHaveBeenCalledTimes(1);
    const access = await store.loadPartnerRequest("partner-request-submit");
    expect(access?.tokenReceipt.state).toBe("PUBLISHED");
    expect((await store.loadCaseBundle("case-rv-1028"))?.caseRecord.version).toBe(4);
  });

  it("retains PUBLISHED on an uncertain broker outcome and retries the identical event", async () => {
    const store = storeWithRequest();
    const failedEventIds: string[] = [];
    const result = await submitPartnerResponse({
      store, publisher: { publish: async (event) => { failedEventIds.push(event.id); throw new Error("transport unavailable"); } }, now: () => now,
      requestId: "partner-request-submit", rawToken: token,
      response: { requestedEvidenceType: "CUSTOMER_RECEIPT", responseStatus: "CONFIRMED", responseReference: "receipt-1028", responseSummary: "Customer receipt confirmed." },
    });

    expect(result).toEqual({ kind: "PUBLISH_UNCERTAIN" });
    expect((await store.loadPartnerRequest("partner-request-submit"))?.tokenReceipt.state).toBe("PUBLISHED");

    const publishedEventIds: string[] = [];
    const retry = await submitPartnerResponse({
      store, publisher: { publish: async (event) => { publishedEventIds.push(event.id); } }, now: () => now,
      requestId: "partner-request-submit", rawToken: token,
      response: { requestedEvidenceType: "CUSTOMER_RECEIPT", responseStatus: "CONFIRMED", responseReference: "receipt-1028", responseSummary: "Customer receipt confirmed." },
    });
    expect(retry.kind).toBe("PUBLISHED");
    expect(publishedEventIds).toEqual(failedEventIds);
  });
});
