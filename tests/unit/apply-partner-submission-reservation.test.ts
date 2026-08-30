import { describe, expect, it } from "vitest";

import { applyPartnerSubmissionReservation } from "@/src/domain/partners/apply-submission-reservation";
import { applyPartnerSubmissionRelease } from "@/src/domain/partners/apply-submission-release";
import { createPartnerRequest } from "@/src/domain/partners/policy";
import { initialRefundBundle } from "@/tests/fixtures/domain";

const rawToken = "partner-token-abcdefghijklmnopqrstuvwxyz0123456789";

describe("applyPartnerSubmissionReservation", () => {
  it("atomically reserves one OPEN digest for a deterministic partner event without changing case authority", () => {
    const bundle = initialRefundBundle();
    const created = createPartnerRequest({
      caseRecord: bundle.caseRecord,
      requestId: "partner-request-submission",
      rawToken,
      now: "2026-08-12T13:10:00.000Z",
    });
    const snapshot = {
      cases: [bundle.caseRecord], events: bundle.events, evidence: bundle.evidence,
      claims: bundle.claims, auditRecords: bundle.auditRecords,
      providerTransactions: bundle.providerTransactions, agentRuns: bundle.agentRuns,
      partnerRequests: [created.request], partnerTokenReceipts: [created.tokenReceipt],
    };

    const applied = applyPartnerSubmissionReservation(snapshot, {
      requestId: created.request.id,
      tokenDigest: created.tokenReceipt.digest,
      submissionEventId: "partner:partner-request-submission:response-1",
      expectedCaseVersion: 4,
      now: "2026-08-12T13:11:00.000Z",
    });

    expect(applied.result).toBe("COMMITTED");
    expect(applied.snapshot.cases[0]).toEqual(bundle.caseRecord);
    expect(applied.snapshot.partnerTokenReceipts?.[0]).toMatchObject({
      state: "RESERVED",
      submissionEventId: "partner:partner-request-submission:response-1",
      leaseUntil: "2026-08-12T13:16:00.000Z",
    });
  });

  it("releases a failed reservation for a retry without retaining a raw token", () => {
    const bundle = initialRefundBundle();
    const created = createPartnerRequest({ caseRecord: bundle.caseRecord, requestId: "partner-request-release", rawToken, now: "2026-08-12T13:10:00.000Z" });
    const snapshot = {
      cases: [bundle.caseRecord], events: bundle.events, evidence: bundle.evidence,
      claims: bundle.claims, auditRecords: bundle.auditRecords,
      providerTransactions: bundle.providerTransactions, agentRuns: bundle.agentRuns,
      partnerRequests: [created.request], partnerTokenReceipts: [{ ...created.tokenReceipt, state: "RESERVED" as const, submissionEventId: "partner:partner-request-release:response-1", leaseUntil: "2026-08-12T13:16:00.000Z" }],
    };

    const applied = applyPartnerSubmissionRelease(snapshot, {
      requestId: created.request.id,
      tokenDigest: created.tokenReceipt.digest,
      submissionEventId: "partner:partner-request-release:response-1",
      now: "2026-08-12T13:11:00.000Z",
    });

    expect(applied.result).toBe("COMMITTED");
    expect(applied.snapshot.partnerTokenReceipts?.[0]).toMatchObject({ state: "FAILED_RETRYABLE" });
    expect(JSON.stringify(applied.snapshot)).not.toContain(rawToken);
  });});