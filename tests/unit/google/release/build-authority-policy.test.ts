import { describe, expect, it } from "vitest";

import {
  BUILD_CUSTOM_ROLE_DEFINITIONS,
  FORBIDDEN_PROJECT_BUILD_ROLES,
  evaluateBuildAuthorityTopology,
  type BuildAuthorityTopologyInput,
  type CustomRoleDefinition,
  type ProjectIamBinding,
  type ResourceIamBinding,
} from "@/src/infrastructure/google/release/build-authority-policy";

const projectId = "resolvia-project";
const region = "asia-southeast2";
const projectNumber = "714285556387";
const buildMember = `serviceAccount:resolvia-build@${projectId}.iam.gserviceaccount.com`;
const computeMember =
  "serviceAccount:714285556387-compute@developer.gserviceaccount.com";

const artifactRole = `projects/${projectId}/roles/resolviaBuildArtifactWriter`;
const sourceRole = `projects/${projectId}/roles/resolviaBuildSourceReader`;
const logRole = `projects/${projectId}/roles/resolviaBuildLogWriter`;

const arResource = `//artifactregistry.googleapis.com/projects/${projectId}/locations/${region}/repositories/resolvia`;
const otherArResource = `//artifactregistry.googleapis.com/projects/${projectId}/locations/${region}/repositories/other`;
const sourceResource = `//storage.googleapis.com/projects/_/buckets/${projectId}_${region}_cloudbuild`;
const logResource = `//storage.googleapis.com/projects/_/buckets/${projectNumber}-${region}-cloudbuild-logs`;

const approvedCustomRoles: CustomRoleDefinition[] = BUILD_CUSTOM_ROLE_DEFINITIONS.map(
  (role) => ({
    name: `projects/${projectId}/roles/${role.name}`,
    permissions: [...role.permissions],
  }),
);

function approvedResourceBindings(): ResourceIamBinding[] {
  return [
    { member: buildMember, role: artifactRole, resource: arResource },
    { member: buildMember, role: sourceRole, resource: sourceResource },
    { member: buildMember, role: logRole, resource: logResource },
  ];
}

function topology(
  overrides: Partial<BuildAuthorityTopologyInput> = {},
): BuildAuthorityTopologyInput {
  return {
    projectId,
    region,
    projectNumber,
    projectBindings: [],
    resourceBindings: approvedResourceBindings(),
    customRoles: approvedCustomRoles,
    userManagedKeys: [],
    ...overrides,
  };
}

describe("build-authority-policy resource-scoped C2", () => {
  it("exposes dedicated custom role definitions and forbids project-wide build roles", () => {
    expect(BUILD_CUSTOM_ROLE_DEFINITIONS.map((role) => role.name).sort()).toEqual([
      "resolviaBuildArtifactWriter",
      "resolviaBuildLogWriter",
      "resolviaBuildSourceReader",
    ]);
    expect([...FORBIDDEN_PROJECT_BUILD_ROLES].sort()).toEqual([
      "roles/artifactregistry.writer",
      "roles/cloudbuild.builds.builder",
      "roles/logging.logWriter",
      "roles/storage.objectViewer",
    ]);
  });

  it("1. passes live approved topology: no project roles + exact AR/source/log custom bindings", () => {
    expect(evaluateBuildAuthorityTopology(topology())).toEqual({ ok: true });
  });

  it.each([
    ["roles/cloudbuild.builds.builder", "FORBIDDEN_PROJECT_BUILD_ROLE"],
    ["roles/artifactregistry.writer", "FORBIDDEN_PROJECT_BUILD_ROLE"],
    ["roles/storage.objectViewer", "FORBIDDEN_PROJECT_BUILD_ROLE"],
    ["roles/logging.logWriter", "FORBIDDEN_PROJECT_BUILD_ROLE"],
  ] as const)(
    "2-5. fails when resolvia-build has project role %s",
    (role, reason) => {
      const projectBindings: ProjectIamBinding[] = [{ member: buildMember, role }];
      expect(evaluateBuildAuthorityTopology(topology({ projectBindings }))).toEqual({
        ok: false,
        reason,
      });
    },
  );

  it("6. fails when exact AR custom role binding is missing", () => {
    expect(
      evaluateBuildAuthorityTopology(
        topology({
          resourceBindings: approvedResourceBindings().filter(
            (binding) => binding.role !== artifactRole,
          ),
        }),
      ),
    ).toEqual({ ok: false, reason: "MISSING_RESOURCE_BINDING" });
  });

  it("7. fails when correct custom role is bound on the wrong repository", () => {
    expect(
      evaluateBuildAuthorityTopology(
        topology({
          resourceBindings: [
            { member: buildMember, role: artifactRole, resource: otherArResource },
            { member: buildMember, role: sourceRole, resource: sourceResource },
            { member: buildMember, role: logRole, resource: logResource },
          ],
        }),
      ),
    ).toEqual({ ok: false, reason: "MISSING_RESOURCE_BINDING" });
  });

  it("8. fails when source or log binding is missing", () => {
    expect(
      evaluateBuildAuthorityTopology(
        topology({
          resourceBindings: approvedResourceBindings().filter(
            (binding) => binding.role !== sourceRole,
          ),
        }),
      ),
    ).toEqual({ ok: false, reason: "MISSING_RESOURCE_BINDING" });

    expect(
      evaluateBuildAuthorityTopology(
        topology({
          resourceBindings: approvedResourceBindings().filter(
            (binding) => binding.role !== logRole,
          ),
        }),
      ),
    ).toEqual({ ok: false, reason: "MISSING_RESOURCE_BINDING" });
  });

  it("9. fails on extra inherited/hierarchy or unexpected AR writer authority", () => {
    expect(
      evaluateBuildAuthorityTopology(
        topology({
          resourceBindings: [
            ...approvedResourceBindings(),
            {
              member: buildMember,
              role: artifactRole,
              resource: `//cloudresourcemanager.googleapis.com/projects/${projectId}`,
            },
          ],
        }),
      ),
    ).toEqual({ ok: false, reason: "UNEXPECTED_RESOURCE_BINDING" });

    expect(
      evaluateBuildAuthorityTopology(
        topology({
          resourceBindings: [
            ...approvedResourceBindings(),
            {
              member: computeMember,
              role: "roles/artifactregistry.writer",
              resource: arResource,
            },
          ],
        }),
      ),
    ).toEqual({ ok: false, reason: "UNEXPECTED_RESOURCE_BINDING" });
  });

  it("10. fails when custom role includedPermissions drift", () => {
    expect(
      evaluateBuildAuthorityTopology(
        topology({
          customRoles: approvedCustomRoles.map((role) =>
            role.name.endsWith("resolviaBuildArtifactWriter")
              ? {
                  ...role,
                  permissions: [
                    ...role.permissions,
                    "artifactregistry.repositories.delete",
                  ],
                }
              : role,
          ),
        }),
      ),
    ).toEqual({ ok: false, reason: "CUSTOM_ROLE_PERMISSIONS_DRIFT" });
  });

  it("fails closed on user-managed keys and wrong principal on approved resources", () => {
    expect(
      evaluateBuildAuthorityTopology(
        topology({ userManagedKeys: ["projects/.../keys/abc"] }),
      ),
    ).toEqual({ ok: false, reason: "USER_MANAGED_KEYS_PRESENT" });

    expect(
      evaluateBuildAuthorityTopology(
        topology({
          resourceBindings: [
            ...approvedResourceBindings(),
            {
              member: `serviceAccount:resolvia-web@${projectId}.iam.gserviceaccount.com`,
              role: artifactRole,
              resource: arResource,
            },
          ],
        }),
      ),
    ).toEqual({ ok: false, reason: "UNEXPECTED_RESOURCE_BINDING" });
  });
});
