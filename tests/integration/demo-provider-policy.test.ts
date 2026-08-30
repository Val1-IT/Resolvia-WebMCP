import { describe, expect, it } from "vitest";

import { processProviderEvent } from "@/src/application/events/process-provider-event";
import {
  DemoProviderAdapter,
  signDemoProviderRequest,
  type DemoProviderRequest,
} from "@/src/infrastructure/providers/demo/demo-provider-adapter";
import { InMemoryResolutionStore } from "@/src/infrastructure/memory/in-memory-resolution-store";
import { initialRefundBundle } from "@/tests/fixtures/domain";

const secret = Buffer.alloc(32, 7);
const now = "2026-08-12T12:00:00.000Z";
const request: DemoProviderRequest = {
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

async function signedEvent() {
  const adapter = new DemoProviderAdapter({ secret, now: () => now });
  const rawBody = JSON.stringify(request);
  const [event] = await adapter.normalize(
    await adapter.authenticate({
      rawBody,
      signature: signDemoProviderRequest(rawBody, request.timestamp, secret),
      timestamp: request.timestamp,
    }),
  );
  return event!;
}

function storeForSeed() {
  const bundle = initialRefundBundle();
  return new InMemoryResolutionStore({
    cases: [bundle.caseRecord],
    events: bundle.events,
    evidence: bundle.evidence,
    claims: bundle.claims,
    auditRecords: bundle.auditRecords,
    providerTransactions: [],
    agentRuns: [],
  });
}

describe("Demo Provider policy", () => {
  it("creates only Demo Provider evidence and leaves customer receipt unknown", async () => {
    const store = storeForSeed();

    await expect(processProviderEvent(store, await signedEvent(), () => now)).resolves.toEqual({
      kind: "COMMITTED",
      caseVersion: 5,
    });
    const result = await store.loadCaseBundle("case-rv-1028");
    expect(result?.evidence.at(-1)).toMatchObject({
      verificationLevel: "DEMO_PROVIDER_VERIFIED",
      sourceProvider: "resolvia_demo_provider",
    });
    expect(JSON.stringify(result)).not.toMatch(/customer received/iu);
  });

  it("makes one semantic mutation for 100 deliveries of the same normalized event", async () => {
    const store = storeForSeed();
    const event = await signedEvent();

    const results = [];
    for (let index = 0; index < 100; index += 1) {
      results.push(await processProviderEvent(store, event, () => now));
    }

    expect(results.filter((result) => result.kind === "COMMITTED")).toHaveLength(1);
    expect(results.filter((result) => result.kind === "DUPLICATE_EVENT")).toHaveLength(99);
    const result = await store.loadCaseBundle("case-rv-1028");
    expect(result?.caseRecord.version).toBe(5);
    expect(result?.events.filter((item) => item.id === event.id)).toHaveLength(1);
    expect(result?.evidence.filter((item) => item.id === `evidence:${event.id}`)).toHaveLength(1);
    expect(result?.providerTransactions.filter((item) => item.provider === "resolvia_demo_provider")).toHaveLength(1);
    expect(result?.auditRecords.filter((item) => item.triggeringEventId === event.id)).toHaveLength(1);
  });

  it("fails closed when a duplicate event ID has conflicting provider data", async () => {
    const store = storeForSeed();
    const event = await signedEvent();
    await processProviderEvent(store, event, () => now);
    const conflicting = {
      ...event,
      payload: { ...event.payload, providerStatus: "succeeded" },
    };

    await expect(processProviderEvent(store, conflicting, () => now)).resolves.toEqual({
      kind: "CASE_INTEGRITY_ERROR",
    });
    expect((await store.loadCaseBundle("case-rv-1028"))?.caseRecord.version).toBe(5);
  });
});