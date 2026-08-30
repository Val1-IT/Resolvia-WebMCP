import { describe, expect, it } from "vitest";

import {
  evaluateReleaseDigestProof,
  type CloudRunReleaseObservation,
} from "@/src/infrastructure/google/release/m3-release-proof";

const digest =
  "asia-southeast2-docker.pkg.dev/resolvia-project/resolvia/resolvia@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const revision = "resolvia-provider-ingress-00001-abc";

function observation(
  overrides: Partial<CloudRunReleaseObservation> = {},
): CloudRunReleaseObservation {
  return {
    service: "provider-ingress",
    ready: true,
    image: digest,
    expectedDigest: digest,
    expectedRevision: revision,
    traffic: [{ revision, percent: 100 }],
    expectedEnv: { RUNTIME_MODE: "CONNECTED", LOG_LEVEL: "info" },
    observedEnv: { RUNTIME_MODE: "CONNECTED", LOG_LEVEL: "info" },
    expectedSecrets: {
      PUBSUB_HMAC_KEY: "projects/resolvia-project/secrets/pubsub-hmac/versions/3",
    },
    observedSecrets: {
      PUBSUB_HMAC_KEY: "projects/resolvia-project/secrets/pubsub-hmac/versions/3",
    },
    ...overrides,
  };
}

describe("m3-release-proof", () => {
  it("accepts Ready=True, exact digest, exact revision, exclusive traffic, and mappings", () => {
    expect(evaluateReleaseDigestProof(observation())).toEqual({ ok: true });
  });

  it("rejects Ready other than True", () => {
    expect(evaluateReleaseDigestProof(observation({ ready: false }))).toEqual({
      ok: false,
      reason: "READY_NOT_TRUE",
    });
  });

  it("rejects image tag or digest mismatch", () => {
    expect(
      evaluateReleaseDigestProof(
        observation({
          image:
            "asia-southeast2-docker.pkg.dev/resolvia-project/resolvia/resolvia:latest",
        }),
      ),
    ).toEqual({ ok: false, reason: "DIGEST_MISMATCH_OR_TAG" });

    expect(
      evaluateReleaseDigestProof(
        observation({
          image: digest.replace("01234567", "ffffffff"),
        }),
      ),
    ).toEqual({ ok: false, reason: "DIGEST_MISMATCH_OR_TAG" });
  });

  it("rejects non-exclusive traffic splits", () => {
    expect(
      evaluateReleaseDigestProof(
        observation({
          traffic: [
            { revision, percent: 90 },
            { revision: "resolvia-provider-ingress-00002-def", percent: 10 },
          ],
        }),
      ),
    ).toEqual({ ok: false, reason: "TRAFFIC_NOT_EXCLUSIVE" });
  });

  it("rejects traffic revision that does not match expected revision", () => {
    expect(
      evaluateReleaseDigestProof(
        observation({
          traffic: [{ revision: "other-revision", percent: 100 }],
        }),
      ),
    ).toEqual({ ok: false, reason: "REVISION_MISMATCH" });
  });

  it("rejects env or secret mapping drift", () => {
    expect(
      evaluateReleaseDigestProof(
        observation({
          observedEnv: { RUNTIME_MODE: "CONNECTED", LOG_LEVEL: "debug" },
        }),
      ),
    ).toEqual({ ok: false, reason: "ENV_OR_SECRET_MAPPING_MISMATCH" });

    expect(
      evaluateReleaseDigestProof(
        observation({
          observedSecrets: {
            PUBSUB_HMAC_KEY:
              "projects/resolvia-project/secrets/pubsub-hmac/versions/4",
          },
        }),
      ),
    ).toEqual({ ok: false, reason: "ENV_OR_SECRET_MAPPING_MISMATCH" });
  });
});
