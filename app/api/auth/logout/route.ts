import { NextResponse } from "next/server";

import { validateRequestIntegrity } from "@/src/application/auth/session-policy";
import type { SessionService } from "@/src/application/ports/session-service";
import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME } from "@/src/infrastructure/auth/get-request-identity";
import { getSessionService } from "@/src/infrastructure/auth/get-session-service";
import { getRuntimeConfig } from "@/src/infrastructure/google/runtime-config";

type LogoutDependencies = {
  sessionService: SessionService;
  expectedOrigin: string;
};

export async function POST(request: Request): Promise<Response> {
  try {
    const runtime = getRuntimeConfig(process.env);
    if (runtime.mode !== "CONNECTED" || !runtime.webUrl) throw new Error("unavailable");
    return createLogoutHandler({
      sessionService: getSessionService(),
      expectedOrigin: runtime.webUrl,
    })(request);
  } catch {
    return signOutFailed();
  }
}

export function createLogoutHandler(
  dependencies: LogoutDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      validateRequestIntegrity({
        origin: request.headers.get("origin"),
        expectedOrigin: dependencies.expectedOrigin,
        csrfHeader: request.headers.get("x-csrf-token"),
        csrfCookie: parseCookie(request.headers.get("cookie"), CSRF_COOKIE_NAME),
      });
      const sessionCookie = parseCookie(
        request.headers.get("cookie"),
        SESSION_COOKIE_NAME,
      );
      if (!sessionCookie) return signOutFailed();
      const claims = await dependencies.sessionService.verifySessionCookie(
        sessionCookie,
      );
      await dependencies.sessionService.revokeUserSessions(claims.userId);

      const response = NextResponse.json({ status: "SIGNED_OUT" });
      response.cookies.set(SESSION_COOKIE_NAME, "", {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });
      response.cookies.set(CSRF_COOKIE_NAME, "", {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });
      response.headers.set("cache-control", "no-store");
      return response;
    } catch {
      return signOutFailed();
    }
  };
}

function signOutFailed(): Response {
  return Response.json(
    { error: "SIGN_OUT_FAILED" },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

function parseCookie(header: string | null, name: string): string | undefined {
  return header
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}