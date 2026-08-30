import { z } from "zod";

import {
  canonicalResolutionEventJson,
  resolutionEventDigest,
} from "@/src/domain/events/canonical";
import {
  ResolutionEventSchema,
  type ResolutionEvent,
} from "@/src/domain/events/model";

const IsoDateTimeSchema = z.string().datetime({ offset: true });
const PayloadDigestSchema = z.string().regex(/^sha256:[A-Za-z0-9_-]{43}$/u);

export const ConnectedEventEnvelopeV1Schema = z
  .object({
    schemaVersion: z.literal("resolution-event-envelope-v1"),
    deliveryRuntime: z.literal("CONNECTED"),
    event: ResolutionEventSchema,
    publishedAt: IsoDateTimeSchema,
    publisherService: z.string().min(1).max(128),
    payloadDigest: PayloadDigestSchema,
  })
  .strict();

export type ConnectedEventEnvelopeV1 = z.infer<typeof ConnectedEventEnvelopeV1Schema>;

export class ConnectedEventEnvelopeError extends Error {
  constructor(
    public readonly code:
      | "MALFORMED_ENVELOPE"
      | "DELIVERY_RUNTIME_REJECTED"
      | "PAYLOAD_DIGEST_MISMATCH",
  ) {
    super(code);
    this.name = "ConnectedEventEnvelopeError";
  }
}

export { canonicalResolutionEventJson, resolutionEventDigest };

export function createConnectedEventEnvelope(
  event: ResolutionEvent,
  metadata: Pick<ConnectedEventEnvelopeV1, "publishedAt" | "publisherService">,
): ConnectedEventEnvelopeV1 {
  const parsedEvent = ResolutionEventSchema.safeParse(event);
  if (!parsedEvent.success) throw new ConnectedEventEnvelopeError("MALFORMED_ENVELOPE");
  let payloadDigest: string;
  try {
    payloadDigest = resolutionEventDigest(parsedEvent.data);
  } catch {
    throw new ConnectedEventEnvelopeError("MALFORMED_ENVELOPE");
  }
  const envelope = {
    schemaVersion: "resolution-event-envelope-v1" as const,
    deliveryRuntime: "CONNECTED" as const,
    event: parsedEvent.data,
    ...metadata,
    payloadDigest,
  };
  const parsedEnvelope = ConnectedEventEnvelopeV1Schema.safeParse(envelope);
  if (!parsedEnvelope.success) throw new ConnectedEventEnvelopeError("MALFORMED_ENVELOPE");
  return parsedEnvelope.data;
}

export function serializeConnectedEventEnvelope(envelope: ConnectedEventEnvelopeV1): string {
  return JSON.stringify(envelope);
}

export function parseConnectedEventEnvelope(input: string): ConnectedEventEnvelopeV1 {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    throw new ConnectedEventEnvelopeError("MALFORMED_ENVELOPE");
  }
  if (isObject(value) && value.deliveryRuntime !== "CONNECTED") {
    throw new ConnectedEventEnvelopeError("DELIVERY_RUNTIME_REJECTED");
  }
  const parsed = ConnectedEventEnvelopeV1Schema.safeParse(value);
  if (!parsed.success) throw new ConnectedEventEnvelopeError("MALFORMED_ENVELOPE");
  let actualDigest: string;
  try {
    actualDigest = resolutionEventDigest(parsed.data.event);
  } catch {
    throw new ConnectedEventEnvelopeError("MALFORMED_ENVELOPE");
  }
  if (actualDigest !== parsed.data.payloadDigest) {
    throw new ConnectedEventEnvelopeError("PAYLOAD_DIGEST_MISMATCH");
  }
  return parsed.data;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}