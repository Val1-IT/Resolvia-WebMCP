import { describe, expect, it } from "vitest";

import { createAutomationRunRoute } from "@/app/api/internal/automation/run/route";

const runtime = {
  mode: "CONNECTED" as const, projectId: "resolvia-project", region: "asia-southeast2",
  topicName: "resolution-events-v1", subscriptionName: "resolution-engine-v1",
  webUrl: "https://web.example.test", engineAudience: "https://engine.example.test",
  firestoreDatabase: "(default)", pubsubPushServiceAccount: "push@resolvia-project.iam.gserviceaccount.com",
};

describe("private automation scheduler route", () => {
  it("runs one bounded batch only for the dedicated scheduler identity", async () => {
    const route = createAutomationRunRoute({
      getRuntime: () => runtime,
      verifyIdentity: async (_request, audience, accounts) =>
        audience === runtime.engineAudience &&
        accounts.includes("resolvia-scheduler@resolvia-project.iam.gserviceaccount.com")
          ? "resolvia-scheduler@resolvia-project.iam.gserviceaccount.com"
          : null,
      runBatch: async (limit) => ({ scanned: limit, claimed: 1, succeeded: 1, retryable: 0, terminal: 0 }),
    });
    const response = await route(new Request("https://engine.example.test/api/internal/automation/run", { method: "POST", headers: { authorization: "Bearer synthetic" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ scanned: 25, claimed: 1, succeeded: 1, retryable: 0, terminal: 0 });
  });

  it("rejects an unauthenticated caller before work is loaded", async () => {
    const route = createAutomationRunRoute({
      getRuntime: () => runtime,
      verifyIdentity: async () => null,
      runBatch: async () => { throw new Error("must not run"); },
    });
    expect((await route(new Request("https://engine.example.test", { method: "POST" }))).status).toBe(401);
  });
});
