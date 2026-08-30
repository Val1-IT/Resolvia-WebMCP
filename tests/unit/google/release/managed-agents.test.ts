import { describe, expect, it } from "vitest";

import {
  evaluateCloudRunServiceAgentActAs,
  evaluateManagedAgentBinding,
  MANAGED_AGENT_ROLES,
  managedAgentPrincipal,
} from "@/src/infrastructure/google/release/managed-agents";

const projectNumber = "123456789012";
const runtimeSa = "resolvia-web@resolvia-project.iam.gserviceaccount.com";

describe("managed-agents", () => {
  it("accepts exact Pub/Sub managed agent principal with exact role", () => {
    expect(
      evaluateManagedAgentBinding({
        member: managedAgentPrincipal("pubsub", projectNumber),
        role: "roles/iam.serviceAccountTokenCreator",
        kind: "pubsub",
        allowedRoles: MANAGED_AGENT_ROLES.pubsub,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects service-* wildcards", () => {
    expect(
      evaluateManagedAgentBinding({
        member: "serviceAccount:service-*@gcp-sa-pubsub.iam.gserviceaccount.com",
        role: "roles/iam.serviceAccountTokenCreator",
        kind: "pubsub",
        allowedRoles: MANAGED_AGENT_ROLES.pubsub,
      }),
    ).toEqual({ ok: false, reason: "WILDCARD_OR_NON_EXACT_PRINCIPAL" });
  });

  it("rejects unexpected roles even for an exact principal", () => {
    expect(
      evaluateManagedAgentBinding({
        member: managedAgentPrincipal("pubsub", projectNumber),
        role: "roles/owner",
        kind: "pubsub",
        allowedRoles: MANAGED_AGENT_ROLES.pubsub,
      }),
    ).toEqual({ ok: false, reason: "UNEXPECTED_MANAGED_AGENT_ROLE" });
  });

  it("rejects non-managed principals", () => {
    expect(
      evaluateManagedAgentBinding({
        member: "serviceAccount:resolvia-web@resolvia-project.iam.gserviceaccount.com",
        role: "roles/iam.serviceAccountTokenCreator",
        kind: "pubsub",
        allowedRoles: MANAGED_AGENT_ROLES.pubsub,
      }),
    ).toEqual({ ok: false, reason: "WILDCARD_OR_NON_EXACT_PRINCIPAL" });
  });

  it("accepts exact Cloud Run service agent actAs/getAccessToken on runtime SA", () => {
    expect(
      evaluateCloudRunServiceAgentActAs({
        member: managedAgentPrincipal("cloudRun", projectNumber),
        role: "roles/iam.serviceAccountUser",
        projectNumber,
        targetServiceAccount: runtimeSa,
        expectedRuntimeServiceAccount: runtimeSa,
      }),
    ).toEqual({ ok: true });

    expect(
      evaluateCloudRunServiceAgentActAs({
        member: managedAgentPrincipal("cloudRun", projectNumber),
        role: "roles/iam.serviceAccountTokenCreator",
        projectNumber,
        targetServiceAccount: runtimeSa,
        expectedRuntimeServiceAccount: runtimeSa,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects Cloud Run actAs against unexpected targets or wildcards", () => {
    expect(
      evaluateCloudRunServiceAgentActAs({
        member: managedAgentPrincipal("cloudRun", projectNumber),
        role: "roles/iam.serviceAccountUser",
        projectNumber,
        targetServiceAccount: "other@resolvia-project.iam.gserviceaccount.com",
        expectedRuntimeServiceAccount: runtimeSa,
      }),
    ).toEqual({ ok: false, reason: "UNEXPECTED_ACTAS_TARGET" });

    expect(
      evaluateCloudRunServiceAgentActAs({
        member:
          "serviceAccount:service-*@serverless-robot-prod.iam.gserviceaccount.com",
        role: "roles/iam.serviceAccountUser",
        projectNumber,
        targetServiceAccount: runtimeSa,
        expectedRuntimeServiceAccount: runtimeSa,
      }),
    ).toEqual({ ok: false, reason: "WILDCARD_OR_NON_EXACT_PRINCIPAL" });
  });
});
