import { Firestore } from "@google-cloud/firestore";
import { describe, expect, it } from "vitest";

import { FirestoreIngressReplayGuard } from "@/src/infrastructure/google/firestore-ingress-replay-guard";
import { firestoreCollection } from "@/src/infrastructure/google/firestore-codec";

const describeEmulator = process.env.FIRESTORE_EMULATOR_HOST
  ? describe
  : describe.skip;

const firstClaim = {
  scope: "DEMO_PROVIDER" as const,
  replayKey: "nonce_replay_receipt_123",
  payloadDigest: `sha256:${"a".repeat(64)}`,
  semanticId: "resolvia_demo_provider:event_123",
  leaseId: "lease-owner-1",
  now: "2026-08-13T07:00:00.000Z",
  leaseUntil: "2026-08-13T07:01:00.000Z",
  expiresAt: "2026-08-13T07:10:00.000Z",
};

describeEmulator("FirestoreIngressReplayGuard", () => {
  it("leases once across concurrent instances and persists no raw nonce", async () => {
    const firestore = new Firestore({
      projectId: "resolvia-replay-test",
      databaseId: "(default)",
    });
    const prefix = `test-replay-${crypto.randomUUID()}`;
    const guard = new FirestoreIngressReplayGuard(
      firestore,
      prefix,
      "replay-hmac-secret-abcdefghijklmnopqrstuvwxyz",
    );

    const decisions = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        guard.claim({
          ...firstClaim,
          leaseId: `lease-owner-${index + 1}`,
        }),
      ),
    );

    expect(decisions.filter((decision) => decision.kind === "CLAIMED")).toHaveLength(1);
    expect(decisions.filter((decision) => decision.kind === "IN_PROGRESS")).toHaveLength(9);
    const snapshot = await firestore
      .collection(firestoreCollection(prefix, "ingressReplayReceipts"))
      .get();
    expect(snapshot.size).toBe(1);
    expect(JSON.stringify(snapshot.docs[0]?.data())).not.toContain(
      firstClaim.replayKey,
    );
  }, 20_000);

  it("returns duplicate only after the active owner marks publication", async () => {
    const firestore = new Firestore({
      projectId: "resolvia-replay-test",
      databaseId: "(default)",
    });
    const guard = new FirestoreIngressReplayGuard(
      firestore,
      `test-replay-published-${crypto.randomUUID()}`,
      "replay-hmac-secret-abcdefghijklmnopqrstuvwxyz",
    );

    await expect(guard.claim(firstClaim)).resolves.toEqual({ kind: "CLAIMED" });
    await guard.markPublished(firstClaim);
    await expect(
      guard.claim({ ...firstClaim, leaseId: "lease-owner-2" }),
    ).resolves.toEqual({ kind: "DUPLICATE" });
  });

  it("releases failed publication for an immediate same-payload retry", async () => {
    const firestore = new Firestore({
      projectId: "resolvia-replay-test",
      databaseId: "(default)",
    });
    const guard = new FirestoreIngressReplayGuard(
      firestore,
      `test-replay-release-${crypto.randomUUID()}`,
      "replay-hmac-secret-abcdefghijklmnopqrstuvwxyz",
    );

    await expect(guard.claim(firstClaim)).resolves.toEqual({ kind: "CLAIMED" });
    await guard.release(firstClaim);
    await expect(
      guard.claim({ ...firstClaim, leaseId: "lease-owner-2" }),
    ).resolves.toEqual({ kind: "CLAIMED" });
  });
});
