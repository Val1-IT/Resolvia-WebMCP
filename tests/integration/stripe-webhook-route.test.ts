import { describe, expect, it, vi } from "vitest";

import type { ResolutionEventPublisher } from "@/src/application/ports/external-services";
import { createStripeWebhookHandler } from "@/app/api/providers/stripe/webhook/route";
import { StripeProviderAdapter } from "@/src/infrastructure/providers/stripe/stripe-provider-adapter";
import {
  STRIPE_TEST_API_KEY,
  STRIPE_TEST_WEBHOOK_SECRET,
  serializeStripeFixture,
  signStripeFixture,
} from "@/tests/fixtures/stripe";

const AUTHENTICATED_AT = "2026-08-11T12:00:00.000Z";

function requestFor(rawBody: string, signature?: string): Request {
  return new Request("http://localhost/api/providers/stripe/webhook", {
    method: "POST",
    body: rawBody,
    headers: { "content-type": "application/json", ...(signature ? { "stripe-signature": signature } : {}) },
  });
}

function dependencies() {
  const publish = vi.fn<ResolutionEventPublisher["publish"]>();
  return {
    publish,
    handler: createStripeWebhookHandler({
      adapter: new StripeProviderAdapter({
        apiKey: STRIPE_TEST_API_KEY,
        webhookSecret: STRIPE_TEST_WEBHOOK_SECRET,
        now: () => AUTHENTICATED_AT,
      }),
      publisher: { publish },
    }),
  };
}

describe("Stripe webhook route", () => {
  it("reads the raw body once and publishes one authenticated normalized event", async () => {
    const rawBody = serializeStripeFixture();
    const request = requestFor(rawBody, signStripeFixture(rawBody));
    const { handler, publish } = dependencies();

    const response = await handler(request);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      status: "ACCEPTED",
      published: 1,
    });
    expect(request.bodyUsed).toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ id: "stripe:evt_test_refund" }),
    );
  });

  it("rejects an oversized body before signature verification or publication", async () => {
    const { handler, publish } = dependencies();
    const response = await handler(requestFor("x".repeat(256 * 1024 + 1), "invalid"));
    expect(response.status).toBe(413);
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects a modified raw body and publishes nothing", async () => {
    const rawBody = serializeStripeFixture();
    const { handler, publish } = dependencies();

    const response = await handler(
      requestFor(`${rawBody} `, signStripeFixture(rawBody)),
    );

    expect(response.status).toBe(400);
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects an unsigned webhook and publishes nothing", async () => {
    const { handler, publish } = dependencies();

    const response = await handler(requestFor(serializeStripeFixture()));

    expect(response.status).toBe(400);
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects a signed live-mode event and publishes nothing", async () => {
    const rawBody = serializeStripeFixture({ livemode: true });
    const { handler, publish } = dependencies();

    const response = await handler(
      requestFor(rawBody, signStripeFixture(rawBody)),
    );

    expect(response.status).toBe(400);
    expect(publish).not.toHaveBeenCalled();
  });

  it("acknowledges a signed unsupported event without publishing", async () => {
    const rawBody = serializeStripeFixture({
      eventType: "charge.succeeded",
    });
    const { handler, publish } = dependencies();

    const response = await handler(
      requestFor(rawBody, signStripeFixture(rawBody)),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      status: "IGNORED",
      published: 0,
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it("fails closed when signed refund metadata is missing", async () => {
    const rawBody = serializeStripeFixture({ caseId: null });
    const { handler, publish } = dependencies();

    const response = await handler(
      requestFor(rawBody, signStripeFixture(rawBody)),
    );

    expect(response.status).toBe(400);
    expect(publish).not.toHaveBeenCalled();
  });
});
