import { Firestore } from "@google-cloud/firestore";

import type { RateLimiter } from "@/src/application/ports/rate-limiter";
import { FirestoreRateLimiter } from "@/src/infrastructure/google/firestore-rate-limiter";
import type { RuntimeConfig } from "@/src/infrastructure/google/runtime-config";

let limiter: RateLimiter | undefined;

export function getConnectedRateLimiter(runtime: RuntimeConfig, env: Record<string, string | undefined> = process.env): RateLimiter {
  const secret = env.RESOLVIA_RATE_LIMIT_HMAC_SECRET;
  if (runtime.mode !== "CONNECTED" || !runtime.projectId || !runtime.firestoreDatabase || !secret) {
    throw new RateLimitUnavailableError();
  }
  try {
    limiter ??= new FirestoreRateLimiter(
      new Firestore({ projectId: runtime.projectId, databaseId: runtime.firestoreDatabase }),
      "resolvia",
      secret,
    );
    return limiter;
  } catch {
    throw new RateLimitUnavailableError();
  }
}

export class RateLimitUnavailableError extends Error {
  readonly code = "RATE_LIMIT_UNAVAILABLE";
  constructor() {
    super("Connected rate limiting is unavailable.");
    this.name = "RateLimitUnavailableError";
  }
}