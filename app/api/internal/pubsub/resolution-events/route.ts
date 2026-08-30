import { z } from "zod";

import { processProviderEvent } from "@/src/application/events/process-provider-event";
import { processPartnerEvent } from "@/src/application/events/process-partner-event";
import type { ResolutionStore } from "@/src/application/ports/resolution-store";
import { createPubSubPushHandler, type PubSubPushDelivery } from "@/src/infrastructure/google/pubsub-push-handler";
import { type RuntimeConfig, getRuntimeConfig } from "@/src/infrastructure/google/runtime-config";
import { type PubSubIdentityVerifier, verifyGooglePubSubIdentity } from "@/src/infrastructure/google/pubsub-push-identity";
import {
  assertEventCategoryMatchesChannel,
  buildAllowedPushServiceAccounts,
  resolveChannelFromVerifiedPrincipal,
  type PushChannel,
} from "@/src/infrastructure/google/release/m1-channel-identity";
import { getResolutionStoreForRuntime } from "@/src/infrastructure/runtime/get-resolution-store-for-runtime";
import { formatStructuredLog } from "@/src/infrastructure/observability/structured-log";

const MAX_BODY_BYTES = 256 * 1024;
const PushMessageSchema = z.object({
  data: z.string().min(1),
  messageId: z.string().min(1).max(256),
  message_id: z.string().min(1).max(256).optional(),
  publishTime: z.string().datetime({ offset: true }).optional(),
  publish_time: z.string().datetime({ offset: true }).optional(),
  orderingKey: z.string().max(1024).optional(),
  attributes: z.record(z.string().min(1).max(256), z.string().max(1024)).optional(),
}).strict();

const PushBodySchema = z.object({
  subscription: z.string().regex(/^projects\/[^/]+\/subscriptions\/[^/]+$/u),
  message: PushMessageSchema,
  deliveryAttempt: z.number().int().positive().optional(),
}).strict();

type ConnectedRuntime = RuntimeConfig & {
  mode: "CONNECTED";
  projectId: string;
  subscriptionName: string;
  engineAudience: string;
  pubsubPushServiceAccount: string;
};

type RouteDependencies = {
  getRuntime: () => RuntimeConfig;
  getStore: (runtime: RuntimeConfig) => ResolutionStore;
  verifyIdentity: PubSubIdentityVerifier;
  now?: () => string;
};

export const POST = createResolutionEventsRoute({
  getRuntime: () => getRuntimeConfig(process.env),
  getStore: getResolutionStoreForRuntime,
  verifyIdentity: verifyGooglePubSubIdentity,
});

export function createResolutionEventsRoute(dependencies: RouteDependencies): (request: Request) => Promise<Response> {
  const now = dependencies.now ?? (() => new Date().toISOString());
  return async (request) => {
    let runtime: ConnectedRuntime;
    try {
      const candidate = dependencies.getRuntime();
      if (!isConnectedRuntime(candidate)) return unavailable();
      runtime = candidate;
    } catch {
      return unavailable();
    }

    const allowedAccounts = allowedPushAccounts(runtime);
    const verifiedEmail = await dependencies.verifyIdentity(
      request,
      runtime.engineAudience,
      allowedAccounts,
    );
    if (!verifiedEmail) {
      return new Response(null, { status: 401 });
    }

    const delivery = await parseDelivery(request, runtime.engineAudience);
    if (!delivery) return new Response(null, { status: 204 });

    let store: ResolutionStore;
    try {
      store = dependencies.getStore(runtime);
    } catch {
      return unavailable();
    }
    const handler = createPubSubPushHandler({
      expectedProjectId: runtime.projectId,
      expectedSubscriptionName: runtime.subscriptionName,
      expectedAudience: runtime.engineAudience,
      processEvent: async (event) => {
        const channel = resolveProcessingChannel(verifiedEmail, runtime, event.source.category);
        if (!channel) {
          return { kind: "CASE_INTEGRITY_ERROR" as const };
        }
        return channel === "PARTNER"
          ? processPartnerEvent(store, event, now)
          : processProviderEvent(store, event, now);
      },
    });
    const outcome = await handler(delivery);
    if (outcome.kind === "RETRY") return unavailable();
    if (outcome.kind === "ACK_COMMITTED" || outcome.kind === "ACK_DUPLICATE") {
      return new Response(null, { status: 204 });
    }
    console.warn(formatStructuredLog({
      severity: "WARNING",
      component: "resolution-events-route",
      requestId: delivery.message.messageId,
      outcome: outcome.kind,
      errorClass: outcome.reason,
    }));
    return new Response(null, { status: 204 });
  };
}

function allowedPushAccounts(runtime: ConnectedRuntime): string[] {
  if (runtime.providerPushServiceAccount && runtime.partnerPushServiceAccount) {
    return buildAllowedPushServiceAccounts({
      providerPushSa: runtime.providerPushServiceAccount,
      partnerPushSa: runtime.partnerPushServiceAccount,
      legacyPushSa: runtime.pubsubPushServiceAccount,
    });
  }
  return [runtime.pubsubPushServiceAccount];
}

function resolveProcessingChannel(
  verifiedEmail: string,
  runtime: ConnectedRuntime,
  eventCategory: string,
): PushChannel | null {
  if (runtime.providerPushServiceAccount && runtime.partnerPushServiceAccount) {
    const channel = resolveChannelFromVerifiedPrincipal(verifiedEmail, {
      providerPushSa: runtime.providerPushServiceAccount,
      partnerPushSa: runtime.partnerPushServiceAccount,
      legacyPushSa: runtime.pubsubPushServiceAccount,
    });
    if (!channel) return null;
    if (!assertEventCategoryMatchesChannel(eventCategory, channel)) return null;
    return channel;
  }
  if (verifiedEmail !== runtime.pubsubPushServiceAccount) return null;
  if (eventCategory === "PARTNER") return "PARTNER";
  if (eventCategory === "PROVIDER") return "PROVIDER";
  return null;
}

async function parseDelivery(request: Request, audience: string): Promise<PubSubPushDelivery | null> {
  const body = await readBoundedBody(request);
  if (!body) return null;
  let parsed: z.infer<typeof PushBodySchema>;
  try { parsed = PushBodySchema.parse(JSON.parse(body)); } catch { return null; }
  const match = parsed.subscription.match(/^projects\/([^/]+)\/subscriptions\/([^/]+)$/u);
  if (!match?.[1] || !match[2]) return null;
  return { authenticated: true, projectId: match[1], subscriptionName: match[2], audience, message: parsed.message };
}

async function readBoundedBody(request: Request): Promise<string | null> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(result.value);
  }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); } catch { return null; }
}

function isConnectedRuntime(runtime: RuntimeConfig): runtime is ConnectedRuntime {
  return runtime.mode === "CONNECTED" && Boolean(runtime.projectId && runtime.subscriptionName && runtime.engineAudience && runtime.pubsubPushServiceAccount);
}

function unavailable(): Response { return new Response(null, { status: 503 }); }
