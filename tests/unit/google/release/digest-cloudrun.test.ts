import { describe, expect, it } from "vitest";

import {
  buildDigestCloudRunCreateArgs,
  DIGEST_CLOUD_RUN_SERVICES,
  evaluateDigestCloudRunManifest,
  type DigestCloudRunManifest,
} from "@/src/infrastructure/google/release/digest-cloudrun";

const digest =
  "asia-southeast2-docker.pkg.dev/resolvia-project/resolvia/provider-ingress@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const partnerDigest =
  "asia-southeast2-docker.pkg.dev/resolvia-project/resolvia/partner-portal@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("digest-cloudrun", () => {
  it("lists exact first-creation services", () => {
    expect([...DIGEST_CLOUD_RUN_SERVICES]).toEqual([
      "provider-ingress",
      "partner-portal",
    ]);
  });

  it("builds private exact-digest create args without tags", () => {
    expect(
      buildDigestCloudRunCreateArgs({
        service: "provider-ingress",
        imageDigest: digest,
        region: "asia-southeast2",
        projectId: "resolvia-project",
        serviceAccount: "resolvia-web@resolvia-project.iam.gserviceaccount.com",
      }),
    ).toEqual([
      "run",
      "deploy",
      "provider-ingress",
      `--image=${digest}`,
      "--region=asia-southeast2",
      "--project=resolvia-project",
      "--service-account=resolvia-web@resolvia-project.iam.gserviceaccount.com",
      "--no-allow-unauthenticated",
      "--ingress=internal-and-cloud-load-balancing",
    ]);
  });

  it("accepts an audited exact-digest private-only manifest", () => {
    const manifest: DigestCloudRunManifest = {
      services: [
        {
          service: "provider-ingress",
          image: digest,
          allowUnauthenticated: false,
          ingress: "internal-and-cloud-load-balancing",
        },
        {
          service: "partner-portal",
          image: partnerDigest,
          allowUnauthenticated: false,
          ingress: "internal-and-cloud-load-balancing",
        },
      ],
    };
    expect(evaluateDigestCloudRunManifest(manifest)).toEqual({ ok: true });
  });

  it.each([
    {
      name: "tag image",
      manifest: {
        services: [
          {
            service: "provider-ingress" as const,
            image:
              "asia-southeast2-docker.pkg.dev/resolvia-project/resolvia/provider-ingress:latest",
            allowUnauthenticated: false,
            ingress: "internal-and-cloud-load-balancing" as const,
          },
        ],
      },
      reason: "DIGEST_REQUIRED_NO_TAG",
    },
    {
      name: "public auth",
      manifest: {
        services: [
          {
            service: "provider-ingress" as const,
            image: digest,
            allowUnauthenticated: true,
            ingress: "internal-and-cloud-load-balancing" as const,
          },
        ],
      },
      reason: "PRIVATE_ONLY_REQUIRED",
    },
    {
      name: "unknown service",
      manifest: {
        services: [
          {
            service: "resolvia-web" as unknown as "provider-ingress",
            image: digest,
            allowUnauthenticated: false,
            ingress: "internal-and-cloud-load-balancing" as const,
          },
        ],
      },
      reason: "UNKNOWN_DIGEST_SERVICE",
    },
  ])("fails closed for $name", ({ manifest, reason }) => {
    expect(evaluateDigestCloudRunManifest(manifest)).toEqual({
      ok: false,
      reason,
    });
  });
});
