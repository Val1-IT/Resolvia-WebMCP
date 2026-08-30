import type { ProcessProviderEventResult } from "@/src/application/events/process-provider-event";
import type { ResolutionEvent } from "@/src/domain/events/model";

import {
  ConnectedEventEnvelopeError,
  parseConnectedEventEnvelope,
} from "@/src/infrastructure/google/pubsub-envelope";

const MAX_PUBSUB_EVENT_BYTES = 256 * 1024;

export type PubSubPushDelivery = {
  authenticated: boolean;
  projectId: string;
  subscriptionName: string;
  audience: string;
  message: {
    messageId: string;
    data: string;
  };
};

export type PubSubPushOutcome =
  | { kind: "ACK_COMMITTED" }
  | { kind: "ACK_DUPLICATE" }
  | { kind: "ACK_PERMANENT_REJECTION"; reason: string }
  | { kind: "RETRY" };

export function createPubSubPushHandler(input: {
  expectedProjectId: string;
  expectedSubscriptionName: string;
  expectedAudience: string;
  processEvent: (event: ResolutionEvent) => Promise<ProcessProviderEventResult>;
}): (delivery: PubSubPushDelivery) => Promise<PubSubPushOutcome> {
  return async (delivery) => {
    if (!delivery.authenticated) {
      return { kind: "ACK_PERMANENT_REJECTION", reason: "UNAUTHENTICATED" };
    }
    if (
      delivery.projectId !== input.expectedProjectId ||
      delivery.subscriptionName !== input.expectedSubscriptionName ||
      delivery.audience !== input.expectedAudience
    ) {
      return { kind: "ACK_PERMANENT_REJECTION", reason: "PUSH_IDENTITY_REJECTED" };
    }

    let serializedEnvelope: string;
    try {
      const bytes = Buffer.from(delivery.message.data, "base64");
      if (bytes.length === 0 || bytes.length > MAX_PUBSUB_EVENT_BYTES) {
        return { kind: "ACK_PERMANENT_REJECTION", reason: "MALFORMED_ENVELOPE" };
      }
      serializedEnvelope = bytes.toString("utf8");
    } catch {
      return { kind: "ACK_PERMANENT_REJECTION", reason: "MALFORMED_ENVELOPE" };
    }

    try {
      const envelope = parseConnectedEventEnvelope(serializedEnvelope);
      const result = await input.processEvent(envelope.event);
      return outcomeFromProcessing(result);
    } catch (error) {
      if (error instanceof ConnectedEventEnvelopeError) {
        return { kind: "ACK_PERMANENT_REJECTION", reason: error.code };
      }
      return { kind: "RETRY" };
    }
  };
}

function outcomeFromProcessing(result: ProcessProviderEventResult): PubSubPushOutcome {
  if (result.kind === "COMMITTED") return { kind: "ACK_COMMITTED" };
  if (result.kind === "DUPLICATE_EVENT") return { kind: "ACK_DUPLICATE" };
  if (result.kind === "VERSION_CONFLICT") return { kind: "RETRY" };
  return { kind: "ACK_PERMANENT_REJECTION", reason: result.kind };
}
