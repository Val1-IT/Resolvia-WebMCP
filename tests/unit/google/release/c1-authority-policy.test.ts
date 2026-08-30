import { describe, expect, it } from "vitest";

import {
  evaluateC1PushTokenCreatorAuthority,
  type C1AuthorityMode,
  type C1TokenCreatorBinding,
} from "@/src/infrastructure/google/release/c1-authority-policy";
import { evaluatePrepareOnlyPlan } from "@/src/infrastructure/google/release/prepare-only-policy";

const projectId = "resolvia-project";
const projectNumber = "123456789012";
const legacyPushSa = `resolvia-pubsub-push@${projectId}.iam.gserviceaccount.com`;
const providerPushSa = `resolvia-provider-push@${projectId}.iam.gserviceaccount.com`;
const partnerPushSa = `resolvia-partner-push@${projectId}.iam.gserviceaccount.com`;
const webSa = `resolvia-web@${projectId}.iam.gserviceaccount.com`;
const pubsubAgent = `service-${projectNumber}@gcp-sa-pubsub.iam.gserviceaccount.com`;
const pubsubMember = `serviceAccount:${pubsubAgent}`;

function binding(
  resourceServiceAccount: string,
  member: string,
  role = "roles/iam.serviceAccountTokenCreator",
): C1TokenCreatorBinding {
  return { resourceServiceAccount, member, role };
}

function preparedPreCutoverBindings(): C1TokenCreatorBinding[] {
  return [
    binding(legacyPushSa, pubsubMember),
    binding(providerPushSa, pubsubMember),
    binding(partnerPushSa, pubsubMember),
  ];
}

function evaluate(
  mode: C1AuthorityMode,
  bindings: C1TokenCreatorBinding[],
) {
  return evaluateC1PushTokenCreatorAuthority({
    mode,
    projectId,
    projectNumber,
    legacyPushSa,
    providerPushSa,
    partnerPushSa,
    bindings,
  });
}

describe("c1-authority-policy PreCutover", () => {
  const mode: C1AuthorityMode = "PreCutover";

  it("1. passes when legacy+provider+partner have exact canonical Pub/Sub TokenCreator only", () => {
    expect(evaluate(mode, preparedPreCutoverBindings())).toEqual({ ok: true });
  });

  it("2. fails when a required provider/partner TokenCreator relationship is missing", () => {
    expect(
      evaluate(mode, [
        binding(legacyPushSa, pubsubMember),
        binding(providerPushSa, pubsubMember),
      ]),
    ).toEqual({ ok: false, reason: "MISSING_DEDICATED_TOKEN_CREATOR" });
  });

  it("3. fails when an arbitrary principal has TokenCreator on provider-push", () => {
    expect(
      evaluate(mode, [
        ...preparedPreCutoverBindings(),
        binding(providerPushSa, `serviceAccount:${webSa}`),
      ]),
    ).toEqual({ ok: false, reason: "UNEXPECTED_TOKEN_CREATOR_BINDING" });
  });

  it("4. fails when canonical Pub/Sub agent TokenCreator is on a wrong SA", () => {
    expect(
      evaluate(mode, [
        ...preparedPreCutoverBindings(),
        binding(webSa, pubsubMember),
      ]),
    ).toEqual({ ok: false, reason: "UNEXPECTED_TOKEN_CREATOR_BINDING" });
  });

  it("5. fails when an additional TokenCreator member is present", () => {
    expect(
      evaluate(mode, [
        binding(legacyPushSa, pubsubMember),
        binding(providerPushSa, pubsubMember),
        binding(partnerPushSa, pubsubMember),
        binding(partnerPushSa, `serviceAccount:extra@${projectId}.iam.gserviceaccount.com`),
      ]),
    ).toEqual({ ok: false, reason: "UNEXPECTED_TOKEN_CREATOR_BINDING" });
  });

  it("6. fails when signing/key authority appears on a push SA", () => {
    expect(
      evaluate(mode, [
        ...preparedPreCutoverBindings(),
        binding(providerPushSa, pubsubMember, "roles/iam.serviceAccountTokenCreator"),
        binding(providerPushSa, pubsubMember, "roles/iam.serviceAccountKeyAdmin"),
      ]),
    ).toEqual({ ok: false, reason: "UNEXPECTED_TOKEN_CREATOR_BINDING" });

    expect(
      evaluate(mode, [
        ...preparedPreCutoverBindings(),
        {
          resourceServiceAccount: partnerPushSa,
          member: pubsubMember,
          role: "roles/iam.serviceAccountOpenIdTokenCreator",
        },
      ]),
    ).toEqual({ ok: false, reason: "UNEXPECTED_TOKEN_CREATOR_BINDING" });
  });

  it("requires the legacy TokenCreator binding to be present in PreCutover", () => {
    expect(
      evaluate(mode, [
        binding(providerPushSa, pubsubMember),
        binding(partnerPushSa, pubsubMember),
      ]),
    ).toEqual({ ok: false, reason: "MISSING_LEGACY_TOKEN_CREATOR" });
  });
});

describe("c1-authority-policy Final", () => {
  const mode: C1AuthorityMode = "Final";

  it("7. passes when provider+partner have exact canonical TokenCreator and legacy is absent", () => {
    expect(
      evaluate(mode, [
        binding(providerPushSa, pubsubMember),
        binding(partnerPushSa, pubsubMember),
      ]),
    ).toEqual({ ok: true });
  });

  it("8. fails when legacy TokenCreator remains", () => {
    expect(
      evaluate(mode, [
        binding(legacyPushSa, pubsubMember),
        binding(providerPushSa, pubsubMember),
        binding(partnerPushSa, pubsubMember),
      ]),
    ).toEqual({ ok: false, reason: "LEGACY_TOKEN_CREATOR_PRESENT" });
  });

  it("9. fails when provider or partner TokenCreator is missing", () => {
    expect(
      evaluate(mode, [binding(providerPushSa, pubsubMember)]),
    ).toEqual({ ok: false, reason: "MISSING_DEDICATED_TOKEN_CREATOR" });
  });

  it("rejects non-pubsub agent members on dedicated push SAs", () => {
    expect(
      evaluate(mode, [
        binding(providerPushSa, `serviceAccount:${webSa}`),
        binding(partnerPushSa, pubsubMember),
      ]),
    ).toEqual({ ok: false, reason: "UNEXPECTED_TOKEN_CREATOR_BINDING" });
  });
});

describe("PrepareOnly ↔ C1 PreCutover consistency", () => {
  it("PrepareOnly plan that grants provider/partner TokenCreator and preserves legacy matches PreCutover PASS topology", () => {
    const prepare = evaluatePrepareOnlyPlan({
      createProviderPushSa: true,
      createPartnerPushSa: true,
      grantProviderTokenCreator: true,
      grantPartnerTokenCreator: true,
      modifyPushSubscription: false,
      revokeLegacyTokenCreator: false,
      updatePushEndpoint: false,
      updatePushAuthServiceAccount: false,
    });
    expect(prepare).toEqual({ ok: true });

    // PrepareOnly creates dedicated TokenCreators and leaves legacy intact —
    // that is exactly the PreCutover expected binding set (plus legacy already live).
    expect(evaluate("PreCutover", preparedPreCutoverBindings())).toEqual({ ok: true });
  });
});
