import { describe, expect, it, vi } from "vitest";

import { createPartnerPortalSubmitHandler } from "@/app/api/partner/requests/[requestId]/submit/route";

const body = {
  token: "partner-token-abcdefghijklmnopqrstuvwxyz0123456789",
  requestedEvidenceType: "CUSTOMER_RECEIPT",
  responseStatus: "CONFIRMED",
  responseReference: "receipt-1028",
  responseSummary: "Customer receipt confirmed.",
};
const allowRateLimit = vi.fn().mockResolvedValue({ allowed: true, remaining: 19 });

function request(rawBody = JSON.stringify(body)): Request {
  return new Request("https://resolvia.test", { method: "POST", headers: { "content-type": "application/json" }, body: rawBody });
}

describe("Partner Portal submit handler", () => {
  it("submits only a bounded structured response to the application submission service", async () => {
    const submit = vi.fn(async () => ({ kind: "PUBLISHED" as const, eventId: "partner:request:response" }));
    const response = await createPartnerPortalSubmitHandler({ submit, rateLimit: allowRateLimit })(request(), "partner-request-submit");
    expect(response.status).toBe(202);
    expect(submit).toHaveBeenCalledWith("partner-request-submit", body);
    expect(await response.json()).toEqual({ status: "ACCEPTED" });
  });

  it("does not expose internal event identifiers or errors when portal submission is unavailable", async () => {
    const response = await createPartnerPortalSubmitHandler({ submit: async () => ({ kind: "ACCESS_UNAVAILABLE" }), rateLimit: allowRateLimit })(request(), "partner-request-submit");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "PORTAL_SUBMISSION_UNAVAILABLE" });
  });

  it("rejects oversized submissions before calling the engine", async () => {
    const submit = vi.fn();
    const response = await createPartnerPortalSubmitHandler({ submit, rateLimit: allowRateLimit })(request("x".repeat(32 * 1024 + 1)), "partner-request-submit");
    expect(response.status).toBe(413);
    expect(submit).not.toHaveBeenCalled();
  });

  it("returns 429 before the engine when the distributed limiter denies the token", async () => {
    const submit = vi.fn();
    const response = await createPartnerPortalSubmitHandler({ submit, rateLimit: vi.fn().mockResolvedValue({ allowed: false, retryAfterSeconds: 60 }) })(request(), "partner-request-submit");
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(submit).not.toHaveBeenCalled();
  });
});