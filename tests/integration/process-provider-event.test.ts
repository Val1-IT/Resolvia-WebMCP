import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createStripeWebhookHandler } from "@/app/api/providers/stripe/webhook/route";
import {
  createProviderEventPublisher,
  processProviderEvent,
} from "@/src/application/events/process-provider-event";
import { evaluateClaimStatus } from "@/src/domain/claims/model";
import type { ResolutionEvent } from "@/src/domain/events/model";
import type {
  ResolutionCaseBundle,
  ResolutionSnapshot,
} from "@/src/domain/store/model";
import { JsonResolutionStore } from "@/src/infrastructure/local/json-resolution-store";
import { InMemoryResolutionStore } from "@/src/infrastructure/memory/in-memory-resolution-store";
import { StripeProviderAdapter } from "@/src/infrastructure/providers/stripe/stripe-provider-adapter";
import { buildCaseWorkspaceViewModel } from "@/src/ui/case-workspace/model";
import { makeAgentRun } from "@/tests/fixtures/agent";
import { initialRefundBundle } from "@/tests/fixtures/domain";
import {
  STRIPE_TEST_API_KEY,
  STRIPE_TEST_WEBHOOK_SECRET,
  serializeStripeFixture,
  signStripeFixture,
} from "@/tests/fixtures/stripe";

const AUTHENTICATED_AT = "2026-08-11T12:00:00.000Z";
const COMMITTED_AT = "2026-08-11T12:01:00.000Z";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function normalizedEvent(
  options: Parameters<typeof serializeStripeFixture>[0] = {},
): Promise<ResolutionEvent> {
  const rawBody = serializeStripeFixture(options);
  const adapter = new StripeProviderAdapter({
    apiKey: STRIPE_TEST_API_KEY,
    webhookSecret: STRIPE_TEST_WEBHOOK_SECRET,
    now: () => AUTHENTICATED_AT,
  });
  const events = await adapter.normalize(
    await adapter.authenticate({
      rawBody,
      signature: signStripeFixture(rawBody),
    }),
  );
  if (!events[0]) throw new Error("Expected one normalized refund event");
  return events[0];
}

function snapshotFromBundle(bundle: ResolutionCaseBundle): ResolutionSnapshot {
  return {
    cases: [bundle.caseRecord],
    events: bundle.events,
    evidence: bundle.evidence,
    claims: bundle.claims,
    auditRecords: bundle.auditRecords,
    providerTransactions: bundle.providerTransactions,
    agentRuns: bundle.agentRuns,
  };
}

function initialSnapshotWithAgentRun(): ResolutionSnapshot {
  const bundle = initialRefundBundle();
  bundle.agentRuns = [makeAgentRun({ basedOnCaseVersion: 4 })];
  return snapshotFromBundle(bundle);
}

describe("processProviderEvent", () => {
  it("commits signed provider truth atomically while preserving merchant uncertainty", async () => {
    const store = new InMemoryResolutionStore(initialSnapshotWithAgentRun());
    const event = await normalizedEvent();
    const priorRun = (await store.loadCaseBundle("case-rv-1028"))?.agentRuns[0];

    await expect(
      processProviderEvent(store, event, () => COMMITTED_AT),
    ).resolves.toEqual({ kind: "COMMITTED", caseVersion: 5 });

    const bundle = await store.loadCaseBundle("case-rv-1028");
    if (!bundle) throw new Error("Expected RV-1028");
    expect(bundle.caseRecord).toMatchObject({
      state: "INVESTIGATING",
      version: 5,
      updatedAt: COMMITTED_AT,
    });
    expect(bundle.events.filter((record) => record.id === event.id)).toHaveLength(1);
    expect(bundle.evidence).toHaveLength(2);
    expect(bundle.evidence[1]).toMatchObject({
      id: "evidence:stripe:evt_test_refund",
      type: "PROVIDER_TRANSACTION",
      sourceProvider: "stripe",
      externalReference: "re_test_refund",
      verificationLevel: "PROVIDER_VERIFIED",
      metadata: {
        providerEventId: "evt_test_refund",
        providerEventType: "refund.updated",
        providerStatus: "pending",
      },
    });
    expect(JSON.stringify(bundle.evidence[1])).not.toMatch(
      /customer|card|rawBody|stripe-signature/iu,
    );
    expect(bundle.providerTransactions).toEqual([
      expect.objectContaining({
        provider: "stripe",
        providerObjectId: "re_test_refund",
        status: "PENDING",
        evidenceId: "evidence:stripe:evt_test_refund",
      }),
    ]);
    expect(bundle.auditRecords.at(-1)).toMatchObject({
      triggeringEventId: event.id,
      previousState: "INVESTIGATING",
      resultingState: "INVESTIGATING",
      evidenceIds: ["evidence:stripe:evt_test_refund"],
    });

    const merchantClaim = bundle.claims.find(
      (claim) => claim.id === "claim-refund-processed",
    );
    expect(merchantClaim && evaluateClaimStatus(merchantClaim)).toBe(
      "UNVERIFIED",
    );
    expect(merchantClaim?.evidenceRelationships).toEqual([
      {
        evidenceId: "evidence-merchant-message",
        kind: "AUTHENTICATES_ASSERTION",
      },
    ]);
    expect(
      bundle.claims
        .filter((claim) => claim.id !== "claim-refund-processed")
        .map(evaluateClaimStatus),
    ).toEqual(["SUPPORTED", "SUPPORTED"]);
    expect(bundle.claims.some((claim) => /customer received/iu.test(claim.statement))).toBe(false);
    expect(bundle.agentRuns).toEqual([priorRun]);

    const workspace = buildCaseWorkspaceViewModel(bundle);
    expect(workspace.agentAnalysis).toMatchObject({
      basedOnCaseVersion: 4,
      freshness: "STALE",
    });
    expect(workspace.journey).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "refund-transaction",
          status: "VERIFIED",
          projectionOnly: false,
        }),
        expect.objectContaining({
          id: "processor-status",
          status: "VERIFIED",
          projectionOnly: false,
        }),
        expect.objectContaining({
          id: "customer-received",
          status: "UNKNOWN",
          projectionOnly: true,
        }),
      ]),
    );
    expect(workspace.truthGraph.nodes).toContainEqual(
      expect.objectContaining({
        kind: "TRANSACTION",
        authoritative: true,
        placeholder: false,
      }),
    );
  });

  it.each([1, 2, 10])(
    "applies %s sequential deliveries exactly once",
    async (deliveryCount) => {
      const store = new InMemoryResolutionStore(initialSnapshotWithAgentRun());
      const event = await normalizedEvent();
      const results = [];
      for (let delivery = 0; delivery < deliveryCount; delivery += 1) {
        results.push(await processProviderEvent(store, event, () => COMMITTED_AT));
      }

      expect(results[0]).toEqual({ kind: "COMMITTED", caseVersion: 5 });
      expect(results.slice(1)).toEqual(
        Array.from({ length: deliveryCount - 1 }, () => ({
          kind: "DUPLICATE_EVENT",
        })),
      );
      const bundle = await store.loadCaseBundle("case-rv-1028");
      expect(bundle?.caseRecord.version).toBe(5);
      expect(bundle?.events.filter((record) => record.id === event.id)).toHaveLength(1);
      expect(bundle?.evidence).toHaveLength(2);
      expect(bundle?.providerTransactions).toHaveLength(1);
      expect(bundle?.claims).toHaveLength(3);
      expect(bundle?.auditRecords).toHaveLength(3);
    },
  );

  it("serializes ten concurrent JSON deliveries to one semantic effect", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "resolvia-stripe-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "resolvia.json");
    await writeFile(filePath, JSON.stringify(initialSnapshotWithAgentRun()), "utf8");
    const before = await readFile(filePath, "utf8");
    const store = new JsonResolutionStore(filePath);
    const event = await normalizedEvent();

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        processProviderEvent(store, event, () => COMMITTED_AT),
      ),
    );

    expect(results.filter((result) => result.kind === "COMMITTED")).toHaveLength(1);
    expect(results.filter((result) => result.kind === "DUPLICATE_EVENT")).toHaveLength(9);
    expect(await readFile(filePath, "utf8")).not.toBe(before);
    const bundle = await store.loadCaseBundle("case-rv-1028");
    expect(bundle?.caseRecord.version).toBe(5);
    expect(bundle?.providerTransactions).toHaveLength(1);
    expect(bundle?.auditRecords).toHaveLength(3);
  });

  it("fails closed for missing/cross-case and malformed provider events", async () => {
    const scenarios: ResolutionEvent[] = [
      await normalizedEvent({ caseId: "case-other" }),
      {
        ...(await normalizedEvent()),
        payload: {
          ...(await normalizedEvent()).payload,
          providerObjectId: "",
        },
      },
      {
        ...(await normalizedEvent()),
        source: { category: "USER", runtimeMode: "LOCAL" },
      },
    ];

    for (const event of scenarios) {
      const initial = initialSnapshotWithAgentRun();
      const store = new InMemoryResolutionStore(initial);
      const result = await processProviderEvent(store, event, () => COMMITTED_AT);
      expect(["CASE_NOT_FOUND", "CASE_INTEGRITY_ERROR"]).toContain(result.kind);
      expect(await store.loadCaseBundle("case-rv-1028")).toEqual(
        expect.objectContaining({
          caseRecord: expect.objectContaining({ version: 4 }),
          evidence: initial.evidence,
          providerTransactions: [],
          agentRuns: initial.agentRuns,
        }),
      );
    }
  });

  it("takes a signed route request through one atomic semantic mutation", async () => {
    const store = new InMemoryResolutionStore(initialSnapshotWithAgentRun());
    const rawBody = serializeStripeFixture();
    const signature = signStripeFixture(rawBody);
    const handler = createStripeWebhookHandler({
      adapter: new StripeProviderAdapter({
        apiKey: STRIPE_TEST_API_KEY,
        webhookSecret: STRIPE_TEST_WEBHOOK_SECRET,
        now: () => AUTHENTICATED_AT,
      }),
      publisher: createProviderEventPublisher(store, () => COMMITTED_AT),
    });
    const request = () =>
      new Request("http://localhost/api/providers/stripe/webhook", {
        method: "POST",
        body: rawBody,
        headers: { "content-type": "application/json", "stripe-signature": signature },
      });

    await expect(handler(request())).resolves.toMatchObject({ status: 202 });
    await expect(handler(request())).resolves.toMatchObject({ status: 202 });

    const bundle = await store.loadCaseBundle("case-rv-1028");
    expect(bundle).toMatchObject({
      caseRecord: { state: "INVESTIGATING", version: 5 },
      evidence: [
        expect.objectContaining({ verificationLevel: "AUTHENTICATED_SOURCE" }),
        expect.objectContaining({ verificationLevel: "PROVIDER_VERIFIED" }),
      ],
      providerTransactions: [
        expect.objectContaining({ providerObjectId: "re_test_refund" }),
      ],
    });
    expect(bundle?.auditRecords).toHaveLength(3);
  });

  it("publishes through the application boundary without exposing store authority to Stripe", async () => {
    const store = new InMemoryResolutionStore(initialSnapshotWithAgentRun());
    const publisher = createProviderEventPublisher(store, () => COMMITTED_AT);
    const event = await normalizedEvent();

    await expect(publisher.publish(event)).resolves.toBeUndefined();
    await expect(publisher.publish(event)).resolves.toBeUndefined();
    expect((await store.loadCaseBundle("case-rv-1028"))?.caseRecord.version).toBe(5);
  });
});

describe("provider event identity collisions", () => {
  it("fails closed when a reused event id carries a conflicting normalized payload", async () => {
    const store = new InMemoryResolutionStore(initialSnapshotWithAgentRun());
    const event = await normalizedEvent();

    await expect(processProviderEvent(store, event, () => COMMITTED_AT)).resolves.toEqual({
      kind: "COMMITTED",
      caseVersion: 5,
    });
    await expect(
      processProviderEvent(
        store,
        { ...event, payload: { ...event.payload, providerStatus: "succeeded" } },
        () => COMMITTED_AT,
      ),
    ).resolves.toEqual({ kind: "CASE_INTEGRITY_ERROR" });

    const bundle = await store.loadCaseBundle(event.caseId);
    expect(bundle?.caseRecord.version).toBe(5);
    expect(bundle?.events.filter((stored) => stored.id === event.id)).toHaveLength(1);
    expect(bundle?.providerTransactions).toHaveLength(1);
    expect(bundle?.auditRecords).toHaveLength(3);
  });
});
