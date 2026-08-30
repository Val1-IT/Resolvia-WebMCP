import { Firestore } from "@google-cloud/firestore";
import { describe, expect, it } from "vitest";

import { FirestoreResolutionStore } from "@/src/infrastructure/google/firestore-resolution-store";
import {
  createCaseMutation,
  makeCase,
  makeEvent,
  makeMutation,
} from "@/tests/fixtures/domain";

const describeEmulator = process.env.FIRESTORE_EMULATOR_HOST
  ? describe
  : describe.skip;

describeEmulator("FirestoreResolutionStore global ownership", () => {
  it("fails closed when another case reuses an existing event ID", async () => {
    const firestore = new Firestore({
      projectId: "resolvia-task-6-2",
      databaseId: "(default)",
    });
    const store = new FirestoreResolutionStore(
      firestore,
      `test-global-event-${crypto.randomUUID()}`,
    );
    await store.commitCaseMutation(createCaseMutation());
    const event = makeEvent({ id: "event-globally-owned" });
    await store.commitCaseMutation(makeMutation({ eventsToAppend: [event] }));

    const result = await store.commitCaseMutation({
      caseRecord: makeCase({
        id: "case-other",
        displayId: "RV-OTHER",
        version: 1,
        parties: [],
      }),
      expectedCaseVersion: null,
      eventsToAppend: [
        makeEvent({ id: event.id, caseId: "case-other" }),
      ],
      evidenceToAdd: [],
      claimsToSave: [],
      auditRecordsToAppend: [],
      transactionsToAdd: [],
    });

    expect(result).toBe("CASE_INTEGRITY_ERROR");
    expect(await store.loadCaseBundle("case-other")).toBeNull();
  });
});
