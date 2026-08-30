import { Firestore } from "@google-cloud/firestore";
import { describe, expect, it } from "vitest";

import { FirestoreResolutionStore } from "@/src/infrastructure/google/firestore-resolution-store";
import { firestoreCollection, firestoreDocumentId } from "@/src/infrastructure/google/firestore-codec";
import { makeCase, makeEvent } from "@/tests/fixtures/domain";

const describeEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeEmulator("Firestore case bundle bounds", () => {
  it("fails closed instead of silently truncating an oversized case collection", async () => {
    const firestore = new Firestore({ projectId: "resolvia-bounded-bundle", databaseId: "(default)" });
    const prefix = `test-bounded-bundle-${crypto.randomUUID()}`;
    const store = new FirestoreResolutionStore(firestore, prefix);
    await firestore
      .collection(firestoreCollection(prefix, "cases"))
      .doc(firestoreDocumentId("case-rv-1028"))
      .set(makeCase({ version: 1 }));
    const batch = firestore.batch();
    for (let index = 0; index < 501; index += 1) {
      const event = makeEvent({ id: `event-bound-${index}` });
      batch.set(firestore.collection(firestoreCollection(prefix, "events")).doc(firestoreDocumentId(event.id)), event);
    }
    await batch.commit();

    await expect(store.loadCaseBundle("case-rv-1028")).rejects.toMatchObject({
      code: "CASE_COLLECTION_LIMIT_EXCEEDED",
    });
  }, 30_000);
});