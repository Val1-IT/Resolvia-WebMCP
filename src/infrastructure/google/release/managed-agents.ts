export const MANAGED_AGENT_ROLES = {
  pubsub: ["roles/iam.serviceAccountTokenCreator", "roles/pubsub.publisher"] as const,
  cloudRun: [
    "roles/iam.serviceAccountUser",
    "roles/iam.serviceAccountTokenCreator",
  ] as const,
} as const;

export type ManagedAgentKind = "pubsub" | "cloudRun";

const EXACT_PUBSUB_AGENT =
  /^serviceAccount:service-(\d+)@gcp-sa-pubsub\.iam\.gserviceaccount\.com$/u;
const EXACT_CLOUD_RUN_AGENT =
  /^serviceAccount:service-(\d+)@serverless-robot-prod\.iam\.gserviceaccount\.com$/u;

export type ManagedAgentEvaluation =
  | { ok: true }
  | {
      ok: false;
      reason: "WILDCARD_OR_NON_EXACT_PRINCIPAL" | "UNEXPECTED_MANAGED_AGENT_ROLE";
    };

export type CloudRunActAsEvaluation =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "WILDCARD_OR_NON_EXACT_PRINCIPAL"
        | "UNEXPECTED_MANAGED_AGENT_ROLE"
        | "UNEXPECTED_ACTAS_TARGET";
    };

export function managedAgentPrincipal(
  kind: ManagedAgentKind,
  projectNumber: string,
): string {
  if (!/^\d+$/u.test(projectNumber)) {
    throw new Error("projectNumber must be numeric");
  }
  if (kind === "pubsub") {
    return `serviceAccount:service-${projectNumber}@gcp-sa-pubsub.iam.gserviceaccount.com`;
  }
  if (kind === "cloudRun") {
    return `serviceAccount:service-${projectNumber}@serverless-robot-prod.iam.gserviceaccount.com`;
  }
  throw new Error("unsupported managed agent kind");
}

function principalMatchesKind(member: string, kind: ManagedAgentKind): boolean {
  if (member.includes("*")) return false;
  if (kind === "pubsub") return EXACT_PUBSUB_AGENT.test(member);
  return EXACT_CLOUD_RUN_AGENT.test(member);
}

/**
 * Managed Google service agents must be exact principal+role only.
 * service-* wildcards and unexpected roles fail closed.
 */
export function evaluateManagedAgentBinding(input: {
  member: string;
  role: string;
  kind: ManagedAgentKind;
  allowedRoles: readonly string[];
}): ManagedAgentEvaluation {
  if (!principalMatchesKind(input.member, input.kind)) {
    return { ok: false, reason: "WILDCARD_OR_NON_EXACT_PRINCIPAL" };
  }
  if (!input.allowedRoles.includes(input.role)) {
    return { ok: false, reason: "UNEXPECTED_MANAGED_AGENT_ROLE" };
  }
  return { ok: true };
}

/**
 * Cloud Run service agent may actAs / getAccessToken only against the exact
 * runtime service account for the service being deployed.
 */
export function evaluateCloudRunServiceAgentActAs(input: {
  member: string;
  role: string;
  projectNumber: string;
  targetServiceAccount: string;
  expectedRuntimeServiceAccount: string;
}): CloudRunActAsEvaluation {
  const expectedMember = managedAgentPrincipal("cloudRun", input.projectNumber);
  if (input.member !== expectedMember || input.member.includes("*")) {
    return { ok: false, reason: "WILDCARD_OR_NON_EXACT_PRINCIPAL" };
  }
  if (
    input.role !== "roles/iam.serviceAccountUser" &&
    input.role !== "roles/iam.serviceAccountTokenCreator"
  ) {
    return { ok: false, reason: "UNEXPECTED_MANAGED_AGENT_ROLE" };
  }
  if (input.targetServiceAccount !== input.expectedRuntimeServiceAccount) {
    return { ok: false, reason: "UNEXPECTED_ACTAS_TARGET" };
  }
  return { ok: true };
}
