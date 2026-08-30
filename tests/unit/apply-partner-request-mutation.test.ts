import { describe, expect, it } from "vitest";

import { applyPartnerRequestMutation } from "@/src/domain/partners/apply-mutation";
import { createPartnerRequest } from "@/src/domain/partners/policy";
import { initialRefundBundle } from "@/tests/fixtures/domain";

describe("applyPartnerRequestMutation", () => {
  it("atomically appends one same-case request and digest receipt without changing semantic case authority", () => {
    const bundle = initialRefundBundle();
    const created = createPartnerRequest({ caseRecord: bundle.caseRecord, requestId: "partner-request-1", rawToken: "partner-token-abcdefghijklmnopqrstuvwxyz0123456789", now: "2026-08-12T13:10:00.000Z" });
    const snapshot = { cases: [bundle.caseRecord], events: bundle.events, evidence: bundle.evidence, claims: bundle.claims, auditRecords: bundle.auditRecords, providerTransactions: bundle.providerTransactions, agentRuns: bundle.agentRuns, partnerRequests: [], partnerTokenReceipts: [] };

    const applied = applyPartnerRequestMutation(snapshot, { request: created.request, tokenReceipt: created.tokenReceipt, expectedCaseVersion: 4 });

    expect(applied.result).toBe("COMMITTED");
    expect(applied.snapshot.partnerRequests).toEqual([created.request]);
    expect(applied.snapshot.partnerTokenReceipts).toEqual([created.tokenReceipt]);
    expect(applied.snapshot.cases[0]).toEqual(bundle.caseRecord);
  });

  it("fails closed for stale versions or cross-case receipt references", () => {
    const bundle = initialRefundBundle();
    const created = createPartnerRequest({
      caseRecord: bundle.caseRecord,
      requestId: "partner-request-2",
      rawToken: "partner-token-abcdefghijklmnopqrstuvwxyz0123456789",
      now: "2026-08-12T13:10:00.000Z",
    });
    const snapshot = {
      cases: [bundle.caseRecord], events: bundle.events, evidence: bundle.evidence,
      claims: bundle.claims, auditRecords: bundle.auditRecords,
      providerTransactions: bundle.providerTransactions, agentRuns: bundle.agentRuns,
      partnerRequests: [], partnerTokenReceipts: [],
    };

    expect(applyPartnerRequestMutation(snapshot, { ...created, expectedCaseVersion: 3 }))
      .toEqual({ result: "VERSION_CONFLICT", snapshot });
    expect(applyPartnerRequestMutation(snapshot, {
      request: created.request,
      tokenReceipt: { ...created.tokenReceipt, caseId: "case-other" },
      expectedCaseVersion: 4,
    })).toEqual({ result: "CASE_INTEGRITY_ERROR", snapshot });
  });});