import { z } from "zod";

import type { RateLimit } from "@/src/application/ports/rate-limiter";
import {
  type PartnerPortalContext,
  EnginePartnerGateway,
} from "@/src/infrastructure/google/engine-partner-gateway";
import { getConnectedRateLimiter } from "@/src/infrastructure/google/get-connected-rate-limiter";
import { getRuntimeConfig } from "@/src/infrastructure/google/runtime-config";
import { BoundedBodyError, readBoundedBody } from "@/src/infrastructure/http/bounded-body";
import { requestRateLimitKey } from "@/src/infrastructure/http/request-rate-limit-key";

const AccessBodySchema = z.object({ token: z.string().trim().min(1).max(256) }).strict();

type PartnerPortalAccessDependencies = {
  access: (requestId: string, token: string) => Promise<PartnerPortalContext | null>;
  rateLimit: RateLimit;
};

export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }): Promise<Response> {
  const { requestId } = await context.params;
  try {
    const runtime = getRuntimeConfig(process.env);
    if (runtime.mode !== "CONNECTED" || !runtime.engineAudience) return unavailable(503);
    const gateway = new EnginePartnerGateway(runtime.engineAudience);
    const limiter = getConnectedRateLimiter(runtime);
    return createPartnerPortalAccessHandler({
      access: (id, token) => gateway.access(id, token),
      rateLimit: (input) => limiter.consume(input),
    })(request, requestId);
  } catch {
    return unavailable(503);
  }
}

export function createPartnerPortalAccessHandler(dependencies: PartnerPortalAccessDependencies): (request: Request, requestId: string) => Promise<Response> {
  return async (request, requestId) => {
    let rawBody: string;
    try {
      rawBody = await readBoundedBody(request, 32 * 1024, ["application/json"]);
    } catch (error) {
      if (error instanceof BoundedBodyError && error.code === "BODY_TOO_LARGE") return unavailable(413);
      if (error instanceof BoundedBodyError && error.code === "UNSUPPORTED_MEDIA_TYPE") return unavailable(415);
      return unavailable(404);
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return unavailable(404);
    }
    const parsed = AccessBodySchema.safeParse(body);
    if (!parsed.success) return unavailable(404);
    let decision;
    try {
      decision = await dependencies.rateLimit({
        scope: "PARTNER",
        key: requestRateLimitKey(request, parsed.data.token),
        limit: 20,
        windowSeconds: 60,
      });
    } catch {
      return unavailable(503);
    }
    if (!decision.allowed) return unavailable(429, decision.retryAfterSeconds);
    const portalContext = await dependencies.access(requestId, parsed.data.token);
    return portalContext ? Response.json(portalContext) : unavailable(404);
  };
}

function unavailable(status: 404 | 413 | 415 | 429 | 503, retryAfterSeconds?: number): Response {
  const error = status === 503
    ? "PORTAL_UNAVAILABLE"
    : status === 429
      ? "RATE_LIMITED"
      : status === 413
        ? "BODY_TOO_LARGE"
        : status === 415
          ? "UNSUPPORTED_MEDIA_TYPE"
          : "PORTAL_ACCESS_UNAVAILABLE";
  return Response.json({ error }, {
    status,
    ...(retryAfterSeconds ? { headers: { "retry-after": String(retryAfterSeconds) } } : {}),
  });
}