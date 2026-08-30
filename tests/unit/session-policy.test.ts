import { describe, expect, it } from "vitest";

import { identityFromClaims, parseSessionAccessConfig, validateSessionExchange } from "@/src/application/auth/session-policy";

const claims = {
  userId: "firebase-user-a",
  email: "user@example.com",
  emailVerified: true,
  authTimeSeconds: 1_000,
};

const config = parseSessionAccessConfig({
  RESOLVIA_ALLOWED_USER_EMAILS: "user@example.com",
  RESOLVIA_ADMIN_USER_EMAILS: "admin@example.com",
});

describe("session policy", () => {
  it("maps only verified allowlisted identities and keeps admins explicit", () => {
    expect(identityFromClaims(claims, config)).toEqual({ userId: "firebase-user-a", isAdmin: false });
    expect(identityFromClaims({ ...claims, userId: "admin", email: "ADMIN@example.com" }, config)).toEqual({ userId: "admin", isAdmin: true });
    expect(() => identityFromClaims({ ...claims, emailVerified: false }, config)).toThrowError("EMAIL_NOT_ALLOWED");
    expect(() => identityFromClaims({ ...claims, email: "other@example.com" }, config)).toThrowError("EMAIL_NOT_ALLOWED");
  });

  it("requires exact origin, double-submit CSRF, and recent sign-in", () => {
    expect(validateSessionExchange({ claims, config, nowSeconds: 1_200, origin: "https://resolvia.example", expectedOrigin: "https://resolvia.example", csrfHeader: "csrf-value", csrfCookie: "csrf-value" })).toEqual({ userId: "firebase-user-a", isAdmin: false });
    expect(() => validateSessionExchange({ claims, config, nowSeconds: 1_200, origin: "https://evil.example", expectedOrigin: "https://resolvia.example", csrfHeader: "csrf-value", csrfCookie: "csrf-value" })).toThrowError("INVALID_ORIGIN");
    expect(() => validateSessionExchange({ claims, config, nowSeconds: 1_200, origin: "https://resolvia.example", expectedOrigin: "https://resolvia.example", csrfHeader: "wrong", csrfCookie: "csrf-value" })).toThrowError("CSRF_MISMATCH");
    expect(() => validateSessionExchange({ claims: { ...claims, authTimeSeconds: 100 }, config, nowSeconds: 1_200, origin: "https://resolvia.example", expectedOrigin: "https://resolvia.example", csrfHeader: "csrf-value", csrfCookie: "csrf-value" })).toThrowError("AUTH_NOT_RECENT");
  });
});