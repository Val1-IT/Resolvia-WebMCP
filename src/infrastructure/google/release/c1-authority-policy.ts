export type C1AuthorityMode = "PreCutover" | "Final";

export type C1TokenCreatorBinding = {
  resourceServiceAccount: string;
  member: string;
  role: string;
};

export type C1AuthorityEvaluation =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "MISSING_LEGACY_TOKEN_CREATOR"
        | "UNEXPECTED_TOKEN_CREATOR_BINDING"
        | "LEGACY_TOKEN_CREATOR_PRESENT"
        | "MISSING_DEDICATED_TOKEN_CREATOR";
    };

const TOKEN_CREATOR = "roles/iam.serviceAccountTokenCreator";

export function pubsubServiceAgent(projectNumber: string): string {
  return `serviceAccount:service-${projectNumber}@gcp-sa-pubsub.iam.gserviceaccount.com`;
}

/**
 * C1 push identity TokenCreator policy.
 *
 * PreCutover (post-PrepareOnly, pre-M1): exact canonical Pub/Sub agent
 * TokenCreator on legacy + provider + partner push SAs. Exact-set only.
 *
 * Final (post-M1): legacy TokenCreator absent; provider + partner only.
 */
export function evaluateC1PushTokenCreatorAuthority(input: {
  mode: C1AuthorityMode;
  projectId: string;
  projectNumber: string;
  legacyPushSa: string;
  providerPushSa: string;
  partnerPushSa: string;
  bindings: readonly C1TokenCreatorBinding[];
}): C1AuthorityEvaluation {
  const expectedAgent = pubsubServiceAgent(input.projectNumber);
  const preCutoverTargets = new Set([
    input.legacyPushSa,
    input.providerPushSa,
    input.partnerPushSa,
  ]);
  const finalTargets = new Set([input.providerPushSa, input.partnerPushSa]);

  for (const binding of input.bindings) {
    if (binding.role !== TOKEN_CREATOR) {
      return { ok: false, reason: "UNEXPECTED_TOKEN_CREATOR_BINDING" };
    }
    if (binding.member !== expectedAgent) {
      return { ok: false, reason: "UNEXPECTED_TOKEN_CREATOR_BINDING" };
    }
    if (input.mode === "PreCutover") {
      if (!preCutoverTargets.has(binding.resourceServiceAccount)) {
        return { ok: false, reason: "UNEXPECTED_TOKEN_CREATOR_BINDING" };
      }
    } else if (binding.resourceServiceAccount === input.legacyPushSa) {
      return { ok: false, reason: "LEGACY_TOKEN_CREATOR_PRESENT" };
    } else if (!finalTargets.has(binding.resourceServiceAccount)) {
      return { ok: false, reason: "UNEXPECTED_TOKEN_CREATOR_BINDING" };
    }
  }

  const tokenCreatorBindings = input.bindings.filter(
    (binding) => binding.role === TOKEN_CREATOR,
  );

  const hasExact = (resourceServiceAccount: string) =>
    tokenCreatorBindings.some(
      (binding) =>
        binding.resourceServiceAccount === resourceServiceAccount &&
        binding.member === expectedAgent,
    );

  if (input.mode === "PreCutover") {
    if (!hasExact(input.legacyPushSa)) {
      return { ok: false, reason: "MISSING_LEGACY_TOKEN_CREATOR" };
    }
    if (!hasExact(input.providerPushSa) || !hasExact(input.partnerPushSa)) {
      return { ok: false, reason: "MISSING_DEDICATED_TOKEN_CREATOR" };
    }
    return { ok: true };
  }

  if (!hasExact(input.providerPushSa) || !hasExact(input.partnerPushSa)) {
    return { ok: false, reason: "MISSING_DEDICATED_TOKEN_CREATOR" };
  }
  return { ok: true };
}
