import { NextResponse } from "next/server";
import { z } from "zod";

import { parseSessionAccessConfig, validateSessionExchange } from "@/src/application/auth/session-policy";
import type { RateLimit } from "@/src/application/ports/rate-limiter";
import type { SessionService } from "@/src/application/ports/session-service";
import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME } from "@/src/infrastructure/auth/get-request-identity";
import { getSessionService } from "@/src/infrastructure/auth/get-session-service";
import { getConnectedRateLimiter } from "@/src/infrastructure/google/get-connected-rate-limiter";
import { getRuntimeConfig } from "@/src/infrastructure/google/runtime-config";
import { BoundedBodyError, readBoundedBody } from "@/src/infrastructure/http/bounded-body";
import { requestRateLimitKey } from "@/src/infrastructure/http/request-rate-limit-key";

const SESSION_DURATION_MS = 12 * 60 * 60 * 1_000;
const SessionBodySchema = z.object({ idToken: z.string().min(1).max(8_192) }).strict();

type Dependencies = {
  sessionService: SessionService;
  rateLimit: RateLimit;
  env: Record<string, string | undefined>;
  nowSeconds: () => number;
};

export async function POST(request: Request): Promise<Response> {
  try {
    const runtime = getRuntimeConfig(process.env);
    if (runtime.mode !== "CONNECTED") return error("AUTH_CONFIGURATION_UNAVAILABLE", 503);
    const limiter = getConnectedRateLimiter(runtime);
    return createSessionExchangeHandler({
      sessionService: getSessionService(),
      rateLimit: (input) => limiter.consume(input),
      env: process.env,
      nowSeconds: () => Math.floor(Date.now() / 1_000),
    })(request);
  } catch {
    return error("AUTH_CONFIGURATION_UNAVAILABLE", 503);
  }
}

export function createSessionExchangeHandler(dependencies: Dependencies) {
  return async (request: Request): Promise<Response> => {
    try {
      const expectedOrigin = dependencies.env.RESOLVIA_WEB_URL;
      if (!expectedOrigin) return error("AUTH_CONFIGURATION_UNAVAILABLE", 503);
      const rawBody = await readBoundedBody(request, 16 * 1_024, ["application/json"]);
      const parsed = SessionBodySchema.safeParse(JSON.parse(rawBody));
      if (!parsed.success) return error("INVALID_SESSION_REQUEST", 400);
      const claims = await dependencies.sessionService.verifyIdToken(parsed.data.idToken);
      validateSessionExchange({
        claims,
        config: parseSessionAccessConfig(dependencies.env),
        nowSeconds: dependencies.nowSeconds(),
        origin: request.headers.get("origin"),
        expectedOrigin,
        csrfHeader: request.headers.get("x-csrf-token"),
        csrfCookie: parseCookie(request.headers.get("cookie"), CSRF_COOKIE_NAME),
      });
      let decision;
      try {
        decision = await dependencies.rateLimit({
          scope: "SESSION",
          key: requestRateLimitKey(request, claims.userId),
          limit: 10,
          windowSeconds: 60,
        });
      } catch {
        return error("RATE_LIMIT_UNAVAILABLE", 503);
      }
      if (!decision.allowed) return rateLimited(decision.retryAfterSeconds);

      const sessionCookie = await dependencies.sessionService.createSessionCookie(parsed.data.idToken, SESSION_DURATION_MS);
      const response = NextResponse.json({ status: "AUTHENTICATED" });
      response.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
        httpOnly: true,
        secure: expectedOrigin.startsWith("https://"),
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_DURATION_MS / 1_000,
      });
      response.headers.set("cache-control", "no-store");
      return response;
    } catch (errorValue) {
      if (errorValue instanceof BoundedBodyError) {
        if (errorValue.code === "BODY_TOO_LARGE") return error("BODY_TOO_LARGE", 413);
        if (errorValue.code === "UNSUPPORTED_MEDIA_TYPE") return error("UNSUPPORTED_MEDIA_TYPE", 415);
        return error("INVALID_SESSION_REQUEST", 400);
      }
      if (errorValue instanceof SyntaxError) return error("INVALID_SESSION_REQUEST", 400);
      return error("AUTHENTICATION_FAILED", 401);
    }
  };
}

function parseCookie(header: string | null, name: string): string | undefined {
  return header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

function rateLimited(retryAfterSeconds: number): Response {
  return Response.json({ error: "RATE_LIMITED" }, { status: 429, headers: { "cache-control": "no-store", "retry-after": String(retryAfterSeconds) } });
}

function error(code: string, status: number): Response {
  return Response.json({ error: code }, { status, headers: { "cache-control": "no-store" } });
}