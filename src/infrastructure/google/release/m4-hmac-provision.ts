export type HmacProvisionStep =
  | "VERIFY_ACCESSOR_BINDING"
  | "CREATE_SECRET_VERSION";

export type HmacProvisionEvaluation =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "ACCESSOR_PROOF_REQUIRED_BEFORE_VERSION"
        | "INVALID_HMAC_PROVISION_SEQUENCE";
    };

/**
 * M4: verify secretAccessor binding before creating a secret version.
 */
export function evaluateHmacProvisionOrder(
  steps: readonly HmacProvisionStep[],
): HmacProvisionEvaluation {
  if (steps.length !== 2) {
    if (steps.includes("CREATE_SECRET_VERSION") && !steps.includes("VERIFY_ACCESSOR_BINDING")) {
      return { ok: false, reason: "ACCESSOR_PROOF_REQUIRED_BEFORE_VERSION" };
    }
    return { ok: false, reason: "INVALID_HMAC_PROVISION_SEQUENCE" };
  }
  if (steps[0] !== "VERIFY_ACCESSOR_BINDING") {
    return { ok: false, reason: "ACCESSOR_PROOF_REQUIRED_BEFORE_VERSION" };
  }
  if (steps[1] !== "CREATE_SECRET_VERSION") {
    return { ok: false, reason: "INVALID_HMAC_PROVISION_SEQUENCE" };
  }
  return { ok: true };
}
