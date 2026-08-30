import { createHmac } from "node:crypto";

import { Firestore } from "@google-cloud/firestore";

import type { IngressReplayGuard } from "@/src/application/ports/ingress-replay-guard";
import { FirestoreIngressReplayGuard } from "@/src/infrastructure/google/firestore-ingress-replay-guard";
import type { RuntimeConfig } from "@/src/infrastructure/google/runtime-config";

let guard: IngressReplayGuard | undefined;

export function getConnectedIngressReplayGuard(
  runtime: RuntimeConfig,
  env: Record<string, string | undefined> = process.env,
): IngressReplayGuard {
  const secret = env.RESOLVIA_RATE_LIMIT_HMAC_SECRET;
  if (
    runtime.mode !== "CONNECTED" ||
    !runtime.projectId ||
    !runtime.firestoreDatabase ||
    !secret
  ) {
    throw new IngressReplayUnavailableError();
  }

  try {
    guard ??= new FirestoreIngressReplayGuard(
      new Firestore({
        projectId: runtime.projectId,
        databaseId: runtime.firestoreDatabase,
      }),
      "resolvia",
      createHmac("sha256", secret)
        .update("resolvia-ingress-replay-v1", "utf8")
        .digest("base64url"),
    );
    return guard;
  } catch {
    throw new IngressReplayUnavailableError();
  }
}

export class IngressReplayUnavailableError extends Error {
  readonly code = "INGRESS_REPLAY_UNAVAILABLE";

  constructor() {
    super("Connected ingress replay protection is unavailable.");
    this.name = "IngressReplayUnavailableError";
  }
}
