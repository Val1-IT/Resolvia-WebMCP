import { z } from "zod";

import type { RateLimit } from "@/src/application/ports/rate-limiter";
import type { SubmitPartnerResponseResult } from "@/src/application/partners/submit-partner-response";
import {
  EnginePartnerGateway,
  type PartnerGatewayResponse,
} from "@/src/infrastructure/google/engine-partner-gateway";
import { getConnectedRateLimiter } from "@/src/infrastructure/google/get-connected-rate-limiter";
import { createGooglePubSubResolutionEventPublisher } from "@/src/infrastructure/google/pubsub-resolution-event-publisher";
import { getRuntimeConfig } from "@/src/infrastructure/google/runtime-config";
import { BoundedBodyError, readBoundedBody } from "@/src/infrastructure/http/bounded-body";
import { requestRateLimitKey } from "@/src/infrastructure/http/request-rate-limit-key";

const MAX_SUBMISSION_BYTES = 32 * 1024;
const SubmissionSchema = z.object({
  token: z.string().trim().min(43).max(256),
  requestedEvidenceType: z.enum(["SETTLEMENT_OCCURRED", "CUSTOMER_RECEIPT"]),
  responseStatus: z.enum(["CONFIRMED", "NOT_CONFIRMED"]),
  responseReference: z.string().trim().min(1).max(128),
  responseSummary: z.string().trim().min(1).max(500),
}).strict();

type SubmissionBody = z.infer<typeof SubmissionSchema>;
type SubmissionExecutor = (requestId: string, body: SubmissionBody) => Promise<SubmitPartnerResponseResult>;

export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }): Promise<Response> {
  const { requestId } = await context.params;
  try {
    const runtime = getRuntimeConfig(process.env);
    if (runtime.mode !== "CONNECTED" || !runtime.projectId || !runtime.topicName || !runtime.engineAudience) return unavailable(503);
    const gateway = new EnginePartnerGateway(runtime.engineAudience);
    const publisher = createGooglePubSubResolutionEventPublisher({ projectId: runtime.projectId, topicName: runtime.topicName, publisherService: "resolvia-partner-portal" });
    const limiter = getConnectedRateLimiter(runtime);
    return createPartnerPortalSubmitHandler({
      submit: (id, body) => submitViaEngine(gateway, publisher, id, body),
      rateLimit: (input) => limiter.consume(input),
    })(request, requestId);
  } catch {
    return unavailable(503);
  }
}

async function submitViaEngine(
  gateway: EnginePartnerGateway,
  publisher: { publish(event: import("@/src/domain/events/model").ResolutionEvent): Promise<void> },
  requestId: string,
  body: SubmissionBody,
): Promise<SubmitPartnerResponseResult> {
  const response: PartnerGatewayResponse = {
    requestedEvidenceType: body.requestedEvidenceType,
    responseStatus: body.responseStatus,
    responseReference: body.responseReference,
    responseSummary: body.responseSummary,
  };
  const prepared = await gateway.prepareSubmission(requestId, body.token, response);
  if (!prepared) return { kind: "ACCESS_UNAVAILABLE" };
  try {
    await publisher.publish(prepared.event);
    return { kind: "PUBLISHED", eventId: prepared.event.id };
  } catch {
    return { kind: "PUBLISH_UNCERTAIN" };
  }
}

export function createPartnerPortalSubmitHandler(dependencies: { submit: SubmissionExecutor; rateLimit: RateLimit }): (request: Request, requestId: string) => Promise<Response> {
  return async (request, requestId) => {
    let rawBody: string;
    try {
      rawBody = await readBoundedBody(request, MAX_SUBMISSION_BYTES, ["application/json"]);
    } catch (error) {
      if (error instanceof BoundedBodyError && error.code === "BODY_TOO_LARGE") return Response.json({ error: "REQUEST_TOO_LARGE" }, { status: 413 });
      return unavailable();
    }
    const parsed = SubmissionSchema.safeParse(parseJson(rawBody));
    if (!parsed.success) return unavailable();
    let decision;
    try {
      decision = await dependencies.rateLimit({ scope: "PARTNER", key: requestRateLimitKey(request, parsed.data.token), limit: 20, windowSeconds: 60 });
    } catch {
      return unavailable(503);
    }
    if (!decision.allowed) return unavailable(429, decision.retryAfterSeconds);
    const result = await dependencies.submit(requestId, parsed.data);
    return result.kind === "PUBLISHED" ? Response.json({ status: "ACCEPTED" }, { status: 202 }) : unavailable();
  };
}

function parseJson(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return null;
  }
}

function unavailable(status: 404 | 429 | 503 = 404, retryAfterSeconds?: number): Response {
  const error = status === 503 ? "PORTAL_UNAVAILABLE" : status === 429 ? "RATE_LIMITED" : "PORTAL_SUBMISSION_UNAVAILABLE";
  return Response.json({ error }, { status, ...(retryAfterSeconds ? { headers: { "retry-after": String(retryAfterSeconds) } } : {}) });
}