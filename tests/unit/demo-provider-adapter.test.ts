import { describe, expect, it } from "vitest";

import {
  DemoProviderAdapter,
  DemoProviderError,
  signDemoProviderRequest,
  type DemoProviderRequest,
} from "@/src/infrastructure/providers/demo/demo-provider-adapter";

const secret = Buffer.alloc(32, 7);
const now = "2026-08-12T12:00:00.000Z";
const payload: DemoProviderRequest = {
  schemaVersion: "resolvia-demo-provider-v1",
  provider: "resolvia_demo_provider",
  timestamp: now,
  nonce: "nonce_123456789012",
  eventId: "event_123",
  caseId: "case-rv-1028",
  eventType: "refund.observed",
  providerObjectId: "demo_refund_123",
  providerObjectCreatedAt: now,
  status: "pending",
};

function rawBody(value = payload): string {
  return JSON.stringify(value);
}

function input(value = payload) {
  const body = rawBody(value);
  return {
    rawBody: body,
    signature: signDemoProviderRequest(body, value.timestamp, secret),
    timestamp: value.timestamp,
  };
}

describe("DemoProviderAdapter", () => {
  it("authenticates the exact canonical request bytes before normalizing TEST input", async () => {
    const adapter = new DemoProviderAdapter({ secret, now: () => now });
    const authenticated = await adapter.authenticate(input());
    const events = await adapter.normalize(authenticated);

    expect(events[0]).toMatchObject({
      source: { provider: "resolvia_demo_provider", runtimeMode: "TEST" },
      id: "resolvia_demo_provider:event_123",
    });
  });

  it("rejects an altered byte even when the parsed JSON value is unchanged", async () => {
    const adapter = new DemoProviderAdapter({ secret, now: () => now });
    const signed = input();

    await expect(
      adapter.authenticate({ ...signed, rawBody: signed.rawBody.replace(",\"provider\"", ", \"provider\"") }),
    ).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
  });

  it("fails closed for malformed signatures, timestamps, and nonce replay", async () => {
    const adapter = new DemoProviderAdapter({ secret, now: () => now });

    await expect(adapter.authenticate({ ...input(), signature: "invalid" })).rejects.toBeInstanceOf(DemoProviderError);
    await expect(new DemoProviderAdapter({ secret, now: () => "2026-08-12T12:06:00.000Z" }).authenticate(input())).rejects.toMatchObject({ code: "INVALID_TIMESTAMP" });
    await expect(new DemoProviderAdapter({ secret, now: () => "2026-08-12T11:58:59.999Z" }).authenticate(input())).rejects.toMatchObject({ code: "INVALID_TIMESTAMP" });
    await adapter.authenticate(input());
    await expect(adapter.authenticate(input())).rejects.toMatchObject({ code: "REPLAYED_NONCE" });
  });
});