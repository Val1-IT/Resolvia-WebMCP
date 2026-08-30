import { OAuth2Client } from "google-auth-library";

export type PubSubIdentityVerifier = (
  request: Request,
  expectedAudience: string,
  allowedServiceAccounts: readonly string[],
) => Promise<string | null>;

const client = new OAuth2Client();

export const verifyGooglePubSubIdentity: PubSubIdentityVerifier = async (
  request,
  expectedAudience,
  allowedServiceAccounts,
) => {
  if (allowedServiceAccounts.length === 0) return null;
  const bearer = request.headers.get("authorization")?.match(/^Bearer (.+)$/u)?.[1];
  if (!bearer) return null;
  try {
    const ticket = await client.verifyIdToken({ idToken: bearer, audience: expectedAudience });
    const payload = ticket.getPayload();
    const email = payload?.email;
    if (
      !email ||
      payload.email_verified !== true ||
      !allowedServiceAccounts.includes(email)
    ) {
      return null;
    }
    return email;
  } catch {
    return null;
  }
};
