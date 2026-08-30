import { describe, expect, it } from "vitest";

import { verifyGooglePubSubIdentity } from "@/src/infrastructure/google/pubsub-push-identity";

describe("verifyGooglePubSubIdentity", () => {
  it("rejects an absent bearer token without contacting the verifier", async () => {
    await expect(
      verifyGooglePubSubIdentity(
        new Request("https://engine.example.test"),
        "https://engine.example.test",
        ["resolvia-pubsub-push@resolvia-project.iam.gserviceaccount.com"],
      ),
    ).resolves.toBeNull();
  });

  it("rejects an empty allow-list without contacting the verifier", async () => {
    await expect(
      verifyGooglePubSubIdentity(
        new Request("https://engine.example.test", {
          headers: { authorization: "Bearer token" },
        }),
        "https://engine.example.test",
        [],
      ),
    ).resolves.toBeNull();
  });
});