export const BUILD_SERVICE_ACCOUNT_NAME = "resolvia-build" as const;
export const BUILD_ARTIFACT_REPOSITORY = "resolvia" as const;

export const BUILD_CUSTOM_ROLE_DEFINITIONS = [
  {
    name: "resolviaBuildArtifactWriter",
    permissions: [
      "artifactregistry.repositories.uploadArtifacts",
      "artifactregistry.repositories.downloadArtifacts",
    ],
  },
  {
    name: "resolviaBuildSourceReader",
    permissions: ["storage.objects.get"],
  },
  {
    name: "resolviaBuildLogWriter",
    permissions: ["storage.objects.create"],
  },
] as const;

export const FORBIDDEN_PROJECT_BUILD_ROLES = [
  "roles/cloudbuild.builds.builder",
  "roles/artifactregistry.writer",
  "roles/logging.logWriter",
  "roles/storage.objectViewer",
] as const;

export type BuildCustomRoleName =
  (typeof BUILD_CUSTOM_ROLE_DEFINITIONS)[number]["name"];

export type ProjectIamBinding = {
  member: string;
  role: string;
};

export type ResourceIamBinding = {
  member: string;
  role: string;
  resource: string;
};

export type CustomRoleDefinition = {
  name: string;
  permissions: readonly string[];
};

export type BuildAuthorityTopologyInput = {
  projectId: string;
  region: string;
  projectNumber: string;
  projectBindings: readonly ProjectIamBinding[];
  resourceBindings: readonly ResourceIamBinding[];
  customRoles: readonly CustomRoleDefinition[];
  userManagedKeys: readonly string[];
};

export type BuildAuthorityTopologyEvaluation =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "FORBIDDEN_PROJECT_BUILD_ROLE"
        | "UNEXPECTED_PROJECT_BINDING"
        | "MISSING_RESOURCE_BINDING"
        | "UNEXPECTED_RESOURCE_BINDING"
        | "CUSTOM_ROLE_PERMISSIONS_DRIFT"
        | "USER_MANAGED_KEYS_PRESENT";
    };

/** @deprecated Project-wide ExactRoles model — kept only for fail-closed rejection. */
export const BUILD_AUTHORITY_ROLES = FORBIDDEN_PROJECT_BUILD_ROLES;

export type BuildAuthorityBinding = ResourceIamBinding;

export type BuildAuthorityEvaluation =
  | { ok: true }
  | { ok: false; reason: "UNKNOWN_OR_UNAUTHORIZED_IAM" };

export function resolviaBuildServiceAccount(projectId: string): string {
  return `${BUILD_SERVICE_ACCOUNT_NAME}@${projectId}.iam.gserviceaccount.com`;
}

export function resolviaBuildMember(projectId: string): string {
  return `serviceAccount:${resolviaBuildServiceAccount(projectId)}`;
}

export function customBuildRoleName(
  projectId: string,
  roleId: BuildCustomRoleName,
): string {
  return `projects/${projectId}/roles/${roleId}`;
}

export function artifactRegistryResource(
  projectId: string,
  region: string,
): string {
  return `//artifactregistry.googleapis.com/projects/${projectId}/locations/${region}/repositories/${BUILD_ARTIFACT_REPOSITORY}`;
}

export function sourceBucketResource(projectId: string, region: string): string {
  return `//storage.googleapis.com/projects/_/buckets/${projectId}_${region}_cloudbuild`;
}

export function logBucketResource(
  projectNumber: string,
  region: string,
): string {
  return `//storage.googleapis.com/projects/_/buckets/${projectNumber}-${region}-cloudbuild-logs`;
}

export function expectedBuildResourceBindings(input: {
  projectId: string;
  region: string;
  projectNumber: string;
}): ResourceIamBinding[] {
  const member = resolviaBuildMember(input.projectId);
  return [
    {
      member,
      role: customBuildRoleName(input.projectId, "resolviaBuildArtifactWriter"),
      resource: artifactRegistryResource(input.projectId, input.region),
    },
    {
      member,
      role: customBuildRoleName(input.projectId, "resolviaBuildSourceReader"),
      resource: sourceBucketResource(input.projectId, input.region),
    },
    {
      member,
      role: customBuildRoleName(input.projectId, "resolviaBuildLogWriter"),
      resource: logBucketResource(input.projectNumber, input.region),
    },
  ];
}

export function expectedCustomRoleDefinitions(
  projectId: string,
): CustomRoleDefinition[] {
  return BUILD_CUSTOM_ROLE_DEFINITIONS.map((role) => ({
    name: customBuildRoleName(projectId, role.name),
    permissions: [...role.permissions],
  }));
}

/** Exact provisioner plan — must match C2 expected effective authority. */
export function buildIdentityProvisionPlan(input: {
  projectId: string;
  region: string;
  projectNumber: string;
}): {
  serviceAccount: string;
  projectRoles: readonly string[];
  customRoles: CustomRoleDefinition[];
  resourceBindings: ResourceIamBinding[];
} {
  return {
    serviceAccount: resolviaBuildServiceAccount(input.projectId),
    projectRoles: [],
    customRoles: expectedCustomRoleDefinitions(input.projectId),
    resourceBindings: expectedBuildResourceBindings(input),
  };
}

function canonicalizeResource(resource: string): string {
  if (
    resource === "//storage.googleapis.com" ||
    !resource.startsWith("//storage.googleapis.com/")
  ) {
    return resource;
  }
  const longForm = resource.match(
    /^\/\/storage\.googleapis\.com\/projects\/_\/buckets\/([^/]+)$/,
  );
  if (longForm) {
    return `//storage.googleapis.com/projects/_/buckets/${longForm[1]}`;
  }
  const shortForm = resource.match(/^\/\/storage\.googleapis\.com\/([^/]+)$/);
  if (shortForm && shortForm[1] !== "projects") {
    return `//storage.googleapis.com/projects/_/buckets/${shortForm[1]}`;
  }
  return resource;
}

function bindingKey(binding: ResourceIamBinding): string {
  return `${binding.member}|${canonicalizeResource(binding.resource)}|${binding.role}`;
}

function samePermissionSet(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  const left = [...actual].map((p) => p.trim()).filter(Boolean).sort();
  const right = [...expected].map((p) => p.trim()).filter(Boolean).sort();
  if (left.length !== right.length) return false;
  return left.every((permission, index) => permission === right[index]);
}

/**
 * Exact positive authority for resolvia-build: resource-scoped custom roles only.
 * Project-wide builder / AR writer / logging writer / storage viewer are rejected.
 */
export function evaluateBuildAuthorityTopology(
  input: BuildAuthorityTopologyInput,
): BuildAuthorityTopologyEvaluation {
  if (input.userManagedKeys.length > 0) {
    return { ok: false, reason: "USER_MANAGED_KEYS_PRESENT" };
  }

  const expectedRoles = expectedCustomRoleDefinitions(input.projectId);
  for (const expected of expectedRoles) {
    const actual = input.customRoles.find((role) => role.name === expected.name);
    if (!actual || !samePermissionSet(actual.permissions, expected.permissions)) {
      return { ok: false, reason: "CUSTOM_ROLE_PERMISSIONS_DRIFT" };
    }
  }

  const buildMember = resolviaBuildMember(input.projectId);
  for (const binding of input.projectBindings) {
    if (binding.member !== buildMember) continue;
    if (
      (FORBIDDEN_PROJECT_BUILD_ROLES as readonly string[]).includes(binding.role)
    ) {
      return { ok: false, reason: "FORBIDDEN_PROJECT_BUILD_ROLE" };
    }
    return { ok: false, reason: "UNEXPECTED_PROJECT_BINDING" };
  }

  const expected = expectedBuildResourceBindings(input);
  const expectedKeys = new Set(expected.map(bindingKey));
  const actualKeys = new Set(input.resourceBindings.map(bindingKey));

  for (const key of expectedKeys) {
    if (!actualKeys.has(key)) {
      return { ok: false, reason: "MISSING_RESOURCE_BINDING" };
    }
  }

  const approvedCustomRoles = new Set(expected.map((binding) => binding.role));
  const approvedResources = new Set(
    expected.map((binding) => canonicalizeResource(binding.resource)),
  );

  for (const binding of input.resourceBindings) {
    const key = bindingKey(binding);
    if (expectedKeys.has(key)) continue;

    const resource = canonicalizeResource(binding.resource);
    const touchesApprovedResource = approvedResources.has(resource);
    const usesApprovedCustomRole = approvedCustomRoles.has(binding.role);
    const isProjectWideArtifactWriter =
      binding.role === "roles/artifactregistry.writer" && touchesApprovedResource;
    const isHierarchyOrExtraBuildAuthority =
      binding.member === buildMember ||
      usesApprovedCustomRole ||
      isProjectWideArtifactWriter;

    if (isHierarchyOrExtraBuildAuthority) {
      return { ok: false, reason: "UNEXPECTED_RESOURCE_BINDING" };
    }
  }

  return { ok: true };
}

/**
 * Legacy single-binding helper. Project-scoped ExactRoles are never exact authority.
 */
export function isExactBuildAuthorityBinding(
  binding: BuildAuthorityBinding,
  projectId: string,
): boolean {
  const expected = expectedBuildResourceBindings({
    projectId,
    region: "asia-southeast2",
    projectNumber: "0",
  });
  // Region/projectNumber unknown here — reject project-scoped and unknown shapes.
  if (binding.resource === `projects/${projectId}`) return false;
  if (binding.member !== resolviaBuildMember(projectId)) return false;
  return expected.some(
    (candidate) =>
      candidate.member === binding.member &&
      candidate.role === binding.role &&
      canonicalizeResource(candidate.resource) ===
        canonicalizeResource(binding.resource),
  );
}

export function evaluateBuildAuthorityBinding(
  binding: BuildAuthorityBinding,
  projectId: string,
): BuildAuthorityEvaluation {
  if (!isExactBuildAuthorityBinding(binding, projectId)) {
    return { ok: false, reason: "UNKNOWN_OR_UNAUTHORIZED_IAM" };
  }
  return { ok: true };
}

export type AssetIamPolicyHit = {
  resource: string;
  bindings: readonly {
    role: string;
    members: readonly string[];
    condition?: unknown;
  }[];
};

export type BuildAuthorityAssetRetrievalInput = {
  projectId: string;
  region: string;
  projectNumber: string;
  projectBindings: readonly ProjectIamBinding[];
  customRoles: readonly CustomRoleDefinition[];
  userManagedKeys: readonly string[];
  /**
   * Exact resource-scoped Cloud Asset hits for required resources.
   * Positive authority is proved only from these hits — never from a broad
   * ranked search alone.
   */
  exactResourcePolicies: readonly AssetIamPolicyHit[];
  /**
   * Fully paginated broad inventory pages. Used only to discover extra /
   * unexpected authority; omission of a required binding here must not alone
   * cause MISSING_RESOURCE_BINDING.
   */
  broadInventoryPages: readonly (readonly AssetIamPolicyHit[])[];
};

export type BuildAuthorityAssetRetrievalEvaluation =
  | BuildAuthorityTopologyEvaluation
  | { ok: false; reason: "IAM_AUTHORITY_UNKNOWN" };

function flattenAssetHits(
  hits: readonly AssetIamPolicyHit[],
): ResourceIamBinding[] {
  const bindings: ResourceIamBinding[] = [];
  for (const hit of hits) {
    if (!hit.resource || !Array.isArray(hit.bindings)) {
      throw new Error("IAM_AUTHORITY_UNKNOWN");
    }
    for (const binding of hit.bindings) {
      if (binding.condition != null) {
        throw new Error("IAM_AUTHORITY_UNKNOWN");
      }
      if (!binding.role) continue;
      for (const member of binding.members ?? []) {
        if (!member) continue;
        bindings.push({
          member,
          role: binding.role,
          resource: hit.resource,
        });
      }
    }
  }
  return bindings;
}

/** Merge paginated broad Asset pages into one hit list (fail closed on holes). */
export function mergeAssetInventoryPages(
  pages: readonly (readonly AssetIamPolicyHit[])[],
): AssetIamPolicyHit[] {
  if (!Array.isArray(pages)) {
    throw new Error("IAM_AUTHORITY_UNKNOWN");
  }
  const merged: AssetIamPolicyHit[] = [];
  for (const page of pages) {
    if (!Array.isArray(page)) {
      throw new Error("IAM_AUTHORITY_UNKNOWN");
    }
    for (const hit of page) {
      if (
        !hit ||
        typeof hit.resource !== "string" ||
        hit.resource.trim().length === 0 ||
        !Array.isArray(hit.bindings)
      ) {
        throw new Error("IAM_AUTHORITY_UNKNOWN");
      }
      merged.push(hit);
    }
  }
  return merged;
}

/**
 * Prove exact required resource policies are present in the exact-scoped Asset
 * results, then evaluate topology against exact hits union fully-paginated
 * broad inventory (extras only).
 */
export function evaluateBuildAuthorityAssetRetrieval(
  input: BuildAuthorityAssetRetrievalInput,
): BuildAuthorityAssetRetrievalEvaluation {
  try {
    const expectedResources = expectedBuildResourceBindings(input).map((binding) =>
      canonicalizeResource(binding.resource),
    );

    const exactByResource = new Map<string, AssetIamPolicyHit>();
    for (const hit of input.exactResourcePolicies) {
      if (!hit?.resource || !Array.isArray(hit.bindings)) {
        return { ok: false, reason: "IAM_AUTHORITY_UNKNOWN" };
      }
      for (const binding of hit.bindings) {
        if (binding.condition != null) {
          return { ok: false, reason: "IAM_AUTHORITY_UNKNOWN" };
        }
      }
      exactByResource.set(canonicalizeResource(hit.resource), hit);
    }

    for (const resource of expectedResources) {
      if (!exactByResource.has(resource)) {
        return { ok: false, reason: "MISSING_RESOURCE_BINDING" };
      }
    }

    const broadHits = mergeAssetInventoryPages(input.broadInventoryPages);
    const resourceBindings = [
      ...flattenAssetHits([...exactByResource.values()]),
      ...flattenAssetHits(broadHits),
    ];

    return evaluateBuildAuthorityTopology({
      projectId: input.projectId,
      region: input.region,
      projectNumber: input.projectNumber,
      projectBindings: input.projectBindings,
      customRoles: input.customRoles,
      userManagedKeys: input.userManagedKeys,
      resourceBindings,
    });
  } catch {
    return { ok: false, reason: "IAM_AUTHORITY_UNKNOWN" };
  }
}

export type ArtifactRegistryRepositoryInventoryEntry = {
  projectId: string;
  location: string;
  repositoryId: string;
  canonicalResource: string;
};

export type ArtifactRegistryInventoryParseResult =
  | { ok: true; repositories: ArtifactRegistryRepositoryInventoryEntry[] }
  | { ok: false; reason: "IAM_AUTHORITY_UNKNOWN" };

const AR_RESOURCE_NAME =
  /^projects\/([^/]+)\/locations\/([^/]+)\/repositories\/([^/]+)$/;

/**
 * Parse Artifact Registry `repositories list --format=json` rows.
 * Uses fully-qualified `name` only — never CSV short IDs or region fallbacks.
 */
export function parseArtifactRegistryRepositoryInventory(input: {
  projectId: string;
  repositories: readonly { name?: unknown }[];
}): ArtifactRegistryInventoryParseResult {
  if (!Array.isArray(input.repositories)) {
    return { ok: false, reason: "IAM_AUTHORITY_UNKNOWN" };
  }

  const repositories: ArtifactRegistryRepositoryInventoryEntry[] = [];
  const seen = new Set<string>();

  for (const row of input.repositories) {
    if (!row || typeof row.name !== "string" || row.name.trim().length === 0) {
      return { ok: false, reason: "IAM_AUTHORITY_UNKNOWN" };
    }
    const match = row.name.match(AR_RESOURCE_NAME);
    if (!match) {
      return { ok: false, reason: "IAM_AUTHORITY_UNKNOWN" };
    }
    const [, projectId, location, repositoryId] = match;
    if (projectId !== input.projectId) {
      return { ok: false, reason: "IAM_AUTHORITY_UNKNOWN" };
    }
    if (!/^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/.test(location)) {
      return { ok: false, reason: "IAM_AUTHORITY_UNKNOWN" };
    }
    if (!/^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/.test(repositoryId)) {
      return { ok: false, reason: "IAM_AUTHORITY_UNKNOWN" };
    }
    const canonicalResource = `//artifactregistry.googleapis.com/projects/${projectId}/locations/${location}/repositories/${repositoryId}`;
    if (seen.has(canonicalResource)) {
      return { ok: false, reason: "IAM_AUTHORITY_UNKNOWN" };
    }
    seen.add(canonicalResource);
    repositories.push({
      projectId,
      location,
      repositoryId,
      canonicalResource,
    });
  }

  return { ok: true, repositories };
}

/**
 * Reproduce the unsafe CSV projection historically used by C2.
 * Short repository IDs with empty location must never be accepted.
 */
export function parseArtifactRegistryCsvInventoryProjection(
  rows: readonly string[],
  projectId: string,
): ArtifactRegistryInventoryParseResult {
  const repositories: { name?: unknown }[] = [];
  for (const row of rows) {
    const trimmed = row.trim();
    if (!trimmed) continue;
    // Progress lines / short IDs like "resolvia," are not fully-qualified names.
    const parts = trimmed.split(",", 2);
    const name = parts[0]?.trim() ?? "";
    if (!AR_RESOURCE_NAME.test(name)) {
      return { ok: false, reason: "IAM_AUTHORITY_UNKNOWN" };
    }
    repositories.push({ name });
  }
  return parseArtifactRegistryRepositoryInventory({ projectId, repositories });
}
