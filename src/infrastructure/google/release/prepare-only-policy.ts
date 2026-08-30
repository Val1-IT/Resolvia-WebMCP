export type PrepareOnlyPlan = {
  createProviderPushSa: boolean;
  createPartnerPushSa: boolean;
  grantProviderTokenCreator: boolean;
  grantPartnerTokenCreator: boolean;
  modifyPushSubscription: boolean;
  revokeLegacyTokenCreator: boolean;
  updatePushEndpoint: boolean;
  updatePushAuthServiceAccount: boolean;
};

export type PrepareOnlyEvaluation =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "PREPARE_ONLY_FORBIDS_CUTOVER_MUTATION"
        | "PREPARE_ONLY_REQUIRES_DEDICATED_IDENTITIES";
    };

/**
 * PrepareOnly prepares provider/partner identities without modifying
 * push subscription config or revoking legacy TokenCreator bindings.
 */
export function evaluatePrepareOnlyPlan(
  plan: PrepareOnlyPlan,
): PrepareOnlyEvaluation {
  if (
    plan.modifyPushSubscription ||
    plan.revokeLegacyTokenCreator ||
    plan.updatePushEndpoint ||
    plan.updatePushAuthServiceAccount
  ) {
    return { ok: false, reason: "PREPARE_ONLY_FORBIDS_CUTOVER_MUTATION" };
  }
  if (
    !plan.createProviderPushSa ||
    !plan.createPartnerPushSa ||
    !plan.grantProviderTokenCreator ||
    !plan.grantPartnerTokenCreator
  ) {
    return { ok: false, reason: "PREPARE_ONLY_REQUIRES_DEDICATED_IDENTITIES" };
  }
  return { ok: true };
}
