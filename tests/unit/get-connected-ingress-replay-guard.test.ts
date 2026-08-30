import { describe, expect, it } from "vitest";

import {
  getConnectedIngressReplayGuard,
  IngressReplayUnavailableError,
} from "@/src/infrastructure/google/get-connected-ingress-replay-guard";
import type { RuntimeConfig } from "@/src/infrastructure/google/runtime-config";

const connectedRuntime: RuntimeConfig = {
  mode: "CONNECTED",
  projectId: "resolvia-project",
  region: "asia-southeast2",
  topicName: "resolution-events-v1",
  subscriptionName: "resolution-engine-v1",
  webUrl: "https://web.example.test",
  engineAudience: "https://engine.example.test",
  firestoreDatabase: "(default)",
  pubsubPushServiceAccount: "push@example.test",
};

describe("getConnectedIngressReplayGuard", () => {
  it("fails closed without connected Firestore and HMAC configuration", () => {
    expect(() =>
      getConnectedIngressReplayGuard(
        { mode: "LOCAL" },
        { RESOLVIA_RATE_LIMIT_HMAC_SECRET: "x".repeat(32) },
      ),
    ).toThrow(IngressReplayUnavailableError);
    expect(() =>
      getConnectedIngressReplayGuard(connectedRuntime, {}),
    ).toThrow(IngressReplayUnavailableError);
  });

  it("returns an effectively singleton connected guard without exposing the secret", () => {
    const env = { RESOLVIA_RATE_LIMIT_HMAC_SECRET: "x".repeat(32) };
    const first = getConnectedIngressReplayGuard(connectedRuntime, env);
    const second = getConnectedIngressReplayGuard(connectedRuntime, env);

    expect(second).toBe(first);
    expect(JSON.stringify(first)).not.toContain(env.RESOLVIA_RATE_LIMIT_HMAC_SECRET);
  });
});
