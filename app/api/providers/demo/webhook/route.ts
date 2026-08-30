import { createHash, randomUUID } from "node:crypto";

import type {
  ProviderAdapter,
  ResolutionEventPublisher,
} from "@/src/application/ports/external-services";
import type {
  IngressReplayClaim,
  IngressReplayGuard,
} from "@/src/application/ports/ingress-replay-guard";
import type { RateLimit } from "@/src/application/ports/rate-limiter";
import { getDemoProviderSecret } from "@/src/infrastructure/google/demo-provider-secret";
import { getConnectedIngressReplayGuard } from "@/src/infrastructure/google/get-connected-ingress-replay-guard";
import { getConnectedRateLimiter } from "@/src/infrastructure/google/get-connected-rate-limiter";
import {
  getRuntimeConfig,
  ConnectedConfigurationError,
} from "@/src/infrastructure/google/runtime-config";
import { createGooglePubSubResolutionEventPublisher } from "@/src/infrastructure/google/pubsub-resolution-event-publisher";
import {
  DemoProviderAdapter,
  DemoProviderError,
  type DemoProviderRequest,
  type DemoProviderWebhookInput,
} from "@/src/infrastructure/providers/demo/demo-provider-adapter";
import {
  BoundedBodyError,
  readBoundedBody,
} from "@/src/infrastructure/http/bounded-body";
import { requestRateLimitKey } from "@/src/infrastructure/http/request-rate-limit-key";

const MAX_WEBHOOK_BYTES = 256 * 1024;
const REPLAY_LEASE_MS = 60_000;
const REPLAY_RECEIPT_MS = 10 * 60_000;

export async function POST(request: Request): Promise<Response> {
  try {
    const runtime = getRuntimeConfig(process.env);
    if (
      runtime.mode !== "CONNECTED" ||
      !runtime.projectId ||
      !runtime.topicName
    ) {
      return Response.json(
        { error: "UNSUPPORTED_RUNTIME_MODE" },
        { status: 503 },
      );
    }
    const secret = await getDemoProviderSecret(runtime.projectId);
    const limiter = getConnectedRateLimiter(runtime);
    return createDemoProviderWebhookHandler({
      adapter: new DemoProviderAdapter({ secret }),
      publisher: createGooglePubSubResolutionEventPublisher({
        projectId: runtime.projectId,
        topicName: runtime.topicName,
        publisherService: "resolvia-web",
      }),
      rateLimit: (input) => limiter.consume(input),
      replayGuard: getConnectedIngressReplayGuard(runtime),
    })(request);
  } catch (error) {
    if (error instanceof ConnectedConfigurationError) {
      return Response.json(
        { error: "CONNECTED_CONFIGURATION_UNAVAILABLE" },
        { status: 503 },
      );
    }
    return Response.json(
      { error: "DEMO_PROVIDER_UNAVAILABLE" },
      { status: 503 },
    );
  }
}

type DemoProviderWebhookHandlerDependencies = {
  adapter: ProviderAdapter<DemoProviderWebhookInput, DemoProviderRequest>;
  publisher: ResolutionEventPublisher;
  rateLimit: RateLimit;
  replayGuard?: IngressReplayGuard;
};

export function createDemoProviderWebhookHandler(
  dependencies: DemoProviderWebhookHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      const rawBody = await readBoundedBody(request, MAX_WEBHOOK_BYTES, [
        "application/json",
      ]);
      const authenticated = await dependencies.adapter.authenticate({
        rawBody,
        signature: request.headers.get("x-resolvia-demo-signature"),
        timestamp: request.headers.get("x-resolvia-demo-timestamp"),
      });
      let decision;
      try {
        decision = await dependencies.rateLimit({
          scope: "PROVIDER",
          key: requestRateLimitKey(request, "resolvia_demo_provider"),
          limit: 60,
          windowSeconds: 60,
        });
      } catch {
        return Response.json(
          { error: "RATE_LIMIT_UNAVAILABLE" },
          { status: 503 },
        );
      }
      if (!decision.allowed) {
        return Response.json(
          { error: "RATE_LIMITED" },
          {
            status: 429,
            headers: { "retry-after": String(decision.retryAfterSeconds) },
          },
        );
      }

      const replayClaim = dependencies.replayGuard
        ? createReplayClaim(
            authenticated.raw,
            rawBody,
            authenticated.authenticatedAt,
          )
        : undefined;
      if (replayClaim && dependencies.replayGuard) {
        const replayDecision = await dependencies.replayGuard.claim(replayClaim);
        if (replayDecision.kind === "DUPLICATE") {
          return Response.json(
            { status: "DUPLICATE", published: 0 },
            { status: 202 },
          );
        }
        if (replayDecision.kind === "IN_PROGRESS") {
          return Response.json(
            { error: "REPLAY_IN_PROGRESS" },
            { status: 503, headers: { "retry-after": "60" } },
          );
        }
      }

      let published = false;
      try {
        const events = await dependencies.adapter.normalize(authenticated);
        for (const event of events) {
          await dependencies.publisher.publish(event);
        }
        published = true;
        if (replayClaim && dependencies.replayGuard) {
          await dependencies.replayGuard.markPublished(replayClaim);
        }
        return Response.json(
          { status: "ACCEPTED", published: events.length },
          { status: 202 },
        );
      } catch (error) {
        if (!published && replayClaim && dependencies.replayGuard) {
          await dependencies.replayGuard
            .release(replayClaim)
            .catch(() => undefined);
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof BoundedBodyError) return bodyError(error);
      if (error instanceof DemoProviderError) {
        return Response.json(
          { error: "INVALID_DEMO_PROVIDER_REQUEST" },
          { status: 400 },
        );
      }
      return Response.json(
        { error: "DEMO_PROVIDER_PROCESSING_FAILED" },
        { status: 503 },
      );
    }
  };
}

function createReplayClaim(
  payload: DemoProviderRequest,
  rawBody: string,
  authenticatedAt: string,
): IngressReplayClaim {
  const nowMs = Date.parse(authenticatedAt);
  if (!Number.isFinite(nowMs)) {
    throw new DemoProviderError("INVALID_TIMESTAMP");
  }
  return {
    scope: "DEMO_PROVIDER",
    replayKey: payload.nonce,
    payloadDigest: `sha256:${createHash("sha256").update(rawBody, "utf8").digest("hex")}`,
    semanticId: `resolvia_demo_provider:${payload.eventId}`,
    leaseId: randomUUID(),
    now: new Date(nowMs).toISOString(),
    leaseUntil: new Date(nowMs + REPLAY_LEASE_MS).toISOString(),
    expiresAt: new Date(nowMs + REPLAY_RECEIPT_MS).toISOString(),
  };
}

function bodyError(error: BoundedBodyError): Response {
  if (error.code === "BODY_TOO_LARGE") {
    return Response.json({ error: "REQUEST_TOO_LARGE" }, { status: 413 });
  }
  if (error.code === "UNSUPPORTED_MEDIA_TYPE") {
    return Response.json({ error: "UNSUPPORTED_MEDIA_TYPE" }, { status: 415 });
  }
  return Response.json({ error: "INVALID_REQUEST_BODY" }, { status: 400 });
}
