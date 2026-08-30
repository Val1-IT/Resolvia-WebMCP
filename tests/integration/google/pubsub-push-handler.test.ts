import { describe, expect, it, vi } from "vitest";

import { processProviderEvent } from "@/src/application/events/process-provider-event";
import type { ResolutionEvent } from "@/src/domain/events/model";
import { InMemoryResolutionStore } from "@/src/infrastructure/memory/in-memory-resolution-store";
import {
  createConnectedEventEnvelope,
  serializeConnectedEventEnvelope,
} from "@/src/infrastructure/google/pubsub-envelope";
import {
  createPubSubPushHandler,
  type PubSubPushDelivery,
} from "@/src/infrastructure/google/pubsub-push-handler";
import { StripeProviderAdapter } from "@/src/infrastructure/providers/stripe/stripe-provider-adapter";
import { initialRefundBundle } from "@/tests/fixtures/domain";
import {
  STRIPE_TEST_API_KEY,
  STRIPE_TEST_WEBHOOK_SECRET,
  serializeStripeFixture,
  signStripeFixture,
} from "@/tests/fixtures/stripe";

const AUTHENTICATED_AT = "2026-08-12T12:00:00.000Z";
const COMMITTED_AT = "2026-08-12T12:01:00.000Z";
const PUBLISHED_AT = "2026-08-12T12:02:00.000Z";

async function stripeEvent(): Promise<ResolutionEvent> {
  const rawBody = serializeStripeFixture();
  const adapter = new StripeProviderAdapter({
    apiKey: STRIPE_TEST_API_KEY,
    webhookSecret: STRIPE_TEST_WEBHOOK_SECRET,
    now: () => AUTHENTICATED_AT,
  });
  const events = await adapter.normalize(
    await adapter.authenticate({ rawBody, signature: signStripeFixture(rawBody) }),
  );
  if (!events[0]) throw new Error("Expected normalized Stripe event");
  return events[0];
}

function delivery(event: ResolutionEvent): PubSubPushDelivery {
  return {
    authenticated: true,
    projectId: "resolvia-project",
    subscriptionName: "resolution-engine-v1",
    audience: "https://resolution-engine.example.test",
    message: {
      messageId: "pubsub-delivery-diagnostic-only",
      data: Buffer.from(
        serializeConnectedEventEnvelope(
          createConnectedEventEnvelope(event, {
            publishedAt: PUBLISHED_AT,
            publisherService: "resolvia-web",
          }),
        ),
        "utf8",
      ).toString("base64"),
    },
  };
}

function handlerFor(
  processEvent: (event: ResolutionEvent) => ReturnType<typeof processProviderEvent>,
) {
  return createPubSubPushHandler({
    expectedProjectId: "resolvia-project",
    expectedSubscriptionName: "resolution-engine-v1",
    expectedAudience: "https://resolution-engine.example.test",
    processEvent,
  });
}

describe("Pub/Sub connected push handler", () => {
  it("accepts CONNECTED delivery with a Stripe TEST event and commits once", async () => {
    const store = new InMemoryResolutionStore({
      cases: [initialRefundBundle().caseRecord],
      events: initialRefundBundle().events,
      evidence: initialRefundBundle().evidence,
      claims: initialRefundBundle().claims,
      auditRecords: initialRefundBundle().auditRecords,
      providerTransactions: [],
      agentRuns: [],
    });
    const event = await stripeEvent();
    const handler = handlerFor((input) =>
      processProviderEvent(store, input, () => COMMITTED_AT),
    );

    await expect(handler(delivery(event))).resolves.toEqual({ kind: "ACK_COMMITTED" });

    const bundle = await store.loadCaseBundle(event.caseId);
    expect(bundle?.caseRecord.version).toBe(5);
    expect(bundle?.events.filter((record) => record.id === event.id)).toHaveLength(1);
    expect(bundle?.evidence.at(-1)).toMatchObject({
      verificationLevel: "PROVIDER_VERIFIED",
      sourceProvider: "stripe",
    });
  });

  it.each([1, 10, 100])("delivers the same connected event %s times with one semantic effect", async (count) => {
    const initial = initialRefundBundle();
    const store = new InMemoryResolutionStore({
      cases: [initial.caseRecord],
      events: initial.events,
      evidence: initial.evidence,
      claims: initial.claims,
      auditRecords: initial.auditRecords,
      providerTransactions: [],
      agentRuns: [],
    });
    const event = await stripeEvent();
    const handler = handlerFor((input) =>
      processProviderEvent(store, input, () => COMMITTED_AT),
    );

    const outcomes = [];
    for (let index = 0; index < count; index += 1) outcomes.push(await handler(delivery(event)));

    expect(outcomes[0]).toEqual({ kind: "ACK_COMMITTED" });
    expect(outcomes.slice(1)).toEqual(
      Array.from({ length: count - 1 }, () => ({ kind: "ACK_DUPLICATE" })),
    );
    const bundle = await store.loadCaseBundle(event.caseId);
    expect(bundle?.caseRecord.version).toBe(5);
    expect(bundle?.evidence).toHaveLength(2);
    expect(bundle?.providerTransactions).toHaveLength(1);
    expect(bundle?.auditRecords).toHaveLength(3);
  });

  it("rejects non-CONNECTED transport before invoking semantic processing", async () => {
    const processEvent = vi.fn<(event: ResolutionEvent) => ReturnType<typeof processProviderEvent>>();
    const event = await stripeEvent();
    const input = delivery(event);
    const body = JSON.parse(Buffer.from(input.message.data, "base64").toString("utf8")) as {
      deliveryRuntime: string;
    };
    body.deliveryRuntime = "LOCAL";
    input.message.data = Buffer.from(JSON.stringify(body), "utf8").toString("base64");

    await expect(handlerFor(processEvent)(input)).resolves.toEqual({
      kind: "ACK_PERMANENT_REJECTION",
      reason: "DELIVERY_RUNTIME_REJECTED",
    });
    expect(processEvent).not.toHaveBeenCalled();
  });

  it("rejects an invalid Stripe source runtime after transport validation without a semantic mutation", async () => {
    const store = new InMemoryResolutionStore({
      cases: [initialRefundBundle().caseRecord],
      events: initialRefundBundle().events,
      evidence: initialRefundBundle().evidence,
      claims: initialRefundBundle().claims,
      auditRecords: initialRefundBundle().auditRecords,
      providerTransactions: [],
      agentRuns: [],
    });
    const event = { ...(await stripeEvent()), source: { category: "PROVIDER" as const, provider: "stripe", runtimeMode: "LOCAL" as const } };
    const handler = handlerFor((input) => processProviderEvent(store, input, () => COMMITTED_AT));

    await expect(handler(delivery(event))).resolves.toEqual({
      kind: "ACK_PERMANENT_REJECTION",
      reason: "CASE_INTEGRITY_ERROR",
    });
    expect((await store.loadCaseBundle(event.caseId))?.caseRecord.version).toBe(4);
  });

  it("preserves Demo Provider TEST source metadata for its future deterministic policy", async () => {
    const processEvent = vi.fn<(event: ResolutionEvent) => ReturnType<typeof processProviderEvent>>(
      async () => ({ kind: "COMMITTED", caseVersion: 5 }),
    );
    const event = {
      ...(await stripeEvent()),
      id: "demo:evt_1",
      source: {
        category: "PROVIDER" as const,
        provider: "resolvia_demo_provider",
        runtimeMode: "TEST" as const,
      },
    };

    await expect(handlerFor(processEvent)(delivery(event))).resolves.toEqual({
      kind: "ACK_COMMITTED",
    });
    expect(processEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: event.source,
      }),
    );
  });
});

describe("Pub/Sub transport rejection and receipt classification", () => {
  it("fails closed for a same-id conflicting event without a second semantic effect", async () => {
    const initial = initialRefundBundle();
    const store = new InMemoryResolutionStore({
      cases: [initial.caseRecord],
      events: initial.events,
      evidence: initial.evidence,
      claims: initial.claims,
      auditRecords: initial.auditRecords,
      providerTransactions: [],
      agentRuns: [],
    });
    const event = await stripeEvent();
    const handler = handlerFor((input) => processProviderEvent(store, input, () => COMMITTED_AT));

    await expect(handler(delivery(event))).resolves.toEqual({ kind: "ACK_COMMITTED" });
    await expect(
      handler(delivery({ ...event, payload: { ...event.payload, providerStatus: "succeeded" } })),
    ).resolves.toEqual({
      kind: "ACK_PERMANENT_REJECTION",
      reason: "CASE_INTEGRITY_ERROR",
    });
    const bundle = await store.loadCaseBundle(event.caseId);
    expect(bundle?.caseRecord.version).toBe(5);
    expect(bundle?.events.filter((record) => record.id === event.id)).toHaveLength(1);
    expect(bundle?.evidence).toHaveLength(2);
    expect(bundle?.providerTransactions).toHaveLength(1);
  });

  it("rejects malformed wrapper and wrong connected identity before semantic processing", async () => {
    const processEvent = vi.fn<(event: ResolutionEvent) => ReturnType<typeof processProviderEvent>>();
    const input = delivery(await stripeEvent());
    input.message.data = "not-valid-base64";
    const handler = handlerFor(processEvent);

    await expect(handler(input)).resolves.toEqual({
      kind: "ACK_PERMANENT_REJECTION",
      reason: "MALFORMED_ENVELOPE",
    });
    await expect(
      handler({ ...delivery(await stripeEvent()), projectId: "wrong-project" }),
    ).resolves.toEqual({
      kind: "ACK_PERMANENT_REJECTION",
      reason: "PUSH_IDENTITY_REJECTED",
    });
    expect(processEvent).not.toHaveBeenCalled();
  });

  it("retries unresolved version contention instead of acknowledging it", async () => {
    const processEvent = vi.fn<(event: ResolutionEvent) => ReturnType<typeof processProviderEvent>>(
      async () => ({ kind: "VERSION_CONFLICT" }),
    );

    await expect(handlerFor(processEvent)(delivery(await stripeEvent()))).resolves.toEqual({
      kind: "RETRY",
    });
  });
});
