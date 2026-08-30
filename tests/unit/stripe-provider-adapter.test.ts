import { describe, expect, it } from "vitest";

import { StripeProviderAdapter } from "@/src/infrastructure/providers/stripe/stripe-provider-adapter";
import {
  STRIPE_EVENT_CREATED_SECONDS,
  STRIPE_TEST_API_KEY,
  STRIPE_TEST_WEBHOOK_SECRET,
  serializeStripeFixture,
  signStripeFixture,
} from "@/tests/fixtures/stripe";

const AUTHENTICATED_AT = "2026-08-11T12:00:00.000Z";

function makeAdapter() {
  return new StripeProviderAdapter({
    apiKey: STRIPE_TEST_API_KEY,
    webhookSecret: STRIPE_TEST_WEBHOOK_SECRET,
    now: () => AUTHENTICATED_AT,
  });
}

describe("StripeProviderAdapter", () => {
  it("authenticates and normalizes an approved Test Mode refund event", async () => {
    const rawBody = serializeStripeFixture();
    const authenticated = await makeAdapter().authenticate({
      rawBody,
      signature: signStripeFixture(rawBody),
    });

    await expect(makeAdapter().normalize(authenticated)).resolves.toEqual([
      {
        id: "stripe:evt_test_refund",
        caseId: "case-rv-1028",
        kind: "PROVIDER_REFUND_STATUS_UPDATED",
        source: {
          category: "PROVIDER",
          runtimeMode: "TEST",
          provider: "stripe",
        },
        occurredAt: new Date(
          STRIPE_EVENT_CREATED_SECONDS * 1_000,
        ).toISOString(),
        receivedAt: AUTHENTICATED_AT,
        correlationId: "evt_test_refund",
        payload: {
          providerEventId: "evt_test_refund",
          providerEventType: "refund.updated",
          providerObjectId: "re_test_refund",
          providerObjectType: "refund",
          providerObjectCreatedAt: new Date(
            STRIPE_EVENT_CREATED_SECONDS * 1_000,
          ).toISOString(),
          providerStatus: "pending",
        },
      },
    ]);
  });

  it("rejects one-byte-modified raw content with the original signature", async () => {
    const rawBody = serializeStripeFixture();
    const signature = signStripeFixture(rawBody);

    await expect(
      makeAdapter().authenticate({ rawBody: `${rawBody} `, signature }),
    ).rejects.toMatchObject({
      code: "INVALID_SIGNATURE",
    });
  });

  it("rejects an absent signature", async () => {
    await expect(
      makeAdapter().authenticate({
        rawBody: serializeStripeFixture(),
        signature: null,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_SIGNATURE",
    });
  });

  it("rejects an authenticated live-mode event", async () => {
    const rawBody = serializeStripeFixture({ livemode: true });
    await expect(
      makeAdapter().authenticate({
        rawBody,
        signature: signStripeFixture(rawBody),
      }),
    ).rejects.toMatchObject({
      code: "LIVE_MODE_REJECTED",
    });
  });

  it("returns no normalized events for a signed unsupported event type", async () => {
    const rawBody = serializeStripeFixture({
      eventType: "charge.succeeded",
    });
    const authenticated = await makeAdapter().authenticate({
      rawBody,
      signature: signStripeFixture(rawBody),
    });

    await expect(makeAdapter().normalize(authenticated)).resolves.toEqual([]);
  });

  it.each([
    ["missing case metadata", { caseId: null }, "MISSING_CASE_ID"],
    ["malformed case metadata", { caseId: "../case-other" }, "INVALID_CASE_ID"],
    ["missing refund ID", { refundId: null }, "INVALID_REFUND_OBJECT"],
    ["wrong provider object", { refundObject: "charge" }, "INVALID_REFUND_OBJECT"],
  ] as const)("rejects %s after authentication", async (_label, options, code) => {
    const rawBody = serializeStripeFixture(options);
    const adapter = makeAdapter();
    const authenticated = await adapter.authenticate({
      rawBody,
      signature: signStripeFixture(rawBody),
    });

    await expect(adapter.normalize(authenticated)).rejects.toMatchObject({ code });
  });

  it("normalizes duplicate delivery to the same event ID", async () => {
    const rawBody = serializeStripeFixture();
    const input = { rawBody, signature: signStripeFixture(rawBody) };
    const first = await makeAdapter().normalize(
      await makeAdapter().authenticate(input),
    );
    const second = await makeAdapter().normalize(
      await makeAdapter().authenticate(input),
    );

    expect(first[0]?.id).toBe("stripe:evt_test_refund");
    expect(second[0]?.id).toBe(first[0]?.id);
  });
});
