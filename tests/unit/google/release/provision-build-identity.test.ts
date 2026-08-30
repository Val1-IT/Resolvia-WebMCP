import { describe, expect, it } from "vitest";

import {
  BUILD_CUSTOM_ROLE_DEFINITIONS,
  buildIdentityProvisionPlan,
  evaluateBuildAuthorityTopology,
  expectedBuildResourceBindings,
  expectedCustomRoleDefinitions,
} from "@/src/infrastructure/google/release/build-authority-policy";

describe("provision-build-identity ↔ C2 authority consistency", () => {
  const projectId = "resolvia-project";
  const region = "asia-southeast2";
  const projectNumber = "714285556387";

  it("provisioner plan matches C2 expected effective authority exactly", () => {
    const plan = buildIdentityProvisionPlan({ projectId, region, projectNumber });

    expect(plan.serviceAccount).toBe(
      `resolvia-build@${projectId}.iam.gserviceaccount.com`,
    );
    expect(plan.projectRoles).toEqual([]);
    expect(plan.customRoles).toEqual(expectedCustomRoleDefinitions(projectId));
    expect(plan.resourceBindings).toEqual(
      expectedBuildResourceBindings({ projectId, region, projectNumber }),
    );

    const evaluation = evaluateBuildAuthorityTopology({
      projectId,
      region,
      projectNumber,
      projectBindings: [],
      resourceBindings: plan.resourceBindings,
      customRoles: plan.customRoles,
      userManagedKeys: [],
    });
    expect(evaluation).toEqual({ ok: true });
  });

  it("policy custom role IDs match the dedicated C2 role inventory", () => {
    expect(BUILD_CUSTOM_ROLE_DEFINITIONS.map((role) => role.name)).toEqual([
      "resolviaBuildArtifactWriter",
      "resolviaBuildSourceReader",
      "resolviaBuildLogWriter",
    ]);
  });
});
