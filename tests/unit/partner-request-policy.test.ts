import { describe, expect, it } from "vitest";

import { createPartnerRequest, portalContext, validatePartnerTokenAccess } from "@/src/domain/partners/policy";
import { initialRefundBundle } from "@/tests/fixtures/domain";

const NOW = "2026-08-12T13:10:00.000Z";
const TOKEN = "partner-token-abcdefghijklmnopqrstuvwxyz0123456789";

describe("createPartnerRequest", () => {
  it("creates a 30-minute DEMO PARTNER customer-receipt request and persists only a token digest", () => {
    const result = createPartnerRequest({
      caseRecord: initialRefundBundle().caseRecord,
      requestId: "partner-request-rv-1028-customer-receipt",
      rawToken: TOKEN,
      now: NOW,
    });

    expect(result).toMatchObject({
      request: {
        id: "partner-request-rv-1028-customer-receipt",
        caseId: "case-rv-1028",
        requestedEvidenceType: "CUSTOMER_RECEIPT",
        targetPartner: "RESOLVIA DEMO PARTNER",
        minimumContext: { caseDisplayId: "RV-1028" },
        createdAt: NOW,
                expiresAt: "2026-08-12T13:40:00.000Z",
        state: "OPEN",
      },
      tokenReceipt: {
        requestId: "partner-request-rv-1028-customer-receipt",
        caseId: "case-rv-1028",
        expiresAt: "2026-08-12T13:40:00.000Z",
        state: "OPEN",
      },
    });
    expect(result.tokenReceipt.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify({ request: result.request, tokenReceipt: result.tokenReceipt })).not.toContain(TOKEN);
  });
  it("fails closed for invalid, expired, used, and cross-case partner token access", () => {
    const { request, tokenReceipt } = createPartnerRequest({
      caseRecord: initialRefundBundle().caseRecord,
      requestId: "partner-request-rv-1028-access",
      rawToken: TOKEN,
      now: NOW,
    });

    expect(validatePartnerTokenAccess({ request, tokenReceipt, rawToken: "invalid", caseId: "case-rv-1028", now: NOW })).toEqual({ ok: false, reason: "INVALID_TOKEN" });
    expect(validatePartnerTokenAccess({ request, tokenReceipt, rawToken: TOKEN, caseId: "case-other", now: NOW })).toEqual({ ok: false, reason: "CASE_SCOPE_REJECTED" });
    expect(validatePartnerTokenAccess({ request, tokenReceipt: { ...tokenReceipt, state: "USED" }, rawToken: TOKEN, caseId: "case-rv-1028", now: NOW })).toEqual({ ok: false, reason: "TOKEN_UNAVAILABLE" });
    const publishedReceipt = { ...tokenReceipt, state: "PUBLISHED" as const, submissionEventId: "partner:event:1", publishedAt: NOW };
    expect(validatePartnerTokenAccess({ request, tokenReceipt: publishedReceipt, rawToken: TOKEN, caseId: "case-rv-1028", now: NOW })).toEqual({ ok: false, reason: "TOKEN_UNAVAILABLE" });
    expect(validatePartnerTokenAccess({ request, tokenReceipt: publishedReceipt, rawToken: TOKEN, caseId: "case-rv-1028", now: NOW, purpose: "IDEMPOTENT_SUBMISSION" })).toEqual({ ok: true });
    expect(validatePartnerTokenAccess({ request, tokenReceipt, rawToken: TOKEN, caseId: "case-rv-1028", now: "2026-08-12T13:40:00.000Z" })).toEqual({ ok: false, reason: "TOKEN_EXPIRED" });
  });

  it("limits portal context to the request scope without case evidence or narrative", () => {
    const created = createPartnerRequest({
      caseRecord: initialRefundBundle().caseRecord,
      requestId: "partner-request-portal-scope",
      rawToken: "partner-token-abcdefghijklmnopqrstuvwxyz0123456789",
      now: NOW,
    });

    expect(portalContext(created.request)).toEqual({
      requestId: created.request.id,
      caseDisplayId: "RV-1028",
      requestedEvidenceType: "CUSTOMER_RECEIPT",
      expiresAt: "2026-08-12T13:40:00.000Z",
    });
  });});