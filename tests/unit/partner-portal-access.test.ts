import { describe, expect, it, vi } from "vitest";

import { createPartnerPortalAccessHandler } from "@/app/api/partner/requests/[requestId]/access/route";

const rawToken = "partner-token-abcdefghijklmnopqrstuvwxyz0123456789";
const context = { requestId: "partner-request-portal", caseDisplayId: "RV-1028", requestedEvidenceType: "CUSTOMER_RECEIPT" as const, expiresAt: "2026-08-12T13:40:00.000Z" };
const allowRateLimit = vi.fn().mockResolvedValue({ allowed: true, remaining: 19 });

function portalRequest(body: string): Request {
  return new Request("https://resolvia.test", { method: "POST", headers: { "content-type": "application/json" }, body });
}

describe("Partner Portal access handler", () => {
  it("returns only minimum scoped context after the private engine validates a transient token", async () => {
    const requests: Array<{ requestId: string; token: string }> = [];
    const handler = createPartnerPortalAccessHandler({ access: async (requestId, token) => { requests.push({ requestId, token }); return context; }, rateLimit: allowRateLimit });
    const response = await handler(portalRequest(JSON.stringify({ token: rawToken })), "partner-request-portal");
    expect(response.status).toBe(200);
    expect(requests).toEqual([{ requestId: "partner-request-portal", token: rawToken }]);
    expect(await response.json()).toEqual(context);
  });

  it("rejects portal access without disclosing request data when the private engine rejects it", async () => {
    const handler = createPartnerPortalAccessHandler({ access: async () => null, rateLimit: allowRateLimit });
    const response = await handler(portalRequest(JSON.stringify({ token: "not-a-valid-token" })), "other-request");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "PORTAL_ACCESS_UNAVAILABLE" });
  });

  it("rejects oversized access bodies before contacting the private engine", async () => {
    const access = vi.fn();
    const handler = createPartnerPortalAccessHandler({ access, rateLimit: allowRateLimit });
    const response = await handler(portalRequest("x".repeat(32 * 1024 + 1)), "partner-request-portal");
    expect(response.status).toBe(413);
    expect(access).not.toHaveBeenCalled();
  });

  it("returns 429 before the engine when the distributed limiter denies the token", async () => {
    const access = vi.fn();
    const handler = createPartnerPortalAccessHandler({ access, rateLimit: vi.fn().mockResolvedValue({ allowed: false, retryAfterSeconds: 60 }) });
    const response = await handler(portalRequest(JSON.stringify({ token: rawToken })), "partner-request-portal");
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(access).not.toHaveBeenCalled();
  });
});