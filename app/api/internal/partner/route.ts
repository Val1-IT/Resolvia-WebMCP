import { z } from "zod";

import { preparePartnerResponse, type PartnerResponse } from "@/src/application/partners/submit-partner-response";
import type { ResolutionStore } from "@/src/application/ports/resolution-store";
import { portalContext, validatePartnerTokenAccess } from "@/src/domain/partners/policy";
import { type RuntimeConfig, getRuntimeConfig } from "@/src/infrastructure/google/runtime-config";
import { type PubSubIdentityVerifier, verifyGooglePubSubIdentity } from "@/src/infrastructure/google/pubsub-push-identity";
import { BoundedBodyError, readBoundedBody } from "@/src/infrastructure/http/bounded-body";
import { getResolutionStoreForRuntime } from "@/src/infrastructure/runtime/get-resolution-store-for-runtime";

const MAX_INTERNAL_PARTNER_BODY_BYTES = 32 * 1_024;

const RecordIdSchema = z.string().trim().min(1).max(128);
const TokenSchema = z.string().trim().min(43).max(256);
const PartnerResponseSchema = z.object({
  requestedEvidenceType: z.enum(["SETTLEMENT_OCCURRED", "CUSTOMER_RECEIPT"]),
  responseStatus: z.enum(["CONFIRMED", "NOT_CONFIRMED"]),
  responseReference: z.string().trim().min(1).max(128),
  responseSummary: z.string().trim().min(1).max(500),
}).strict();
const InternalPartnerBodySchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("access"), requestId: RecordIdSchema, token: TokenSchema }).strict(),
  z.object({ operation: z.literal("prepare"), requestId: RecordIdSchema, token: TokenSchema, response: PartnerResponseSchema }).strict(),
  z.object({ operation: z.literal("release"), requestId: RecordIdSchema, eventId: RecordIdSchema }).strict(),
]);

type ConnectedRuntime = RuntimeConfig & {
  mode: "CONNECTED";
  projectId: string;
  engineAudience: string;
};
type RouteDependencies = {
  getRuntime: () => RuntimeConfig;
  getStore: (runtime: RuntimeConfig) => ResolutionStore;
  verifyIdentity: PubSubIdentityVerifier;
  now?: () => string;
};

export const POST = createInternalPartnerRoute({
  getRuntime: () => getRuntimeConfig(process.env),
  getStore: getResolutionStoreForRuntime,
  verifyIdentity: verifyGooglePubSubIdentity,
});

export function createInternalPartnerRoute(dependencies: RouteDependencies): (request: Request) => Promise<Response> {
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

    const expectedWebServiceAccount = `resolvia-web@${runtime.projectId}.iam.gserviceaccount.com`;
    if (!(await dependencies.verifyIdentity(request, runtime.engineAudience, [expectedWebServiceAccount]))) {
      return new Response(null, { status: 401 });
    }

    let parsed: ReturnType<typeof InternalPartnerBodySchema.safeParse>;
    try {
      const rawBody = await readBoundedBody(
        request,
        MAX_INTERNAL_PARTNER_BODY_BYTES,
        ["application/json"],
      );
      parsed = InternalPartnerBodySchema.safeParse(JSON.parse(rawBody));
    } catch (error) {
      if (error instanceof BoundedBodyError && error.code === "BODY_TOO_LARGE") {
        return Response.json(
          { error: "BODY_TOO_LARGE" },
          { status: 413, headers: { "cache-control": "no-store" } },
        );
      }
      return notFound();
    }
    if (!parsed.success) return notFound();

    let store: ResolutionStore;
    try {
      store = dependencies.getStore(runtime);
      if (parsed.data.operation === "access") {
        return access(store, parsed.data.requestId, parsed.data.token, now());
      }
      if (parsed.data.operation === "prepare") {
        return prepare(store, parsed.data.requestId, parsed.data.token, parsed.data.response, now);
      }
      return release(store, parsed.data.requestId, parsed.data.eventId, now());
    } catch {
      return unavailable();
    }
  };
}

async function access(store: ResolutionStore, requestId: string, token: string, timestamp: string): Promise<Response> {
  const partnerAccess = await store.loadPartnerRequest(requestId);
  if (!partnerAccess) return notFound();
  const validation = validatePartnerTokenAccess({
    ...partnerAccess,
    rawToken: token,
    caseId: partnerAccess.request.caseId,
    now: timestamp,
  });
  return validation.ok ? Response.json(portalContext(partnerAccess.request)) : notFound();
}

async function prepare(
  store: ResolutionStore,
  requestId: string,
  token: string,
  response: PartnerResponse,
  now: () => string,
): Promise<Response> {
  const prepared = await preparePartnerResponse({ store, now, requestId, rawToken: token, response });
  return prepared.kind === "PREPARED" ? Response.json({ event: prepared.event }) : notFound();
}

async function release(store: ResolutionStore, requestId: string, eventId: string, timestamp: string): Promise<Response> {
  const partnerAccess = await store.loadPartnerRequest(requestId);
  if (!partnerAccess) return notFound();
  const result = await store.releasePartnerSubmission({
    requestId,
    tokenDigest: partnerAccess.tokenReceipt.digest,
    submissionEventId: eventId,
    now: timestamp,
  });
  return result === "COMMITTED" ? Response.json({}) : notFound();
}

function isConnectedRuntime(runtime: RuntimeConfig): runtime is ConnectedRuntime {
  return runtime.mode === "CONNECTED" && Boolean(runtime.projectId && runtime.engineAudience);
}
function notFound(): Response { return Response.json({ error: "PARTNER_INTERNAL_UNAVAILABLE" }, { status: 404 }); }
function unavailable(): Response { return Response.json({ error: "PARTNER_INTERNAL_UNAVAILABLE" }, { status: 503 }); }