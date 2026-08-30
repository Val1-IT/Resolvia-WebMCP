import { describe, expect, it, vi } from "vitest";

import type { ResolutionEventPublisher } from "@/src/application/ports/external-services";
import { createDemoProviderWebhookHandler } from "@/app/api/providers/demo/webhook/route";
import {
  DemoProviderAdapter,
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
const allowRateLimit = vi.fn().mockResolvedValue({ allowed: true, remaining: 59 });

function requestFor(rawBody: string, signature?: string): Request {
  return new Request("http://localhost/api/providers/demo/webhook", {
    method: "POST",
    body: rawBody,
    headers: {
      "content-type": "application/json",
      ...(signature ? { "x-resolvia-demo-signature": signature } : {}),
      "x-resolvia-demo-timestamp": now,
    },
  });
}

describe("Demo Provider webhook route", () => {
  it("rejects an oversized body before authentication or publication", async () => {
    const publish = vi.fn<ResolutionEventPublisher["publish"]>();
    const handler = createDemoProviderWebhookHandler({ adapter: new DemoProviderAdapter({ secret, now: () => now }), publisher: { publish }, rateLimit: allowRateLimit });
    const response = await handler(requestFor("x".repeat(256 * 1024 + 1), "00".repeat(32)));
    expect(response.status).toBe(413);
    expect(publish).not.toHaveBeenCalled();
  });

  it("publishes one authenticated normalized event without a store dependency", async () => {
    const publish = vi.fn<ResolutionEventPublisher["publish"]>();
    const handler = createDemoProviderWebhookHandler({ adapter: new DemoProviderAdapter({ secret, now: () => now }), publisher: { publish }, rateLimit: allowRateLimit });
    const rawBody = JSON.stringify(payload);
    const response = await handler(requestFor(rawBody, signDemoProviderRequest(rawBody, now, secret)));
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ status: "ACCEPTED", published: 1 });
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ source: expect.objectContaining({ provider: "resolvia_demo_provider", runtimeMode: "TEST" }) }));
  });

  it("rejects an unsigned or altered request before publishing", async () => {
    const publish = vi.fn<ResolutionEventPublisher["publish"]>();
    const handler = createDemoProviderWebhookHandler({ adapter: new DemoProviderAdapter({ secret, now: () => now }), publisher: { publish }, rateLimit: allowRateLimit });
    const rawBody = JSON.stringify(payload);
    expect((await handler(requestFor(rawBody))).status).toBe(400);
    expect((await handler(requestFor(`${rawBody} `, signDemoProviderRequest(rawBody, now, secret)))).status).toBe(400);
    expect(publish).not.toHaveBeenCalled();
  });

  it("uses a shared durable replay claim across route instances", async () => {
    const publish = vi.fn<ResolutionEventPublisher["publish"]>();
    let state: "EMPTY" | "LEASED" | "PUBLISHED" = "EMPTY";
    const replayGuard = {
      claim: vi.fn(async () => {
        if (state === "PUBLISHED") return { kind: "DUPLICATE" as const };
        if (state === "LEASED") return { kind: "IN_PROGRESS" as const };
        state = "LEASED";
        return { kind: "CLAIMED" as const, leaseId: "lease-1" };
      }),
      markPublished: vi.fn(async () => {
        state = "PUBLISHED";
      }),
      release: vi.fn(async () => {
        state = "EMPTY";
      }),
    };
    const rawBody = JSON.stringify(payload);
    const first = createDemoProviderWebhookHandler({
      adapter: new DemoProviderAdapter({ secret, now: () => now }),
      publisher: { publish },
      rateLimit: allowRateLimit,
      replayGuard,
    });
    const second = createDemoProviderWebhookHandler({
      adapter: new DemoProviderAdapter({ secret, now: () => now }),
      publisher: { publish },
      rateLimit: allowRateLimit,
      replayGuard,
    });

    const accepted = await first(
      requestFor(rawBody, signDemoProviderRequest(rawBody, now, secret)),
    );
    const duplicate = await second(
      requestFor(rawBody, signDemoProviderRequest(rawBody, now, secret)),
    );

    expect(accepted.status).toBe(202);
    expect(duplicate.status).toBe(202);
    await expect(duplicate.json()).resolves.toEqual({
      status: "DUPLICATE",
      published: 0,
    });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(replayGuard.markPublished).toHaveBeenCalledTimes(1);
  });
  it("returns 429 after authentication but before normalization or publication when provider traffic is limited", async () => {
    const publish = vi.fn<ResolutionEventPublisher["publish"]>();
    const rawBody = JSON.stringify(payload);
    const handler = createDemoProviderWebhookHandler({
      adapter: new DemoProviderAdapter({ secret, now: () => now }),
      publisher: { publish },
      rateLimit: vi.fn().mockResolvedValue({ allowed: false, retryAfterSeconds: 60 }),
    });
    const response = await handler(requestFor(rawBody, signDemoProviderRequest(rawBody, now, secret)));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(publish).not.toHaveBeenCalled();
  });
});