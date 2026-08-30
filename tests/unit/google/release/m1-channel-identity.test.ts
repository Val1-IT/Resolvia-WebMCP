import { describe, expect, it } from "vitest";

import {
  assertEventCategoryMatchesChannel,
  buildAllowedPushServiceAccounts,
  resolveChannelFromVerifiedPrincipal,
  type M1ChannelIdentityConfig,
} from "@/src/infrastructure/google/release/m1-channel-identity";

const config: M1ChannelIdentityConfig = {
  providerPushSa: "resolvia-provider-push@resolvia-project.iam.gserviceaccount.com",
  partnerPushSa: "resolvia-partner-push@resolvia-project.iam.gserviceaccount.com",
  legacyPushSa: "resolvia-pubsub-push@resolvia-project.iam.gserviceaccount.com",
};

describe("resolveChannelFromVerifiedPrincipal", () => {
  it("maps the provider push SA to PROVIDER", () => {
    expect(resolveChannelFromVerifiedPrincipal(config.providerPushSa, config)).toBe(
      "PROVIDER",
    );
  });

  it("maps the partner push SA to PARTNER", () => {
    expect(resolveChannelFromVerifiedPrincipal(config.partnerPushSa, config)).toBe(
      "PARTNER",
    );
  });

  it("rejects the legacy push SA for channel selection", () => {
    expect(resolveChannelFromVerifiedPrincipal(config.legacyPushSa!, config)).toBeNull();
  });

  it("rejects unknown principals", () => {
    expect(
      resolveChannelFromVerifiedPrincipal(
        "other@resolvia-project.iam.gserviceaccount.com",
        config,
      ),
    ).toBeNull();
  });

  it("ignores request-body category hints when resolving channel", () => {
    const bodyHint = { source: { category: "PARTNER" as const } };
    expect(
      resolveChannelFromVerifiedPrincipal(config.providerPushSa, config, bodyHint),
    ).toBe("PROVIDER");
  });
});

describe("assertEventCategoryMatchesChannel", () => {
  it("accepts matching category and channel", () => {
    expect(assertEventCategoryMatchesChannel("PROVIDER", "PROVIDER")).toBe(true);
    expect(assertEventCategoryMatchesChannel("PARTNER", "PARTNER")).toBe(true);
  });

  it("rejects category/channel conflicts", () => {
    expect(assertEventCategoryMatchesChannel("PARTNER", "PROVIDER")).toBe(false);
    expect(assertEventCategoryMatchesChannel("PROVIDER", "PARTNER")).toBe(false);
  });
});

describe("buildAllowedPushServiceAccounts", () => {
  it("includes provider, partner, and optional legacy principals", () => {
    expect(buildAllowedPushServiceAccounts(config)).toEqual([
      config.providerPushSa,
      config.partnerPushSa,
      config.legacyPushSa,
    ]);
  });

  it("omits legacy when absent", () => {
    expect(
      buildAllowedPushServiceAccounts({
        providerPushSa: config.providerPushSa,
        partnerPushSa: config.partnerPushSa,
      }),
    ).toEqual([config.providerPushSa, config.partnerPushSa]);
  });
});
