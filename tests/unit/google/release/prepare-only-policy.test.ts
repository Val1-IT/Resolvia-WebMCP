import { describe, expect, it } from "vitest";

import {
  evaluatePrepareOnlyPlan,
  type PrepareOnlyPlan,
} from "@/src/infrastructure/google/release/prepare-only-policy";

const basePlan: PrepareOnlyPlan = {
  createProviderPushSa: true,
  createPartnerPushSa: true,
  grantProviderTokenCreator: true,
  grantPartnerTokenCreator: true,
  modifyPushSubscription: false,
  revokeLegacyTokenCreator: false,
  updatePushEndpoint: false,
  updatePushAuthServiceAccount: false,
};

describe("prepare-only-policy", () => {
  it("allows preparing provider/partner identities without subscription cutover", () => {
    expect(evaluatePrepareOnlyPlan(basePlan)).toEqual({ ok: true });
  });

  it.each([
    ["modifyPushSubscription", { modifyPushSubscription: true }],
    ["revokeLegacyTokenCreator", { revokeLegacyTokenCreator: true }],
    ["updatePushEndpoint", { updatePushEndpoint: true }],
    ["updatePushAuthServiceAccount", { updatePushAuthServiceAccount: true }],
  ] as const)("rejects PrepareOnly plan that would %s", (_name, override) => {
    expect(evaluatePrepareOnlyPlan({ ...basePlan, ...override })).toEqual({
      ok: false,
      reason: "PREPARE_ONLY_FORBIDS_CUTOVER_MUTATION",
    });
  });

  it("requires both provider and partner identity preparation", () => {
    expect(
      evaluatePrepareOnlyPlan({
        ...basePlan,
        createPartnerPushSa: false,
        grantPartnerTokenCreator: false,
      }),
    ).toEqual({ ok: false, reason: "PREPARE_ONLY_REQUIRES_DEDICATED_IDENTITIES" });
  });
});
