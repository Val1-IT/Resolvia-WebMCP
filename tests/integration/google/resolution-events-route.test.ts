import { describe, expect, it, vi } from "vitest";

import { createResolutionEventsRoute } from "@/app/api/internal/pubsub/resolution-events/route";
import { InMemoryResolutionStore } from "@/src/infrastructure/memory/in-memory-resolution-store";
import { createConnectedEventEnvelope, serializeConnectedEventEnvelope } from "@/src/infrastructure/google/pubsub-envelope";
import { initialRefundBundle, makeEvent } from "@/tests/fixtures/domain";

const runtime = {
  mode: "CONNECTED" as const,
  projectId: "resolvia-project",
  region: "asia-southeast2",
  topicName: "resolution-events-v1",
  subscriptionName: "resolution-engine-v1",
  webUrl: "https://resolvia.example.test",
  engineAudience: "https://resolution-engine.example.test",
  firestoreDatabase: "(default)",
  pubsubPushServiceAccount: "resolvia-pubsub-push@resolvia-project.iam.gserviceaccount.com",
};

function event() {
  return makeEvent({
    id: "stripe:evt_6_4", kind: "PROVIDER_REFUND_STATUS_UPDATED",
    source: { category: "PROVIDER", provider: "stripe", runtimeMode: "TEST" }, correlationId: "evt_6_4",
    payload: { providerEventId: "evt_6_4", providerEventType: "refund.updated", providerObjectId: "re_6_4", providerObjectType: "refund", providerObjectCreatedAt: "2026-08-12T12:00:00.000Z", providerStatus: "pending" },
  });
}

function request(input = event()) {
  const body = JSON.stringify({ subscription: "projects/resolvia-project/subscriptions/resolution-engine-v1", message: { messageId: "diagnostic", data: Buffer.from(serializeConnectedEventEnvelope(createConnectedEventEnvelope(input, { publishedAt: "2026-08-12T12:00:00.000Z", publisherService: "resolvia-web" })), "utf8").toString("base64") } });
  return new Request("https://engine.example.test/api/internal/pubsub/resolution-events", { method: "POST", body, headers: { authorization: "Bearer valid", "content-type": "application/json" } });
}

function store() {
  const bundle = initialRefundBundle();
  return new InMemoryResolutionStore({ cases: [bundle.caseRecord], events: bundle.events, evidence: bundle.evidence, claims: bundle.claims, auditRecords: bundle.auditRecords, providerTransactions: [], agentRuns: [] });
}

const verifiedProvider = async () => runtime.pubsubPushServiceAccount;

describe("private resolution-engine push route", () => {
  it("commits an authenticated Stripe TEST delivery without changing source provenance", async () => {
    const resolutionStore = store();
    const post = createResolutionEventsRoute({ getRuntime: () => runtime, getStore: () => resolutionStore, verifyIdentity: verifiedProvider, now: () => "2026-08-12T12:01:00.000Z" });
    await expect(post(request())).resolves.toMatchObject({ status: 204 });
    const bundle = await resolutionStore.loadCaseBundle("case-rv-1028");
    expect(bundle?.caseRecord.version).toBe(5);
    expect(bundle?.events.at(-1)?.source).toEqual({ category: "PROVIDER", provider: "stripe", runtimeMode: "TEST" });
  });

  it("processes a real Pub/Sub retry wrapper with deliveryAttempt metadata", async () => {
    const resolutionStore = store();
    const post = createResolutionEventsRoute({ getRuntime: () => runtime, getStore: () => resolutionStore, verifyIdentity: verifiedProvider, now: () => "2026-08-12T12:01:00.000Z" });
    const delivery = await request().json() as { message: Record<string, unknown>; deliveryAttempt?: number };
    delivery.deliveryAttempt = 1;
    Object.assign(delivery.message, {
      message_id: "diagnostic",
      publishTime: "2026-08-12T12:00:00.000Z",
      publish_time: "2026-08-12T12:00:00.000Z",
      orderingKey: "case-rv-1028",
      attributes: { schemaVersion: "resolution-event-envelope-v1", eventDigest: "sha256:diagnostic" },
    });

    await expect(post(new Request("https://engine.example.test/api/internal/pubsub/resolution-events", {
      method: "POST",
      body: JSON.stringify(delivery),
      headers: { authorization: "Bearer valid", "content-type": "application/json" },
    }))).resolves.toMatchObject({ status: 204 });
    expect((await resolutionStore.loadCaseBundle("case-rv-1028"))?.caseRecord.version).toBe(5);
  });

  it("rejects missing identity before creating a store", async () => {
    const getStore = vi.fn(() => store());
    const post = createResolutionEventsRoute({ getRuntime: () => runtime, getStore, verifyIdentity: async () => null });
    await expect(post(request())).resolves.toMatchObject({ status: 401 });
    expect(getStore).not.toHaveBeenCalled();
  });

  it("acknowledges an unexpected subscription and oversized body without mutation", async () => {
    const resolutionStore = store();
    const post = createResolutionEventsRoute({ getRuntime: () => runtime, getStore: () => resolutionStore, verifyIdentity: verifiedProvider });
    const parsed = await request().json() as { subscription: string };
    parsed.subscription = "projects/wrong/subscriptions/wrong";
    await expect(post(new Request("https://engine.example.test", { method: "POST", body: JSON.stringify(parsed), headers: { authorization: "Bearer valid" } }))).resolves.toMatchObject({ status: 204 });
    await expect(post(new Request("https://engine.example.test", { method: "POST", body: "x".repeat(512 * 1024), headers: { authorization: "Bearer valid" } }))).resolves.toMatchObject({ status: 204 });
    expect((await resolutionStore.loadCaseBundle("case-rv-1028"))?.caseRecord.version).toBe(4);
  });

  it("returns retryable failure only when infrastructure processing fails", async () => {
    const post = createResolutionEventsRoute({ getRuntime: () => runtime, getStore: () => { throw new Error("unavailable"); }, verifyIdentity: verifiedProvider });
    await expect(post(request())).resolves.toMatchObject({ status: 503 });
  });

  it("acknowledges a permanent semantic rejection without requesting a Pub/Sub retry", async () => {
    const resolutionStore = store();
    const post = createResolutionEventsRoute({ getRuntime: () => runtime, getStore: () => resolutionStore, verifyIdentity: verifiedProvider });
    const invalidSourceRuntime = {
      ...event(),
      source: { category: "PROVIDER" as const, provider: "stripe" as const, runtimeMode: "LOCAL" as const },
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      await expect(post(request(invalidSourceRuntime))).resolves.toMatchObject({ status: 204 });
      expect(warn).toHaveBeenCalledWith(JSON.stringify({
        severity: "WARNING",
        component: "resolution-events-route",
        requestId: "diagnostic",
        outcome: "ACK_PERMANENT_REJECTION",
        errorClass: "CASE_INTEGRITY_ERROR",
      }));
    } finally {
      warn.mockRestore();
    }
    expect((await resolutionStore.loadCaseBundle("case-rv-1028"))?.caseRecord.version).toBe(4);
  });

  it("selects channel from verified provider principal and rejects category conflict", async () => {
    const m1Runtime = {
      ...runtime,
      providerPushServiceAccount: "resolvia-provider-push@resolvia-project.iam.gserviceaccount.com",
      partnerPushServiceAccount: "resolvia-partner-push@resolvia-project.iam.gserviceaccount.com",
    };
    const resolutionStore = store();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const post = createResolutionEventsRoute({
      getRuntime: () => m1Runtime,
      getStore: () => resolutionStore,
      verifyIdentity: async () => m1Runtime.providerPushServiceAccount,
      now: () => "2026-08-12T12:01:00.000Z",
    });

    await expect(post(request())).resolves.toMatchObject({ status: 204 });
    expect((await resolutionStore.loadCaseBundle("case-rv-1028"))?.caseRecord.version).toBe(5);

    const conflicting = {
      ...event(),
      id: "stripe:evt_conflict",
      correlationId: "evt_conflict",
      source: { category: "PARTNER" as const, provider: "resolvia_demo_partner" as const, runtimeMode: "CONNECTED" as const },
      payload: { partnerRequestId: "req", requestedEvidenceType: "SETTLEMENT_OCCURRED", responseStatus: "CONFIRMED", responseReference: "ref", responseSummary: "ok" },
    };
    try {
      await expect(post(request(conflicting))).resolves.toMatchObject({ status: 204 });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("CASE_INTEGRITY_ERROR"));
    } finally {
      warn.mockRestore();
    }
  });
});