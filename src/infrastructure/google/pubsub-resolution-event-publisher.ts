import { createHash } from "node:crypto";

import { PubSub } from "@google-cloud/pubsub";

import type { ResolutionEventPublisher } from "@/src/application/ports/external-services";
import type { ResolutionEvent } from "@/src/domain/events/model";
import {
  createConnectedEventEnvelope,
  serializeConnectedEventEnvelope,
} from "@/src/infrastructure/google/pubsub-envelope";

export type PubSubPublishInput = {
  data: Buffer;
  orderingKey: string;
  attributes: Record<string, string>;
};

export type PubSubTopic = {
  publishMessage(input: PubSubPublishInput): Promise<string>;
};

export function createPubSubResolutionEventPublisher(input: {
  topic: PubSubTopic;
  publisherService: string;
  now?: () => string;
}): ResolutionEventPublisher {
  const now = input.now ?? (() => new Date().toISOString());
  return {
    async publish(event) {
      const envelope = createConnectedEventEnvelope(event, {
        publishedAt: now(),
        publisherService: input.publisherService,
      });
      await input.topic.publishMessage({
        data: Buffer.from(serializeConnectedEventEnvelope(envelope), "utf8"),
        orderingKey: event.caseId,
        attributes: {
          schemaVersion: envelope.schemaVersion,
          eventDigest: envelope.payloadDigest,
          eventIdSuffix: event.id.slice(-24),
          caseDigest: digestIdentifier(event.caseId),
          correlationId: event.correlationId,
        },
      });
    },
  };
}

export function createGooglePubSubResolutionEventPublisher(input: {
  projectId: string;
  topicName: string;
  publisherService: string;
  now?: () => string;
}): ResolutionEventPublisher {
  const pubsub = new PubSub({ projectId: input.projectId });
  return createPubSubResolutionEventPublisher({
    topic: pubsub.topic(input.topicName, { messageOrdering: true }),
    publisherService: input.publisherService,
    ...(input.now ? { now: input.now } : {}),
  });
}

function digestIdentifier(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("base64url")}`;
}

export type { ResolutionEvent };