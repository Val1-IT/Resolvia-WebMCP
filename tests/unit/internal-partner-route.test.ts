import { describe, expect, it } from "vitest";

import { createInternalPartnerRoute } from "@/app/api/internal/partner/route";
import { createPartnerRequest } from "@/src/domain/partners/policy";
import { InMemoryResolutionStore } from "@/src/infrastructure/memory/in-memory-resolution-store";
import { initialRefundBundle } from "@/tests/fixtures/domain";

const rawToken = "partner-token-abcdefghijklmnopqrstuvwxyz0123456789";
const now = "2026-08-12T13:11:00.000Z";

function makeRoute(authenticated = true) {
  const bundle = initialRefundBundle();
  const created = createPartnerRequest({
    caseRecord: bundle.caseRecord,
    requestId: "partner-request-engine",
    rawToken,
    now: "2026-08-12T13:10:00.000Z",
  });
  const store = new InMemoryResolutionStore({
    cases: [bundle.caseRecord],
    events: bundle.events,
    evidence: bundle.evidence,
    claims: bundle.claims,
    auditRecords: bundle.auditRecords,
    providerTransactions: [],
    agentRuns: [],
    partnerRequests: [created.request],
    partnerTokenReceipts: [created.tokenReceipt],
  });
  return {
    store,
    route: createInternalPartnerRoute({
      getRuntime: () => ({
        mode: "CONNECTED",
        projectId: "resolvia-project",
        engineAudience: "https://engine.resolvia.test",
      }),
      getStore: () => store,
      verifyIdentity: async () =>
        authenticated ? "resolvia-web@resolvia-project.iam.gserviceaccount.com" : null,
      now: () => now,
    }),
  };
}

describe("internal partner engine route", () => {
  it("returns only minimum context after authenticating the private web service", async () => {
    const { route } = makeRoute();

    const response = await route(new Request("https://engine.resolvia.test/api/internal/partner", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "access", requestId: "partner-request-engine", token: rawToken }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      requestId: "partner-request-engine",
      caseDisplayId: "RV-1028",
      requestedEvidenceType: "CUSTOMER_RECEIPT",
      expiresAt: "2026-08-12T13:40:00.000Z",
    });
  });

  it("durably prepares one deterministic event without granting the web service a direct case mutation", async () => {
    const { route, store } = makeRoute();
    const payload = {
      operation: "prepare",
      requestId: "partner-request-engine",
      token: rawToken,
      response: {
        requestedEvidenceType: "CUSTOMER_RECEIPT",
        responseStatus: "CONFIRMED",
        responseReference: "receipt-1028",
        responseSummary: "Customer receipt confirmed.",
      },
    };

    const first = await route(new Request("https://engine.resolvia.test/api/internal/partner", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }));
    const firstBody = await first.json();
    const replay = await route(new Request("https://engine.resolvia.test/api/internal/partner", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }));

    expect(first.status).toBe(200);
    expect(firstBody).toMatchObject({ event: { caseId: "case-rv-1028", kind: "PARTNER_EVIDENCE_SUBMITTED" } });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(firstBody);
    expect((await store.loadCaseBundle("case-rv-1028"))?.caseRecord.version).toBe(4);
    expect((await store.loadPartnerRequest("partner-request-engine"))?.tokenReceipt.state).toBe("PUBLISHED");
  });

  it("rejects a caller that is not the private web service", async () => {
    const { route } = makeRoute(false);
    const response = await route(new Request("https://engine.resolvia.test/api/internal/partner", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "access", requestId: "partner-request-engine", token: rawToken }),
    }));

    expect(response.status).toBe(401);
  });
  it("rejects an oversized authenticated body before parsing or store access", async () => {
    const { route, store } = makeRoute();
    const before = await store.loadCaseBundle("case-rv-1028");
    const response = await route(
      new Request("https://engine.resolvia.test/api/internal/partner", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "access",
          requestId: "partner-request-engine",
          token: "x".repeat(40_000),
        }),
      }),
    );

    expect(response.status).toBe(413);
    expect(await store.loadCaseBundle("case-rv-1028")).toEqual(before);
  });
});