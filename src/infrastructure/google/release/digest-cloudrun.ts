export const DIGEST_CLOUD_RUN_SERVICES = [
  "provider-ingress",
  "partner-portal",
] as const;

export type DigestCloudRunService = (typeof DIGEST_CLOUD_RUN_SERVICES)[number];

export type DigestCloudRunServiceManifest = {
  service: DigestCloudRunService;
  image: string;
  allowUnauthenticated: boolean;
  ingress: "internal-and-cloud-load-balancing";
};

export type DigestCloudRunManifest = {
  services: readonly DigestCloudRunServiceManifest[];
};

export type DigestCloudRunEvaluation =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "DIGEST_REQUIRED_NO_TAG"
        | "PRIVATE_ONLY_REQUIRED"
        | "UNKNOWN_DIGEST_SERVICE";
    };

const DIGEST_IMAGE =
  /^[a-z0-9-]+-docker\.pkg\.dev\/[^/@]+\/[^/@]+\/[^/@]+@sha256:[a-f0-9]{64}$/u;

/**
 * Exact-digest first creation path for provider-ingress and partner-portal.
 * No tags; private only; audited manifest.
 */
export function buildDigestCloudRunCreateArgs(input: {
  service: DigestCloudRunService;
  imageDigest: string;
  region: string;
  projectId: string;
  serviceAccount: string;
}): string[] {
  if (!DIGEST_IMAGE.test(input.imageDigest)) {
    throw new Error("DIGEST_REQUIRED_NO_TAG");
  }
  return [
    "run",
    "deploy",
    input.service,
    `--image=${input.imageDigest}`,
    `--region=${input.region}`,
    `--project=${input.projectId}`,
    `--service-account=${input.serviceAccount}`,
    "--no-allow-unauthenticated",
    "--ingress=internal-and-cloud-load-balancing",
  ];
}

export function evaluateDigestCloudRunManifest(
  manifest: DigestCloudRunManifest,
): DigestCloudRunEvaluation {
  for (const service of manifest.services) {
    if (
      !(DIGEST_CLOUD_RUN_SERVICES as readonly string[]).includes(service.service)
    ) {
      return { ok: false, reason: "UNKNOWN_DIGEST_SERVICE" };
    }
    if (!DIGEST_IMAGE.test(service.image)) {
      return { ok: false, reason: "DIGEST_REQUIRED_NO_TAG" };
    }
    if (
      service.allowUnauthenticated ||
      service.ingress !== "internal-and-cloud-load-balancing"
    ) {
      return { ok: false, reason: "PRIVATE_ONLY_REQUIRED" };
    }
  }
  return { ok: true };
}
