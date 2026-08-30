import { describe, expect, it } from "vitest";

import { getRuntimeConfig } from "@/src/infrastructure/google/runtime-config";

const connectedEnvironment = {
  RESOLVIA_RUNTIME_MODE: "CONNECTED",
  GOOGLE_CLOUD_PROJECT: "resolvia-hackathon",
  RESOLVIA_GCP_REGION: "asia-southeast2",
  RESOLVIA_PUBSUB_TOPIC: "resolution-events-v1",
  RESOLVIA_PUBSUB_SUBSCRIPTION: "resolution-engine-v1",
  RESOLVIA_WEB_URL: "https://resolvia.example.test",
  RESOLVIA_ENGINE_AUDIENCE: "https://resolution-engine.example.test",
  RESOLVIA_FIRESTORE_DATABASE: "(default)",
  RESOLVIA_PUBSUB_PUSH_SERVICE_ACCOUNT: "resolvia-pubsub-push@resolvia-hackathon.iam.gserviceaccount.com",
  GEMINI_API_KEY: "must-not-leave-environment",
};

describe("getRuntimeConfig", () => {
  it("returns only public connected runtime settings", () => {
    const config = getRuntimeConfig(connectedEnvironment);

    expect(config).toEqual({
      mode: "CONNECTED",
      projectId: "resolvia-hackathon",
      region: "asia-southeast2",
      topicName: "resolution-events-v1",
      subscriptionName: "resolution-engine-v1",
      webUrl: "https://resolvia.example.test",
      engineAudience: "https://resolution-engine.example.test",
      firestoreDatabase: "(default)",
      pubsubPushServiceAccount: "resolvia-pubsub-push@resolvia-hackathon.iam.gserviceaccount.com",
    });
    expect(JSON.stringify(config)).not.toContain("must-not-leave-environment");
  });

  it.each([
    "GOOGLE_CLOUD_PROJECT",
    "RESOLVIA_PUBSUB_TOPIC",
    "RESOLVIA_ENGINE_AUDIENCE",
    "RESOLVIA_FIRESTORE_DATABASE",
    "RESOLVIA_PUBSUB_PUSH_SERVICE_ACCOUNT",
  ])("fails closed when CONNECTED %s is missing", (missingKey) => {
    const environment = { ...connectedEnvironment, [missingKey]: "" };

    expect(() => getRuntimeConfig(environment)).toThrow(
      expect.objectContaining({
        name: "ConnectedConfigurationError",
        code: "CONNECTED_CONFIGURATION_ERROR",
      }),
    );
  });
  it("fails closed when the runtime mode is omitted", () => {
    expect(() => getRuntimeConfig({})).toThrow(
      expect.objectContaining({
        name: "RuntimeConfigurationError",
        code: "RUNTIME_CONFIGURATION_ERROR",
      }),
    );
  });

  it("accepts paired provider and partner push service accounts", () => {
    const config = getRuntimeConfig({
      ...connectedEnvironment,
      RESOLVIA_PROVIDER_PUSH_SERVICE_ACCOUNT:
        "resolvia-provider-push@resolvia-hackathon.iam.gserviceaccount.com",
      RESOLVIA_PARTNER_PUSH_SERVICE_ACCOUNT:
        "resolvia-partner-push@resolvia-hackathon.iam.gserviceaccount.com",
    });

    expect(config.providerPushServiceAccount).toBe(
      "resolvia-provider-push@resolvia-hackathon.iam.gserviceaccount.com",
    );
    expect(config.partnerPushServiceAccount).toBe(
      "resolvia-partner-push@resolvia-hackathon.iam.gserviceaccount.com",
    );
  });

  it("fails closed when only one dedicated push service account is set", () => {
    expect(() =>
      getRuntimeConfig({
        ...connectedEnvironment,
        RESOLVIA_PROVIDER_PUSH_SERVICE_ACCOUNT:
          "resolvia-provider-push@resolvia-hackathon.iam.gserviceaccount.com",
      }),
    ).toThrow(
      expect.objectContaining({
        name: "ConnectedConfigurationError",
        code: "CONNECTED_CONFIGURATION_ERROR",
      }),
    );
  });
});
