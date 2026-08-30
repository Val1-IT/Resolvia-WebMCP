import Stripe from "stripe";
import { z } from "zod";

import type {
  AuthenticatedProviderPayload,
  ProviderAdapter,
} from "@/src/application/ports/external-services";
import {
  ResolutionEventSchema,
  type ResolutionEvent,
} from "@/src/domain/events/model";

const ApprovedRefundEventTypeSchema = z.enum([
  "refund.created",
  "refund.updated",
  "refund.failed",
]);

const RefundObjectSchema = z
  .object({
    id: z.string().min(1).max(255),
    object: z.literal("refund"),
    created: z.number().int().nonnegative(),
    metadata: z.record(z.string(), z.string()).nullable(),
    status: z.enum([
      "pending",
      "requires_action",
      "succeeded",
      "failed",
      "canceled",
    ]),
  })
  .passthrough();

const CaseIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^case-[A-Za-z0-9_-]+$/u);

export type StripeWebhookInput = {
  rawBody: string;
  signature: string | null;
};

export type StripeProviderErrorCode =
  | "INVALID_CONFIGURATION"
  | "INVALID_SIGNATURE"
  | "LIVE_MODE_REJECTED"
  | "MISSING_CASE_ID"
  | "INVALID_CASE_ID"
  | "INVALID_REFUND_OBJECT";

export class StripeProviderError extends Error {
  constructor(public readonly code: StripeProviderErrorCode) {
    super(`Stripe provider processing failed: ${code}`);
    this.name = "StripeProviderError";
  }
}

export type StripeProviderAdapterConfig = {
  apiKey: string;
  webhookSecret: string;
  now?: () => string;
};

export class StripeProviderAdapter
  implements ProviderAdapter<StripeWebhookInput, Stripe.Event>
{
  readonly provider = "stripe";
  private readonly stripe: Stripe;
  private readonly now: () => string;

  constructor(private readonly config: StripeProviderAdapterConfig) {
    if (
      !config.apiKey.startsWith("sk_test_") ||
      !config.webhookSecret.startsWith("whsec_")
    ) {
      throw new StripeProviderError("INVALID_CONFIGURATION");
    }
    this.stripe = new Stripe(config.apiKey);
    this.now = config.now ?? (() => new Date().toISOString());
  }

  async authenticate(
    input: StripeWebhookInput,
  ): Promise<AuthenticatedProviderPayload<Stripe.Event>> {
    if (!input.signature) {
      throw new StripeProviderError("INVALID_SIGNATURE");
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        input.rawBody,
        input.signature,
        this.config.webhookSecret,
      );
    } catch {
      throw new StripeProviderError("INVALID_SIGNATURE");
    }

    if (event.livemode) {
      throw new StripeProviderError("LIVE_MODE_REJECTED");
    }

    return {
      provider: this.provider,
      authenticatedAt: this.now(),
      raw: event,
    };
  }

  async normalize(
    input: AuthenticatedProviderPayload<Stripe.Event>,
  ): Promise<ResolutionEvent[]> {
    const eventType = ApprovedRefundEventTypeSchema.safeParse(input.raw.type);
    if (!eventType.success) return [];

    if (input.provider !== this.provider || input.raw.livemode) {
      throw new StripeProviderError("LIVE_MODE_REJECTED");
    }

    const refund = RefundObjectSchema.safeParse(input.raw.data.object);
    if (!refund.success) {
      throw new StripeProviderError("INVALID_REFUND_OBJECT");
    }

    const rawCaseId = refund.data.metadata?.resolvia_case_id;
    if (!rawCaseId) throw new StripeProviderError("MISSING_CASE_ID");
    const caseId = CaseIdSchema.safeParse(rawCaseId);
    if (!caseId.success) throw new StripeProviderError("INVALID_CASE_ID");

    const occurredAt = secondsToIso(input.raw.created);
    const providerObjectCreatedAt = secondsToIso(refund.data.created);
    if (!occurredAt || !providerObjectCreatedAt) {
      throw new StripeProviderError("INVALID_REFUND_OBJECT");
    }

    return [
      ResolutionEventSchema.parse({
        id: `stripe:${input.raw.id}`,
        caseId: caseId.data,
        kind:
          eventType.data === "refund.created"
            ? "PROVIDER_REFUND_OBSERVED"
            : "PROVIDER_REFUND_STATUS_UPDATED",
        source: {
          category: "PROVIDER",
          runtimeMode: "TEST",
          provider: this.provider,
        },
        occurredAt,
        receivedAt: input.authenticatedAt,
        correlationId: input.raw.id,
        payload: {
          providerEventId: input.raw.id,
          providerEventType: eventType.data,
          providerObjectId: refund.data.id,
          providerObjectType: refund.data.object,
          providerObjectCreatedAt,
          providerStatus: refund.data.status,
        },
      }),
    ];
  }
}

function secondsToIso(seconds: number): string | null {
  if (!Number.isSafeInteger(seconds) || seconds < 0) return null;
  const date = new Date(seconds * 1_000);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}
