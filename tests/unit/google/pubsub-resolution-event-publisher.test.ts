import { describe, expect, it, vi } from "vitest";

import {
  createPubSubResolutionEventPublisher,
  type PubSubPublishInput,
} from "@/src/infrastructure/google/pubsub-resolution-event-publisher";
import { makeEvent } from "@/tests/fixtures/domain";

describe("PubSubResolutionEventPublisher", () => {
  it("publishes a strict connected envelope with case ordering and safe transport attributes", async () => {
    const messages: PubSubPublishInput[] = [];
    const publisher = createPubSubResolutionEventPublisher({
      topic: {
        publishMessage: async (message) => {
          messages.push(message);
          return "pubsub-message-id";
        },
      },
      publisherService: "resolvia-web",
      now: () => "2026-08-12T12:00:00.000Z",
    });
    const event = makeEvent({
      id: "stripe:evt_publisher",
      source: { category: "PROVIDER", provider: "stripe", runtimeMode: "TEST" },
    });

    await expect(publisher.publish(event)).resolves.toBeUndefined();

    expect(messages).toContainEqual(
      expect.objectContaining({
        orderingKey: event.caseId,
        attributes: expect.objectContaining({
          schemaVersion: "resolution-event-envelope-v1",
          correlationId: event.correlationId,
        }),
      }),
    );
    const request = messages[0];
    expect(request?.data.toString("utf8")).toContain('"deliveryRuntime":"CONNECTED"');
    expect(JSON.stringify(request?.attributes)).not.toContain(event.caseId);
  });

  it("does not mutate the normalized event when publishing fails", async () => {
    const event = makeEvent({ payload: { source: "unchanged" } });
    const before = structuredClone(event);
    const publisher = createPubSubResolutionEventPublisher({
      topic: { publishMessage: vi.fn(async () => Promise.reject(new Error("unavailable"))) },
      publisherService: "resolvia-web",
      now: () => "2026-08-12T12:00:00.000Z",
    });

    await expect(publisher.publish(event)).rejects.toThrow("unavailable");
    expect(event).toEqual(before);
  });
});