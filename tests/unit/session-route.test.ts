import { describe, expect, it, vi } from "vitest";

import { createSessionExchangeHandler } from "@/app/api/auth/session/route";
import type { SessionService } from "@/src/application/ports/session-service";

function service(): SessionService {
  return {
    verifyIdToken: vi.fn().mockResolvedValue({ userId: "user-a", email: "user@example.com", emailVerified: true, authTimeSeconds: 1_000 }),
    createSessionCookie: vi.fn().mockResolvedValue("signed-session-cookie"),
    revokeUserSessions: vi.fn(),
    verifySessionCookie: vi.fn(),
  };
}

function request(overrides: { origin?: string; csrf?: string; cookie?: string; body?: string } = {}) {
  return new Request("https://resolvia.example/api/auth/session", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: overrides.origin ?? "https://resolvia.example",
      "x-csrf-token": overrides.csrf ?? "csrf-value",
      cookie: `resolvia_csrf=${overrides.cookie ?? "csrf-value"}`,
    },
    body: overrides.body ?? JSON.stringify({ idToken: "firebase-id-token" }),
  });
}

describe("session exchange route", () => {
  it("creates a bounded 12-hour server cookie only for a recent allowlisted identity", async () => {
    const sessionService = service();
    const response = await createSessionExchangeHandler({ sessionService, env: { RESOLVIA_WEB_URL: "https://resolvia.example", RESOLVIA_ALLOWED_USER_EMAILS: "user@example.com" }, nowSeconds: () => 1_200, rateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 9 }) })(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("resolvia_session=signed-session-cookie");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=43200");
    expect(sessionService.createSessionCookie).toHaveBeenCalledWith("firebase-id-token", 43_200_000);
  });

  it("fails closed for forged origin, CSRF mismatch, disallowed identity, and oversized input", async () => {
    const base = { sessionService: service(), env: { RESOLVIA_WEB_URL: "https://resolvia.example", RESOLVIA_ALLOWED_USER_EMAILS: "user@example.com" }, nowSeconds: () => 1_200, rateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 9 }) };
    await expect(createSessionExchangeHandler(base)(request({ origin: "https://evil.example" }))).resolves.toMatchObject({ status: 401 });
    await expect(createSessionExchangeHandler(base)(request({ csrf: "wrong" }))).resolves.toMatchObject({ status: 401 });
    await expect(createSessionExchangeHandler({ ...base, env: { ...base.env, RESOLVIA_ALLOWED_USER_EMAILS: "other@example.com" } })(request())).resolves.toMatchObject({ status: 401 });
    const oversized = request({ body: JSON.stringify({ idToken: "x".repeat(17_000) }) });
    await expect(createSessionExchangeHandler(base)(oversized)).resolves.toMatchObject({ status: 413 });
    expect(base.sessionService.createSessionCookie).not.toHaveBeenCalled();
  });

  it("returns 429 before cookie creation when the verified user is rate limited", async () => {
    const sessionService = service();
    const response = await createSessionExchangeHandler({
      sessionService,
      env: { RESOLVIA_WEB_URL: "https://resolvia.example", RESOLVIA_ALLOWED_USER_EMAILS: "user@example.com" },
      nowSeconds: () => 1_200,
      rateLimit: vi.fn().mockResolvedValue({ allowed: false, retryAfterSeconds: 60 }),
    })(request());
    expect(response.status).toBe(429);
    expect(sessionService.createSessionCookie).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when the distributed limiter is unavailable", async () => {
    const sessionService = service();
    const response = await createSessionExchangeHandler({
      sessionService,
      env: { RESOLVIA_WEB_URL: "https://resolvia.example", RESOLVIA_ALLOWED_USER_EMAILS: "user@example.com" },
      nowSeconds: () => 1_200,
      rateLimit: vi.fn().mockRejectedValue(new Error("firestore unavailable")),
    })(request());
    expect(response.status).toBe(503);
    expect(sessionService.createSessionCookie).not.toHaveBeenCalled();
  });});