import { describe, expect, it } from "vitest";

import {
  BUILD_CUSTOM_ROLE_DEFINITIONS,
  evaluateBuildAuthorityAssetRetrieval,
  mergeAssetInventoryPages,
  type AssetIamPolicyHit,
  type BuildAuthorityAssetRetrievalInput,
  type CustomRoleDefinition,
} from "@/src/infrastructure/google/release/build-authority-policy";

const projectId = "resolvia-project";
const region = "asia-southeast2";
const projectNumber = "714285556387";
const buildMember = `serviceAccount:resolvia-build@${projectId}.iam.gserviceaccount.com`;

const artifactRole = `projects/${projectId}/roles/resolviaBuildArtifactWriter`;
const sourceRole = `projects/${projectId}/roles/resolviaBuildSourceReader`;
const logRole = `projects/${projectId}/roles/resolviaBuildLogWriter`;

const arResource = `//artifactregistry.googleapis.com/projects/${projectId}/locations/${region}/repositories/resolvia`;
const otherArResource = `//artifactregistry.googleapis.com/projects/${projectId}/locations/${region}/repositories/other`;
const sourceResource = `//storage.googleapis.com/projects/_/buckets/${projectId}_${region}_cloudbuild`;
const sourceResourceShort = `//storage.googleapis.com/${projectId}_${region}_cloudbuild`;
const logResource = `//storage.googleapis.com/projects/_/buckets/${projectNumber}-${region}-cloudbuild-logs`;
const logResourceShort = `//storage.googleapis.com/${projectNumber}-${region}-cloudbuild-logs`;

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

function approvedExactPolicies(): AssetIamPolicyHit[] {
  return [
    hit(arResource, artifactRole),
    hit(sourceResource, sourceRole),
    hit(logResource, logRole),
  ];
}

function retrieval(
  overrides: Partial<BuildAuthorityAssetRetrievalInput> = {},
): BuildAuthorityAssetRetrievalInput {
  return {
    projectId,
    region,
    projectNumber,
    projectBindings: [],
    customRoles: approvedCustomRoles,
    userManagedKeys: [],
    exactResourcePolicies: approvedExactPolicies(),
    broadInventoryPages: [[]],
    ...overrides,
  };
}

describe("C2 Cloud Asset retrieval (exact positive + exhaustive extras)", () => {
  it("1. passes when required AR binding is absent from broad first page but present in exact resource query", () => {
    expect(
      evaluateBuildAuthorityAssetRetrieval(
        retrieval({
          broadInventoryPages: [
            [hit(sourceResource, sourceRole), hit(logResource, logRole)],
          ],
          exactResourcePolicies: approvedExactPolicies(),
        }),
      ),
    ).toEqual({ ok: true });
  });

  it("2. passes when required binding exists only on a later Asset page in broad inventory (extras path) while exact proof holds", () => {
    expect(
      evaluateBuildAuthorityAssetRetrieval(
        retrieval({
          exactResourcePolicies: approvedExactPolicies(),
          broadInventoryPages: [
            [hit(sourceResourceShort, sourceRole)],
            [hit(logResourceShort, logRole), hit(arResource, artifactRole)],
          ],
        }),
      ),
    ).toEqual({ ok: true });
  });

  it("3. fails when required binding is genuinely absent from exact resource query", () => {
    expect(
      evaluateBuildAuthorityAssetRetrieval(
        retrieval({
          exactResourcePolicies: [
            hit(sourceResource, sourceRole),
            hit(logResource, logRole),
          ],
          broadInventoryPages: [[hit(arResource, artifactRole)]],
        }),
      ),
    ).toEqual({ ok: false, reason: "MISSING_RESOURCE_BINDING" });
  });

  it("4. fails when correct binding exists only on the wrong repository", () => {
    expect(
      evaluateBuildAuthorityAssetRetrieval(
        retrieval({
          exactResourcePolicies: [
            hit(otherArResource, artifactRole),
            hit(sourceResource, sourceRole),
            hit(logResource, logRole),
          ],
        }),
      ),
    ).toEqual({ ok: false, reason: "MISSING_RESOURCE_BINDING" });
  });

  it("5. fails when correct principal has the wrong custom role on the exact AR resource", () => {
    expect(
      evaluateBuildAuthorityAssetRetrieval(
        retrieval({
          exactResourcePolicies: [
            hit(arResource, sourceRole),
            hit(sourceResource, sourceRole),
            hit(logResource, logRole),
          ],
        }),
      ),
    ).toEqual({ ok: false, reason: "MISSING_RESOURCE_BINDING" });
  });

  it("6. fails on custom role permission drift", () => {
    expect(
      evaluateBuildAuthorityAssetRetrieval(
        retrieval({
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

  it("7. passes when source-bucket binding is omitted from broad query but present in exact resource query", () => {
    expect(
      evaluateBuildAuthorityAssetRetrieval(
        retrieval({
          broadInventoryPages: [[hit(arResource, artifactRole), hit(logResource, logRole)]],
          exactResourcePolicies: approvedExactPolicies(),
        }),
      ),
    ).toEqual({ ok: true });
  });

  it("8. passes when log-bucket binding is omitted from broad query but present in exact resource query", () => {
    expect(
      evaluateBuildAuthorityAssetRetrieval(
        retrieval({
          broadInventoryPages: [
            [hit(arResource, artifactRole), hit(sourceResource, sourceRole)],
          ],
          exactResourcePolicies: approvedExactPolicies(),
        }),
      ),
    ).toEqual({ ok: true });
  });

  it("9. fails when unexpected project-level authority appears on a later Asset page", () => {
    const projectResource = `//cloudresourcemanager.googleapis.com/projects/${projectId}`;
    expect(
      evaluateBuildAuthorityAssetRetrieval(
        retrieval({
          exactResourcePolicies: approvedExactPolicies(),
          broadInventoryPages: [
            [],
            [hit(projectResource, artifactRole)],
          ],
        }),
      ),
    ).toEqual({ ok: false, reason: "UNEXPECTED_RESOURCE_BINDING" });
  });

  it("10. fails when unexpected hierarchy authority appears outside the first page", () => {
    const folderResource = "//cloudresourcemanager.googleapis.com/folders/123456789";
    expect(
      evaluateBuildAuthorityAssetRetrieval(
        retrieval({
          exactResourcePolicies: approvedExactPolicies(),
          broadInventoryPages: [
            [hit(sourceResourceShort, sourceRole)],
            [hit(folderResource, logRole)],
          ],
        }),
      ),
    ).toEqual({ ok: false, reason: "UNEXPECTED_RESOURCE_BINDING" });
  });

  it("11. fails on extra repository/bucket authority discovered via broad pages", () => {
    expect(
      evaluateBuildAuthorityAssetRetrieval(
        retrieval({
          exactResourcePolicies: approvedExactPolicies(),
          broadInventoryPages: [[hit(otherArResource, artifactRole)]],
        }),
      ),
    ).toEqual({ ok: false, reason: "UNEXPECTED_RESOURCE_BINDING" });
  });

  it("12. fails closed on malformed/unreadable/incomplete Asset responses", () => {
    expect(
      evaluateBuildAuthorityAssetRetrieval(
        retrieval({
          exactResourcePolicies: [
            { resource: arResource, bindings: null as unknown as [] },
            hit(sourceResource, sourceRole),
            hit(logResource, logRole),
          ],
        }),
      ),
    ).toEqual({ ok: false, reason: "IAM_AUTHORITY_UNKNOWN" });

    expect(() => mergeAssetInventoryPages(null as unknown as [])).toThrow(
      /IAM_AUTHORITY_UNKNOWN/,
    );
    expect(() =>
      mergeAssetInventoryPages([[{ resource: "", bindings: [] }]]),
    ).toThrow(/IAM_AUTHORITY_UNKNOWN/);

    expect(
      evaluateBuildAuthorityAssetRetrieval(
        retrieval({
          exactResourcePolicies: [
            {
              resource: arResource,
              bindings: [
                {
                  role: artifactRole,
                  members: [buildMember],
                  condition: { title: "x" },
                },
              ],
            },
            hit(sourceResource, sourceRole),
            hit(logResource, logRole),
          ],
        }),
      ),
    ).toEqual({ ok: false, reason: "IAM_AUTHORITY_UNKNOWN" });
  });
});
