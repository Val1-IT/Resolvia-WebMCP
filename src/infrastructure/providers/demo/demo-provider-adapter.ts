import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type {
  AuthenticatedProviderPayload,
  ProviderAdapter,
} from "@/src/application/ports/external-services";
import {
  ResolutionEventSchema,
  type ResolutionEvent,
} from "@/src/domain/events/model";

const MaxRequestBytes = 256 * 1024;
const MaxNonceEntries = 10_000;
const MaxAgeMs = 300_000;
const MaxFutureSkewMs = 60_000;
const IsoDateTimeSchema = z.string().datetime({ offset: true });

const RequestSchema = z
  .object({
    schemaVersion: z.literal("resolvia-demo-provider-v1"),
    provider: z.literal("resolvia_demo_provider"),
    timestamp: IsoDateTimeSchema,
    nonce: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/u),
    eventId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),
    caseId: z.string().regex(/^case-[A-Za-z0-9_-]{1,120}$/u),
    eventType: z.enum(["refund.observed", "refund.updated"]),
    providerObjectId: z.string().regex(/^demo_refund_[A-Za-z0-9_-]{1,128}$/u),
    providerObjectCreatedAt: IsoDateTimeSchema,
    status: z.enum([
      "pending",
      "requires_action",
      "succeeded",
      "failed",
      "canceled",
    ]),
  })
  .strict();

export type DemoProviderRequest = z.infer<typeof RequestSchema>;

export type DemoProviderWebhookInput = {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
};

export class DemoProviderError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "DemoProviderError";
  }
}

/**
 * The signing string is deterministic: the timestamp header, a period, and
 * the exact canonical JSON bytes supplied as the request body. The body is
 * authenticated before it is parsed; parsing subsequently verifies that the
 * body is our canonical JSON representation and matches the signed timestamp.
 */
export function canonicalDemoProviderSigningInput(
  rawBody: string,
  timestamp: string,
): string {
  return `${timestamp}.${rawBody}`;
}

export function signDemoProviderRequest(
  rawBody: string,
  timestamp: string,
  secret: Buffer,
): string {
  return createHmac("sha256", secret)
    .update(canonicalDemoProviderSigningInput(rawBody, timestamp), "utf8")
    .digest("base64url");
}

export class DemoProviderAdapter
  implements ProviderAdapter<DemoProviderWebhookInput, DemoProviderRequest>
{
  readonly provider = "resolvia_demo_provider";
  private readonly seenNonces = new Map<string, number>();

  constructor(
    private readonly config: {
      secret: Buffer;
      now?: () => string;
      maxAgeMs?: number;
    },
  ) {
    if (config.secret.length < 32) {
      throw new DemoProviderError("INVALID_CONFIGURATION");
    }
  }

  async authenticate(
    input: DemoProviderWebhookInput,
  ): Promise<AuthenticatedProviderPayload<DemoProviderRequest>> {
    if (Buffer.byteLength(input.rawBody, "utf8") > MaxRequestBytes) {
      throw new DemoProviderError("REQUEST_TOO_LARGE");
    }
    if (!input.signature?.match(/^[A-Za-z0-9_-]{43}$/u)) {
      throw new DemoProviderError("INVALID_SIGNATURE");
    }
    if (!input.timestamp || !IsoDateTimeSchema.safeParse(input.timestamp).success) {
      throw new DemoProviderError("INVALID_TIMESTAMP");
    }

    const expected = Buffer.from(
      signDemoProviderRequest(input.rawBody, input.timestamp, this.config.secret),
      "base64url",
    );
    const provided = Buffer.from(input.signature, "base64url");
    if (
      expected.length !== provided.length ||
      !timingSafeEqual(expected, provided)
    ) {
      throw new DemoProviderError("INVALID_SIGNATURE");
    }

    let raw: DemoProviderRequest;
    try {
      raw = RequestSchema.parse(JSON.parse(input.rawBody));
    } catch {
      throw new DemoProviderError("INVALID_REQUEST");
    }
    if (raw.timestamp !== input.timestamp || JSON.stringify(raw) !== input.rawBody) {
      throw new DemoProviderError("INVALID_REQUEST");
    }

    const now = (this.config.now ?? (() => new Date().toISOString()))();
    const nowMs = new Date(now).valueOf();
    const timestampMs = new Date(raw.timestamp).valueOf();
    const maxAgeMs = this.config.maxAgeMs ?? MaxAgeMs;
    if (
      !Number.isFinite(nowMs) ||
      !Number.isFinite(timestampMs) ||
      nowMs - timestampMs > maxAgeMs ||
      timestampMs - nowMs > MaxFutureSkewMs
    ) {
      throw new DemoProviderError("INVALID_TIMESTAMP");
    }

    this.pruneNonces(nowMs);
    if (this.seenNonces.has(raw.nonce)) {
      throw new DemoProviderError("REPLAYED_NONCE");
    }
    this.seenNonces.set(raw.nonce, nowMs + maxAgeMs);
    if (this.seenNonces.size > MaxNonceEntries) {
      throw new DemoProviderError("REPLAY_CAPACITY_EXCEEDED");
    }

    return {
      provider: this.provider,
      authenticatedAt: now,
      raw,
    };
  }

  async normalize(
    input: AuthenticatedProviderPayload<DemoProviderRequest>,
  ): Promise<ResolutionEvent[]> {
    if (input.provider !== this.provider) {
      throw new DemoProviderError("INVALID_PROVIDER");
    }
    const raw = input.raw;
    return [
      ResolutionEventSchema.parse({
        id: `${this.provider}:${raw.eventId}`,
        caseId: raw.caseId,
        kind:
          raw.eventType === "refund.observed"
            ? "PROVIDER_REFUND_OBSERVED"
            : "PROVIDER_REFUND_STATUS_UPDATED",
        source: {
          category: "PROVIDER",
          provider: this.provider,
          runtimeMode: "TEST",
        },
        occurredAt: raw.timestamp,
        receivedAt: input.authenticatedAt,
        correlationId: raw.eventId,
        payload: {
          providerEventId: raw.eventId,
          providerEventType: raw.eventType,
          providerObjectId: raw.providerObjectId,
          providerObjectType: "refund",
          providerObjectCreatedAt: raw.providerObjectCreatedAt,
          providerStatus: raw.status,
        },
      }),
    ];
  }

  private pruneNonces(nowMs: number): void {
    for (const [nonce, expiresAt] of this.seenNonces) {
      if (expiresAt <= nowMs) {
        this.seenNonces.delete(nonce);
      }
    }
  }
}