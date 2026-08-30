import { describe, expect, it, vi } from "vitest";

import { createLogoutHandler } from "@/app/api/auth/logout/route";
import type { SessionService } from "@/src/application/ports/session-service";

function service(): SessionService {
  return {
    verifyIdToken: vi.fn(),
    createSessionCookie: vi.fn(),
    verifySessionCookie: vi.fn().mockResolvedValue({
      userId: "firebase-user",
      email: "user@example.com",
      emailVerified: true,
      authTimeSeconds: 1_000,
    }),
    revokeUserSessions: vi.fn().mockResolvedValue(undefined),
  };
}

function request(cookie = "signed-session-cookie") {
  return new Request("https://resolvia.example/api/auth/logout", {
    method: "POST",
    headers: {
      origin: "https://resolvia.example",
      "x-csrf-token": "csrf-token",
      cookie: `resolvia_csrf=csrf-token; resolvia_session=${cookie}`,
    },
  });
}

describe("logout session revocation", () => {
  it("verifies the current session and revokes the user before clearing cookies", async () => {
    const sessionService = service();
    const response = await createLogoutHandler({
      sessionService,
      expectedOrigin: "https://resolvia.example",
    })(request());

    expect(response.status).toBe(200);
    expect(sessionService.verifySessionCookie).toHaveBeenCalledWith(
      "signed-session-cookie",
    );
    expect(sessionService.revokeUserSessions).toHaveBeenCalledWith(
      "firebase-user",
    );
  });

  it("fails closed without clearing a missing or invalid server session", async () => {
    const sessionService = service();
    vi.mocked(sessionService.verifySessionCookie).mockRejectedValue(
      new Error("invalid"),
    );

    await expect(
      createLogoutHandler({
        sessionService,
        expectedOrigin: "https://resolvia.example",
      })(request("invalid")),
    ).resolves.toMatchObject({ status: 401 });
    expect(sessionService.revokeUserSessions).not.toHaveBeenCalled();
  });
});