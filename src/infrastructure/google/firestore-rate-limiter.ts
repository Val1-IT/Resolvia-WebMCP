import { createHmac } from "node:crypto";

import type { Firestore } from "@google-cloud/firestore";

import type { RateLimitDecision, RateLimitInput, RateLimiter } from "@/src/application/ports/rate-limiter";
import { firestoreCollection } from "@/src/infrastructure/google/firestore-codec";

export class FirestoreRateLimiter implements RateLimiter {
  constructor(
    private readonly firestore: Firestore,
    private readonly collectionPrefix: string,
    private readonly hmacSecret: string,
    private readonly now: () => number = Date.now,
  ) {
    if (!/^[A-Za-z0-9_-]{1,100}$/u.test(collectionPrefix)) throw new Error("Invalid Firestore collection prefix.");
    if (Buffer.byteLength(hmacSecret, "utf8") < 32) throw new Error("Rate-limit HMAC secret is unavailable.");
  }

  async consume(input: RateLimitInput): Promise<RateLimitDecision> {
    validateInput(input);
    const nowMs = this.now();
    if (!Number.isFinite(nowMs)) throw new Error("Rate-limit clock is invalid.");
    const windowMs = input.windowSeconds * 1_000;
    const windowStartedAtMs = Math.floor(nowMs / windowMs) * windowMs;
    const windowEndsAtMs = windowStartedAtMs + windowMs;
    const id = createHmac("sha256", this.hmacSecret)
      .update(`${input.scope}\u0000${input.key}\u0000${windowStartedAtMs}`, "utf8")
      .digest("base64url");
    const reference = this.firestore.collection(firestoreCollection(this.collectionPrefix, "rateLimits")).doc(id);

    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const count = snapshot.exists ? storedCount(snapshot.data(), input, windowStartedAtMs) : 0;
      if (count >= input.limit) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((windowEndsAtMs - nowMs) / 1_000)) };
      }
      const nextCount = count + 1;
      transaction.set(reference, {
        scope: input.scope,
        windowStartedAt: new Date(windowStartedAtMs).toISOString(),
        windowSeconds: input.windowSeconds,
        count: nextCount,
        expiresAt: new Date(windowEndsAtMs + windowMs).toISOString(),
      });
      return { allowed: true, remaining: input.limit - nextCount };
    });
  }
}

function validateInput(input: RateLimitInput): void {
  if (!input.key || Buffer.byteLength(input.key, "utf8") > 1_024) throw new Error("Invalid rate-limit key.");
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 10_000) throw new Error("Invalid rate-limit limit.");
  if (!Number.isInteger(input.windowSeconds) || input.windowSeconds < 1 || input.windowSeconds > 86_400) throw new Error("Invalid rate-limit window.");
}

function storedCount(data: FirebaseFirestore.DocumentData | undefined, input: RateLimitInput, windowStartedAtMs: number): number {
  if (!data || data.scope !== input.scope || data.windowStartedAt !== new Date(windowStartedAtMs).toISOString() || data.windowSeconds !== input.windowSeconds || !Number.isInteger(data.count) || data.count < 0 || data.count > input.limit) {
    throw new Error("Invalid rate-limit record.");
  }
  return data.count as number;
}