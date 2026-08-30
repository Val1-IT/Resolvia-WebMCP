import { describe, expect, it, vi } from "vitest";

import { resolveRequestIdentity } from "@/src/application/auth/resolve-request-identity";
import type { SessionService } from "@/src/application/ports/session-service";

function service(): SessionService {
  return {
    verifyIdToken: vi.fn(),
    createSessionCookie: vi.fn(),
    revokeUserSessions: vi.fn(),
    verifySessionCookie: vi.fn().mockResolvedValue({ userId: "firebase-user", email: "user@example.com", emailVerified: true, authTimeSeconds: 1_000 }),
  };
}

describe("request identity resolution", () => {
  it("uses the explicit demo owner only in LOCAL mode", async () => {
    await expect(resolveRequestIdentity({ runtimeMode: "LOCAL", sessionCookie: undefined, env: {} })).resolves.toEqual({ userId: "resolvia-demo-user", isAdmin: true });
  });

  it("never falls back to the local identity in CONNECTED mode", async () => {
    await expect(resolveRequestIdentity({ runtimeMode: "CONNECTED", sessionCookie: undefined, env: {} })).resolves.toBeNull();
    await expect(resolveRequestIdentity({ runtimeMode: "CONNECTED", sessionCookie: "forged", sessionService: { ...service(), verifySessionCookie: vi.fn().mockRejectedValue(new Error("invalid")) }, env: { RESOLVIA_ALLOWED_USER_EMAILS: "user@example.com" } })).resolves.toBeNull();
  });

  it("returns only an allowlisted verified connected identity", async () => {
    await expect(resolveRequestIdentity({ runtimeMode: "CONNECTED", sessionCookie: "verified", sessionService: service(), env: { RESOLVIA_ALLOWED_USER_EMAILS: "user@example.com" } })).resolves.toEqual({ userId: "firebase-user", isAdmin: false });
    await expect(resolveRequestIdentity({ runtimeMode: "CONNECTED", sessionCookie: "verified", sessionService: service(), env: { RESOLVIA_ALLOWED_USER_EMAILS: "other@example.com" } })).resolves.toBeNull();
  });
});