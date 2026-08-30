const SHORT_BUCKET =
  /^\/\/storage\.googleapis\.com\/([a-z0-9][a-z0-9._-]{1,61}[a-z0-9])$/u;
const PROJECTS_BUCKET =
  /^\/\/storage\.googleapis\.com\/projects\/_\/buckets\/([a-z0-9][a-z0-9._-]{1,61}[a-z0-9])$/u;

/**
 * Canonical GCS asset resource name.
 * Only these two wire forms are accepted and considered equivalent:
 *   //storage.googleapis.com/projects/_/buckets/<bucket>
 *   //storage.googleapis.com/<bucket>
 * All other paths fail closed.
 */
export function canonicalizeGcsAssetResource(value: string): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const projects = value.match(PROJECTS_BUCKET);
  if (projects?.[1]) {
    return `//storage.googleapis.com/projects/_/buckets/${projects[1]}`;
  }
  const short = value.match(SHORT_BUCKET);
  if (short?.[1]) {
    return `//storage.googleapis.com/projects/_/buckets/${short[1]}`;
  }
  return null;
}

export function gcsAssetResourcesEquivalent(
  left: string,
  right: string,
): boolean {
  const canonicalLeft = canonicalizeGcsAssetResource(left);
  const canonicalRight = canonicalizeGcsAssetResource(right);
  return (
    canonicalLeft !== null &&
    canonicalRight !== null &&
    canonicalLeft === canonicalRight
  );
}
