import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

const SecretId = "resolvia-demo-provider-hmac";
const SecretBytes = 32;

export type SecretVersionReader = (input: {
  name: string;
}) => Promise<
  readonly [
    { payload?: { data?: Uint8Array | Buffer | string | null } | null },
    ...unknown[],
  ]
>;

export class DemoProviderSecretError extends Error {
  readonly code = "DEMO_PROVIDER_SECRET_UNAVAILABLE";

  constructor() {
    super("Demo Provider secret is unavailable or invalid.");
    this.name = "DemoProviderSecretError";
  }
}

/** Loads only the current enabled Secret Manager version; never returns the encoded value. */
export async function loadDemoProviderSecret(input: {
  projectId: string;
  accessSecretVersion: SecretVersionReader;
}): Promise<Buffer> {
  try {
    const [version] = await input.accessSecretVersion({
      name: `projects/${input.projectId}/secrets/${SecretId}/versions/latest`,
    });
    const encoded = version.payload?.data;
    if (!encoded) throw new DemoProviderSecretError();
    const secret = Buffer.from(encoded.toString(), "base64");
    if (secret.length !== SecretBytes) throw new DemoProviderSecretError();
    return secret;
  } catch {
    throw new DemoProviderSecretError();
  }
}

let cachedSecret: Promise<Buffer> | undefined;

/** Process-local cache avoids per-request Secret Manager polling. Failed reads are never cached. */
export function getDemoProviderSecret(projectId: string): Promise<Buffer> {
  cachedSecret ??= loadDemoProviderSecret({
    projectId,
    accessSecretVersion: (input) =>
      new SecretManagerServiceClient().accessSecretVersion(input),
  }).catch((error: unknown) => {
    cachedSecret = undefined;
    throw error;
  });
  return cachedSecret;
}