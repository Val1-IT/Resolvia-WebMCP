import { Firestore } from "@google-cloud/firestore";
import { describe, expect, it } from "vitest";

import { seedDemoCase } from "@/src/application/cases/seed-demo-case";
import { processProviderEvent } from "@/src/application/events/process-provider-event";
import { resetConnectedRv1028 } from "@/src/infrastructure/google/reset-connected-rv1028";
import { FirestoreResolutionStore } from "@/src/infrastructure/google/firestore-resolution-store";
import { firestoreCollection, firestoreDocumentId } from "@/src/infrastructure/google/firestore-codec";
import { createPartnerRequest } from "@/src/domain/partners/policy";
import { makeAgentRun } from "@/tests/fixtures/agent";
import {
  createCaseMutation,
  makeCase,
  makeEvidence,
  makeEvent,
  makeMutation,
} from "@/tests/fixtures/domain";

const describeEmulator = process.env.FIRESTORE_EMULATOR_HOST
  ? describe
  : describe.skip;

function makeStore(label: string): FirestoreResolutionStore {
  const firestore = new Firestore({
    projectId: "resolvia-task-6-2",
    databaseId: "(default)",
  });
  return new FirestoreResolutionStore(
    firestore,
    `test-${label}-${crypto.randomUUID()}`,
  );
}

describeEmulator("FirestoreResolutionStore", () => {
  it("atomically creates and reloads a case", async () => {
    const store = makeStore("create");

    expect(await store.commitCaseMutation(createCaseMutation())).toBe(
      "COMMITTED",
    );
    expect(await store.loadCaseBundle("case-rv-1028")).toMatchObject({
      caseRecord: { id: "case-rv-1028", version: 1 },
      events: [],
      evidence: [],
      claims: [],
      auditRecords: [],
      providerTransactions: [],
      agentRuns: [],
    });
  });

  it("allows exactly one writer to advance the same stored version", async () => {
    const store = makeStore("race");
    await store.commitCaseMutation(createCaseMutation());

    const results = await Promise.all([
      store.commitCaseMutation(makeMutation()),
      store.commitCaseMutation(
        makeMutation({
          caseRecord: makeCase({ version: 2, nextBestAction: "Second writer" }),
        }),
      ),
    ]);

    expect(results.sort()).toEqual(["COMMITTED", "VERSION_CONFLICT"]);
    expect(
      (await store.loadCaseBundle("case-rv-1028"))?.caseRecord.version,
    ).toBe(2);
  });

  it("rejects a cross-case evidence reference without partial writes", async () => {
    const store = makeStore("cross-case");
    await store.commitCaseMutation(createCaseMutation());

    const result = await store.commitCaseMutation(
      makeMutation({
        evidenceToAdd: [
          makeEvidence({
            id: "evidence-other",
            caseId: "case-other",
            relatedClaimIds: [],
          }),
        ],
      }),
    );

    expect(result).toBe("CASE_INTEGRITY_ERROR");
    const bundle = await store.loadCaseBundle("case-rv-1028");
    expect(bundle?.caseRecord.version).toBe(1);
    expect(bundle?.evidence).toEqual([]);
  });

  it("recognizes an already committed event without a second semantic effect", async () => {
    const store = makeStore("duplicate-event");
    await store.commitCaseMutation(createCaseMutation());
    const event = makeEvent({ id: "event-provider-observation" });

    expect(
      await store.commitCaseMutation(makeMutation({ eventsToAppend: [event] })),
    ).toBe("COMMITTED");
    expect(
      await store.commitCaseMutation(
        makeMutation({
          expectedCaseVersion: 2,
          caseRecord: makeCase({ version: 3 }),
          eventsToAppend: [event],
        }),
      ),
    ).toBe("DUPLICATE_EVENT");

    const bundle = await store.loadCaseBundle("case-rv-1028");
    expect(bundle?.caseRecord.version).toBe(2);
    expect(bundle?.events.map((record) => record.id)).toEqual([
      "event-provider-observation",
    ]);
  });

  it("appends an AgentRun without advancing semantic case version", async () => {
    const store = makeStore("agent-run");
    await seedDemoCase(store);

    expect(
      await store.appendAgentRun({
        agentRun: makeAgentRun(),
        expectedCaseVersion: 4,
      }),
    ).toBe("COMMITTED");

    const bundle = await store.loadCaseBundle("case-rv-1028");
    expect(bundle?.caseRecord.version).toBe(4);
    expect(bundle?.agentRuns.map((run) => run.id)).toEqual(["agent-run-1"]);
  });
  it("persists a partner request and digest receipt without advancing the case", async () => {
    const store = makeStore("partner-request");
    await seedDemoCase(store);
    const bundle = await store.loadCaseBundle("case-rv-1028");
    if (!bundle) throw new Error("Expected RV-1028");
    const created = createPartnerRequest({
      caseRecord: bundle.caseRecord,
      requestId: "partner-request-firestore",
      rawToken: "partner-token-abcdefghijklmnopqrstuvwxyz0123456789",
      now: "2026-08-12T13:10:00.000Z",
    });

    expect(
      await store.createPartnerRequest({
        ...created,
        expectedCaseVersion: bundle.caseRecord.version,
      }),
    ).toBe("COMMITTED");
    expect(
      await store.createPartnerRequest({
        ...created,
        expectedCaseVersion: bundle.caseRecord.version,
      }),
    ).toBe("CASE_INTEGRITY_ERROR");

    const after = await store.loadCaseBundle("case-rv-1028");
    expect(after?.caseRecord.version).toBe(4);
    expect(after?.partnerRequests).toEqual([created.request]);
    expect(after?.partnerTokenReceipts).toEqual([created.tokenReceipt]);
  });
  it("atomically reserves and releases a partner submission digest without changing case version", async () => {
    const store = makeStore("partner-reservation");
    await seedDemoCase(store);
    const bundle = await store.loadCaseBundle("case-rv-1028");
    if (!bundle) throw new Error("Expected RV-1028");
    const created = createPartnerRequest({
      caseRecord: bundle.caseRecord,
      requestId: "partner-request-firestore-reservation",
      rawToken: "partner-token-abcdefghijklmnopqrstuvwxyz0123456789",
      now: "2026-08-12T13:10:00.000Z",
    });
    await store.createPartnerRequest({ ...created, expectedCaseVersion: 4 });
    const reservation = {
      requestId: created.request.id,
      tokenDigest: created.tokenReceipt.digest,
      submissionEventId: "partner:partner-request-firestore-reservation:response-1",
      expectedCaseVersion: 4,
      now: "2026-08-12T13:11:00.000Z",
    };

    expect(await store.reservePartnerSubmission(reservation)).toBe("COMMITTED");
    expect(await store.releasePartnerSubmission({
      requestId: reservation.requestId,
      tokenDigest: reservation.tokenDigest,
      submissionEventId: reservation.submissionEventId,
      now: reservation.now,
    })).toBe("COMMITTED");
    const after = await store.loadPartnerRequest(created.request.id);
    expect(after?.tokenReceipt.state).toBe("FAILED_RETRYABLE");
    expect((await store.loadCaseBundle("case-rv-1028"))?.caseRecord.version).toBe(4);
  });
  it("resets only RV-1028 to the deterministic v4 connected proof baseline", async () => {
    const firestore = new Firestore({ projectId: "resolvia-task-6-7", databaseId: "(default)" });
    const prefix = `test-reset-${crypto.randomUUID()}`;
    const store = new FirestoreResolutionStore(firestore, prefix);
    await seedDemoCase(store);
    const event = makeEvent({
      id: "resolvia_demo_provider:event-reset-proof",
      kind: "PROVIDER_REFUND_OBSERVED",
      source: { category: "PROVIDER", provider: "resolvia_demo_provider", runtimeMode: "TEST" },
      occurredAt: "2026-08-12T12:00:00.000Z",
      receivedAt: "2026-08-12T12:00:00.000Z",
      correlationId: "event-reset-proof",
      payload: { providerEventId: "event-reset-proof", providerEventType: "refund.observed", providerObjectId: "demo_refund_reset", providerObjectType: "refund", providerObjectCreatedAt: "2026-08-12T12:00:00.000Z", providerStatus: "pending" },
    });
    await expect(processProviderEvent(store, event, () => "2026-08-12T12:00:01.000Z")).resolves.toEqual({ kind: "COMMITTED", caseVersion: 5 });

    const bundle = await resetConnectedRv1028({ firestore, store, collectionPrefix: prefix, runtimeMode: "CONNECTED", confirmed: true });

    expect(bundle.caseRecord).toMatchObject({ id: "case-rv-1028", state: "INVESTIGATING", version: 4 });
    expect(bundle.events).toHaveLength(2);
    expect(bundle.evidence).toMatchObject([{ verificationLevel: "AUTHENTICATED_SOURCE" }]);
    expect(bundle.claims).toMatchObject([{ id: "claim-refund-processed", status: "UNVERIFIED" }]);
    expect(bundle.providerTransactions).toEqual([]);
    expect(bundle.auditRecords).toHaveLength(2);
    expect(bundle.agentRuns).toMatchObject([{ basedOnCaseVersion: 4, outcome: "FAILED_CONFIGURATION" }]);
  });
  it("migrates only the exact legacy RV-1028 record that predates ownerUserId", async () => {
    const firestore = new Firestore({ projectId: "resolvia-task-6-7", databaseId: "(default)" });
    const prefix = `test-reset-legacy-${crypto.randomUUID()}`;
    const store = new FirestoreResolutionStore(firestore, prefix);
    const { ownerUserId: _ownerUserId, ...legacyCase } = makeCase({ id: "case-rv-1028", displayId: "RV-1028" });
    expect(_ownerUserId).toBe("resolvia-demo-user");
    const legacyCaseRef = firestore.collection(firestoreCollection(prefix, "cases")).doc(firestoreDocumentId("case-rv-1028"));
    await legacyCaseRef.set(legacyCase);
    await firestore.collection(firestoreCollection(prefix, "events")).doc(firestoreDocumentId("legacy-event")).set(makeEvent({ id: "legacy-event", caseId: "case-rv-1028" }));
    expect((await legacyCaseRef.get()).data()).not.toHaveProperty("ownerUserId");
    await expect(store.loadCaseBundle("case-rv-1028")).rejects.toThrow();

    const bundle = await resetConnectedRv1028({ firestore, store, collectionPrefix: prefix, runtimeMode: "CONNECTED", confirmed: true });

    expect(bundle.caseRecord).toMatchObject({ id: "case-rv-1028", ownerUserId: "resolvia-demo-user", version: 4 });
    expect(bundle.events.some((event) => event.id === "legacy-event")).toBe(false);
  });
  it("fails closed unless a connected RV-1028 reset is explicitly confirmed", async () => {
    const firestore = new Firestore({ projectId: "resolvia-task-6-7", databaseId: "(default)" });
    const prefix = `test-reset-denied-${crypto.randomUUID()}`;
    const store = new FirestoreResolutionStore(firestore, prefix);
    await seedDemoCase(store);

    await expect(resetConnectedRv1028({ firestore, store, collectionPrefix: prefix, runtimeMode: "LOCAL", confirmed: false })).rejects.toMatchObject({ code: "INVALID_SCOPE" });
    expect((await store.loadCaseBundle("case-rv-1028"))?.caseRecord.version).toBe(4);
  });
});

describeEmulator("Firestore event receipt integrity", () => {
  it("fails closed when a reused event id has a conflicting normalized payload", async () => {
    const store = makeStore("event-collision");
    await store.commitCaseMutation(createCaseMutation());
    const event = makeEvent({ id: "event-provider-observation" });

    expect(
      await store.commitCaseMutation(makeMutation({ eventsToAppend: [event] })),
    ).toBe("COMMITTED");
    expect(
      await store.commitCaseMutation(
        makeMutation({
          expectedCaseVersion: 2,
          caseRecord: makeCase({ version: 3 }),
          eventsToAppend: [
            { ...event, payload: { ...event.payload, conflicting: true } },
          ],
        }),
      ),
    ).toBe("CASE_INTEGRITY_ERROR");

    const bundle = await store.loadCaseBundle("case-rv-1028");
    expect(bundle?.caseRecord.version).toBe(2);
    expect(bundle?.events).toEqual([event]);
  });
});
