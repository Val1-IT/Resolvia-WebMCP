import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/health/route";

afterEach(() => vi.unstubAllEnvs());

function configureConnectedRuntime(): void {
  vi.stubEnv("RESOLVIA_RUNTIME_MODE", "CONNECTED");
  vi.stubEnv("GOOGLE_CLOUD_PROJECT", "resolvia-project");
  vi.stubEnv("RESOLVIA_GCP_REGION", "asia-southeast2");
  vi.stubEnv("RESOLVIA_PUBSUB_TOPIC", "resolution-events-v1");
  vi.stubEnv("RESOLVIA_PUBSUB_SUBSCRIPTION", "resolution-engine-v1");
  vi.stubEnv("RESOLVIA_WEB_URL", "https://resolvia-web.example.run.app");
  vi.stubEnv("RESOLVIA_ENGINE_AUDIENCE", "https://resolvia-engine.example.run.app");
  vi.stubEnv("RESOLVIA_FIRESTORE_DATABASE", "(default)");
  vi.stubEnv(
    "RESOLVIA_PUBSUB_PUSH_SERVICE_ACCOUNT",
    "resolvia-pubsub-push@resolvia-project.iam.gserviceaccount.com",
  );
}

describe("connected health route", () => {
  it("reports only connected readiness booleans and revision", async () => {
    configureConnectedRuntime();
    vi.stubEnv("K_REVISION", "resolvia-web-00001-test");

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      mode: "CONNECTED",
      revision: "resolvia-web-00001-test",
      firestoreReady: true,
      pubsubReady: true,
    });
  });

  it("fails closed when CONNECTED configuration is incomplete", async () => {
    vi.stubEnv("RESOLVIA_RUNTIME_MODE", "CONNECTED");

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      mode: "CONNECTED",
      revision: null,
      firestoreReady: false,
      pubsubReady: false,
    });
  });
});