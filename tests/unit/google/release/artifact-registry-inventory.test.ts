import { describe, expect, it } from "vitest";

import {
  artifactRegistryResource,
  evaluateBuildAuthorityAssetRetrieval,
  parseArtifactRegistryCsvInventoryProjection,
  parseArtifactRegistryRepositoryInventory,
  BUILD_CUSTOM_ROLE_DEFINITIONS,
  type AssetIamPolicyHit,
  type CustomRoleDefinition,
} from "@/src/infrastructure/google/release/build-authority-policy";

const projectId = "resolvia-project";
const region = "asia-southeast2";
const projectNumber = "714285556387";
const buildMember = `serviceAccount:resolvia-build@${projectId}.iam.gserviceaccount.com`;

const artifactRole = `projects/${projectId}/roles/resolviaBuildArtifactWriter`;
const sourceRole = `projects/${projectId}/roles/resolviaBuildSourceReader`;
const logRole = `projects/${projectId}/roles/resolviaBuildLogWriter`;

const arResource = artifactRegistryResource(projectId, region);
const otherArResource = `//artifactregistry.googleapis.com/projects/${projectId}/locations/${region}/repositories/other`;
const otherRegionAr = `//artifactregistry.googleapis.com/projects/${projectId}/locations/us-central1/repositories/mirror`;
const sourceResource = `//storage.googleapis.com/projects/_/buckets/${projectId}_${region}_cloudbuild`;
const logResource = `//storage.googleapis.com/projects/_/buckets/${projectNumber}-${region}-cloudbuild-logs`;

const approvedCustomRoles: CustomRoleDefinition[] = BUILD_CUSTOM_ROLE_DEFINITIONS.map(
  (role) => ({
    name: `projects/${projectId}/roles/${role.name}`,
    permissions: [...role.permissions],
  }),
);

function hit(
  resource: string,
  role: string,
  member: string = buildMember,
): AssetIamPolicyHit {
  return { resource, bindings: [{ role, members: [member] }] };
}

function approvedExact(): AssetIamPolicyHit[] {
  return [
    hit(arResource, artifactRole),
    hit(sourceResource, sourceRole),
    hit(logResource, logRole),
  ];
}

describe("Artifact Registry structured inventory parser", () => {
  it("1. parses fully-qualified JSON repository name successfully", () => {
    expect(
      parseArtifactRegistryRepositoryInventory({
        projectId,
        repositories: [
          {
            name: "projects/resolvia-project/locations/asia-southeast2/repositories/resolvia",
          },
        ],
      }),
    ).toEqual({
      ok: true,
      repositories: [
        {
          projectId,
          location: region,
          repositoryId: "resolvia",
          canonicalResource: arResource,
        },
      ],
    });
  });

  it("2. CSV-style short name resolvia, fails closed (unsafe projection)", () => {
    expect(
      parseArtifactRegistryCsvInventoryProjection(["resolvia,"], projectId),
    ).toEqual({ ok: false, reason: "IAM_AUTHORITY_UNKNOWN" });
  });

  it("3. discovers both repositories from JSON inventory", () => {
    const parsed = parseArtifactRegistryRepositoryInventory({
      projectId,
      repositories: [
        {
          name: "projects/resolvia-project/locations/asia-southeast2/repositories/resolvia",
        },
        {
          name: "projects/resolvia-project/locations/asia-southeast2/repositories/other",
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.repositories.map((r) => r.canonicalResource).sort()).toEqual(
      [arResource, otherArResource].sort(),
    );
  });

  it("4. canonicalizes a repository in another region", () => {
    expect(
      parseArtifactRegistryRepositoryInventory({
        projectId,
        repositories: [
          {
            name: "projects/resolvia-project/locations/us-central1/repositories/mirror",
          },
        ],
      }),
    ).toEqual({
      ok: true,
      repositories: [
        {
          projectId,
          location: "us-central1",
          repositoryId: "mirror",
          canonicalResource: otherRegionAr,
        },
      ],
    });
  });

  it("5. fails closed on malformed fully-qualified name", () => {
    expect(
      parseArtifactRegistryRepositoryInventory({
        projectId,
        repositories: [
          { name: "projects/resolvia-project/locations/asia-southeast2/repositories/" },
        ],
      }),
    ).toEqual({ ok: false, reason: "IAM_AUTHORITY_UNKNOWN" });

    expect(
      parseArtifactRegistryRepositoryInventory({
        projectId,
        repositories: [{ name: "not-a-resource" }],
      }),
    ).toEqual({ ok: false, reason: "IAM_AUTHORITY_UNKNOWN" });
  });

  it("6. fails closed when embedded project does not match expected project", () => {
    expect(
      parseArtifactRegistryRepositoryInventory({
        projectId,
        repositories: [
          {
            name: "projects/other-project/locations/asia-southeast2/repositories/resolvia",
          },
        ],
      }),
    ).toEqual({ ok: false, reason: "IAM_AUTHORITY_UNKNOWN" });
  });

  it("7. empty inventory is a successful empty list (caller decides completeness)", () => {
    expect(
      parseArtifactRegistryRepositoryInventory({
        projectId,
        repositories: [],
      }),
    ).toEqual({ ok: true, repositories: [] });
  });

  it("8. unexpected extra repository with resolvia-build authority fails C2", () => {
    expect(
      evaluateBuildAuthorityAssetRetrieval({
        projectId,
        region,
        projectNumber,
        projectBindings: [],
        customRoles: approvedCustomRoles,
        userManagedKeys: [],
        exactResourcePolicies: approvedExact(),
        broadInventoryPages: [[hit(otherArResource, artifactRole)]],
      }),
    ).toEqual({ ok: false, reason: "UNEXPECTED_RESOURCE_BINDING" });
  });

  it("9. unexpected principal on additional repository fails C2", () => {
    expect(
      evaluateBuildAuthorityAssetRetrieval({
        projectId,
        region,
        projectNumber,
        projectBindings: [],
        customRoles: approvedCustomRoles,
        userManagedKeys: [],
        exactResourcePolicies: approvedExact(),
        broadInventoryPages: [
          [
            hit(
              otherArResource,
              artifactRole,
              "serviceAccount:714285556387-compute@developer.gserviceaccount.com",
            ),
          ],
        ],
      }),
    ).toEqual({ ok: false, reason: "UNEXPECTED_RESOURCE_BINDING" });
  });

  it("10. canonical resolvia repository identity matches exact expected resource", () => {
    const parsed = parseArtifactRegistryRepositoryInventory({
      projectId,
      repositories: [
        {
          name: "projects/resolvia-project/locations/asia-southeast2/repositories/resolvia",
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.repositories[0]?.canonicalResource).toBe(arResource);
    expect(
      evaluateBuildAuthorityAssetRetrieval({
        projectId,
        region,
        projectNumber,
        projectBindings: [],
        customRoles: approvedCustomRoles,
        userManagedKeys: [],
        exactResourcePolicies: approvedExact(),
        broadInventoryPages: [[]],
      }),
    ).toEqual({ ok: true });
  });
});
