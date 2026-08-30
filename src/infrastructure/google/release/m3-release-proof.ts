export type CloudRunTrafficTarget = {
  revision: string;
  percent: number;
};

export type EnvMapping = Record<string, string>;
export type SecretMapping = Record<string, string>;

export type CloudRunReleaseObservation = {
  service: string;
  ready: boolean;
  image: string;
  expectedDigest: string;
  expectedRevision: string;
  traffic: readonly CloudRunTrafficTarget[];
  expectedEnv: EnvMapping;
  observedEnv: EnvMapping;
  expectedSecrets: SecretMapping;
  observedSecrets: SecretMapping;
};

export type ReleaseDigestProofEvaluation =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "READY_NOT_TRUE"
        | "DIGEST_MISMATCH_OR_TAG"
        | "REVISION_MISMATCH"
        | "TRAFFIC_NOT_EXCLUSIVE"
        | "ENV_OR_SECRET_MAPPING_MISMATCH";
    };

const DIGEST_IMAGE =
  /^[a-z0-9-]+-docker\.pkg\.dev\/[^/@]+\/[^/@]+\/[^/@]+@sha256:[a-f0-9]{64}$/u;

function mappingsEqual(expected: EnvMapping, observed: EnvMapping): boolean {
  const expectedKeys = Object.keys(expected).sort();
  const observedKeys = Object.keys(observed).sort();
  if (expectedKeys.length !== observedKeys.length) return false;
  for (let i = 0; i < expectedKeys.length; i += 1) {
    const key = expectedKeys[i]!;
    const observedKey = observedKeys[i]!;
    if (key !== observedKey) return false;
    if (expected[key] !== observed[key]) return false;
  }
  return true;
}

/**
 * Immutable release proof: Ready=True, exact digest image, exact revision,
 * exclusive 100% traffic, and exact env/secret mappings.
 */
export function evaluateReleaseDigestProof(
  observation: CloudRunReleaseObservation,
): ReleaseDigestProofEvaluation {
  if (observation.ready !== true) {
    return { ok: false, reason: "READY_NOT_TRUE" };
  }
  if (
    !DIGEST_IMAGE.test(observation.image) ||
    !DIGEST_IMAGE.test(observation.expectedDigest) ||
    observation.image !== observation.expectedDigest
  ) {
    return { ok: false, reason: "DIGEST_MISMATCH_OR_TAG" };
  }
  if (
    observation.traffic.length !== 1 ||
    observation.traffic[0]?.percent !== 100 ||
    !observation.traffic[0].revision
  ) {
    return { ok: false, reason: "TRAFFIC_NOT_EXCLUSIVE" };
  }
  if (observation.traffic[0].revision !== observation.expectedRevision) {
    return { ok: false, reason: "REVISION_MISMATCH" };
  }
  if (
    !mappingsEqual(observation.expectedEnv, observation.observedEnv) ||
    !mappingsEqual(observation.expectedSecrets, observation.observedSecrets)
  ) {
    return { ok: false, reason: "ENV_OR_SECRET_MAPPING_MISMATCH" };
  }
  return { ok: true };
}
