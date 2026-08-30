import { describe, expect, it } from "vitest";

import { processPartnerEvent } from "@/src/application/events/process-partner-event";
import { createPartnerRequest } from "@/src/domain/partners/policy";
import { InMemoryResolutionStore } from "@/src/infrastructure/memory/in-memory-resolution-store";
import { initialRefundBundle } from "@/tests/fixtures/domain";

const rawToken = "partner-token-abcdefghijklmnopqrstuvwxyz0123456789";
const now = "2026-08-12T13:11:00.000Z";

describe("processPartnerEvent", () => {
  it("creates exactly one authoritative partner evidence mutation from a published scoped request", async () => {
    const bundle = initialRefundBundle();
    const created = createPartnerRequest({ caseRecord: bundle.caseRecord, requestId: "partner-request-process", rawToken, now: "2026-08-12T13:10:00.000Z" });
    const store = new InMemoryResolutionStore({
      cases: [bundle.caseRecord], events: bundle.events, evidence: bundle.evidence,
      claims: bundle.claims, auditRecords: bundle.auditRecords, providerTransactions: [], agentRuns: [],
      partnerRequests: [created.request],
      partnerTokenReceipts: [{ ...created.tokenReceipt, state: "PUBLISHED", submissionEventId: "partner:partner-request-process:response-1", publishedAt: now }],
    });
    const event = {
      id: "partner:partner-request-process:response-1", caseId: "case-rv-1028",
      kind: "PARTNER_EVIDENCE_SUBMITTED" as const,
      source: { category: "PARTNER" as const, runtimeMode: "CONNECTED" as const, provider: "resolvia_demo_partner", actorId: "resolvia-demo-partner" },
      occurredAt: now, receivedAt: now, correlationId: "partner-request-process",
      payload: { partnerRequestId: "partner-request-process", requestedEvidenceType: "CUSTOMER_RECEIPT", responseStatus: "CONFIRMED", responseReference: "receipt-1028", responseSummary: "Customer receipt confirmed." },
    };

    expect(await processPartnerEvent(store, event, () => now)).toEqual({ kind: "COMMITTED", caseVersion: 5 });
    expect(await processPartnerEvent(store, event, () => now)).toEqual({ kind: "DUPLICATE_EVENT" });
    const after = await store.loadCaseBundle("case-rv-1028");
    expect(after?.evidence).toHaveLength(2);
    expect(after?.caseRecord.version).toBe(5);
    expect(after?.automationRequests).toHaveLength(3);
    expect(after?.automationRequests?.every((request) => request.basedOnCaseVersion === 5)).toBe(true);
  });
});
