import { describe, expect, it } from "vitest";

import {
  ConnectedEventEnvelopeError,
  createConnectedEventEnvelope,
  parseConnectedEventEnvelope,
  serializeConnectedEventEnvelope,
} from "@/src/infrastructure/google/pubsub-envelope";
import { makeEvent } from "@/tests/fixtures/domain";

const PUBLISHED_AT = "2026-08-12T12:00:00.000Z";

describe("connected Pub/Sub event envelope", () => {
  it("preserves a Stripe TEST source while marking only delivery as CONNECTED", () => {
    const event = makeEvent({
      id: "stripe:evt_test_refund",
      kind: "PROVIDER_REFUND_OBSERVED",
      source: { category: "PROVIDER", provider: "stripe", runtimeMode: "TEST" },
      correlationId: "evt_test_refund",
      payload: { beta: "two", alpha: "one" },
    });

    const envelope = createConnectedEventEnvelope(event, {
      publishedAt: PUBLISHED_AT,
      publisherService: "resolvia-web",
    });

    expect(envelope).toMatchObject({
      schemaVersion: "resolution-event-envelope-v1",
      deliveryRuntime: "CONNECTED",
      publishedAt: PUBLISHED_AT,
      publisherService: "resolvia-web",
      event: {
        id: "stripe:evt_test_refund",
        source: {
          category: "PROVIDER",
          provider: "stripe",
          runtimeMode: "TEST",
        },
      },
    });
    expect(envelope.payloadDigest).toMatch(/^sha256:[A-Za-z0-9_-]{43}$/u);
  });

  it("derives the same digest from semantically identical event JSON with different key order", () => {
    const left = makeEvent({
      id: "stripe:evt_same",
      kind: "PROVIDER_REFUND_OBSERVED",
      source: { category: "PROVIDER", provider: "stripe", runtimeMode: "TEST" },
      payload: { nested: { second: 2, first: 1 }, alpha: "one" },
    });
    const right = makeEvent({
      id: "stripe:evt_same",
      kind: "PROVIDER_REFUND_OBSERVED",
      source: { provider: "stripe", runtimeMode: "TEST", category: "PROVIDER" },
      payload: { alpha: "one", nested: { first: 1, second: 2 } },
    });

    expect(
      createConnectedEventEnvelope(left, {
        publishedAt: PUBLISHED_AT,
        publisherService: "resolvia-web",
      }).payloadDigest,
    ).toBe(
      createConnectedEventEnvelope(right, {
        publishedAt: PUBLISHED_AT,
        publisherService: "resolvia-web",
      }).payloadDigest,
    );
  });

  it("fails closed when serialized event bytes do not match the envelope digest", () => {
    const envelope = createConnectedEventEnvelope(
      makeEvent({
        id: "stripe:evt_integrity",
        kind: "PROVIDER_REFUND_OBSERVED",
        source: { category: "PROVIDER", provider: "stripe", runtimeMode: "TEST" },
      }),
      { publishedAt: PUBLISHED_AT, publisherService: "resolvia-web" },
    );
    const tampered = JSON.parse(serializeConnectedEventEnvelope(envelope)) as {
      event: { payload: Record<string, unknown> };
    };
    tampered.event.payload.changed = true;

    expect(() => parseConnectedEventEnvelope(JSON.stringify(tampered))).toThrow(
      ConnectedEventEnvelopeError,
    );
  });

  it("rejects a non-connected delivery envelope before it can reach a store", () => {
    const envelope = createConnectedEventEnvelope(
      makeEvent({
        source: { category: "PROVIDER", provider: "stripe", runtimeMode: "TEST" },
      }),
      { publishedAt: PUBLISHED_AT, publisherService: "resolvia-web" },
    );
    const invalid = { ...envelope, deliveryRuntime: "LOCAL" };

    expect(() => parseConnectedEventEnvelope(JSON.stringify(invalid))).toThrow(
      expect.objectContaining({ code: "DELIVERY_RUNTIME_REJECTED" }),
    );
  });

  it("preserves Demo Provider source identity without promoting it to Stripe", () => {
    const envelope = createConnectedEventEnvelope(
      makeEvent({
        id: "demo:evt_1",
        source: {
          category: "PROVIDER",
          provider: "resolvia_demo_provider",
          runtimeMode: "TEST",
        },
      }),
      { publishedAt: PUBLISHED_AT, publisherService: "resolvia-web" },
    );

    expect(parseConnectedEventEnvelope(serializeConnectedEventEnvelope(envelope)).event.source).toEqual({
      category: "PROVIDER",
      provider: "resolvia_demo_provider",
      runtimeMode: "TEST",
    });
  });
});
