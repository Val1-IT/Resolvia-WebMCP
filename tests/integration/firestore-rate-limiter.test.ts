import { Firestore } from "@google-cloud/firestore";
import { describe, expect, it } from "vitest";

import { FirestoreRateLimiter } from "@/src/infrastructure/google/firestore-rate-limiter";
import { firestoreCollection } from "@/src/infrastructure/google/firestore-codec";

const describeEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeEmulator("FirestoreRateLimiter", () => {
  it("atomically enforces a fixed window without persisting the raw subject or source", async () => {
    const firestore = new Firestore({ projectId: "resolvia-rate-limit-test", databaseId: "(default)" });
    const prefix = `test-rate-limit-${crypto.randomUUID()}`;
    let nowMs = Date.parse("2026-08-13T01:00:00.000Z");
    const limiter = new FirestoreRateLimiter(firestore, prefix, "rate-limit-secret-abcdefghijklmnopqrstuvwxyz", () => nowMs);
    const input = { scope: "PARTNER" as const, key: "raw-partner-token\u0000203.0.113.10", limit: 2, windowSeconds: 60 };

    await expect(limiter.consume(input)).resolves.toEqual({ allowed: true, remaining: 1 });
    await expect(limiter.consume(input)).resolves.toEqual({ allowed: true, remaining: 0 });
    await expect(limiter.consume(input)).resolves.toEqual({ allowed: false, retryAfterSeconds: 60 });

    const snapshot = await firestore.collection(firestoreCollection(prefix, "rateLimits")).get();
    expect(snapshot.size).toBe(1);
    expect(JSON.stringify(snapshot.docs[0]?.data())).not.toContain("raw-partner-token");
    expect(JSON.stringify(snapshot.docs[0]?.data())).not.toContain("203.0.113.10");

    nowMs += 60_000;
    await expect(limiter.consume(input)).resolves.toEqual({ allowed: true, remaining: 1 });
  });

  it("allows no more than the configured limit under concurrent transactions", async () => {
    const firestore = new Firestore({ projectId: "resolvia-rate-limit-test", databaseId: "(default)" });
    const limiter = new FirestoreRateLimiter(
      firestore,
      `test-rate-limit-concurrent-${crypto.randomUUID()}`,
      "rate-limit-secret-abcdefghijklmnopqrstuvwxyz",
      () => Date.parse("2026-08-13T01:05:00.000Z"),
    );
    const decisions = await Promise.all(Array.from({ length: 10 }, () => limiter.consume({
      scope: "SESSION",
      key: "firebase-user-a\u0000203.0.113.20",
      limit: 3,
      windowSeconds: 60,
    })));
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(3);
    expect(decisions.filter((decision) => !decision.allowed)).toHaveLength(7);
  }, 15_000);
});