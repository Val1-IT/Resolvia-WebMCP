import { timingSafeEqual } from "node:crypto";

import type { SessionTokenClaims } from "@/src/application/ports/session-service";
import type { SessionIdentity } from "@/src/application/auth/authorize-case-access";

const MAX_RECENT_AUTH_AGE_SECONDS = 5 * 60;

export class SessionPolicyError extends Error {
  constructor(public readonly code: "AUTH_NOT_RECENT" | "CSRF_MISMATCH" | "EMAIL_NOT_ALLOWED" | "INVALID_ORIGIN") {
    super(code);
    this.name = "SessionPolicyError";
  }
}

export type SessionAccessConfig = {
  allowedEmails: ReadonlySet<string>;
  adminEmails: ReadonlySet<string>;
};

export function parseSessionAccessConfig(env: Record<string, string | undefined>): SessionAccessConfig {
  const allowedEmails = parseEmails(env.RESOLVIA_ALLOWED_USER_EMAILS);
  const adminEmails = parseEmails(env.RESOLVIA_ADMIN_USER_EMAILS);
  for (const email of adminEmails) allowedEmails.add(email);
  return { allowedEmails, adminEmails };
}

export function identityFromClaims(claims: SessionTokenClaims, config: SessionAccessConfig): SessionIdentity {
  const email = claims.email?.trim().toLowerCase();
  if (!email || !claims.emailVerified || !config.allowedEmails.has(email)) {
    throw new SessionPolicyError("EMAIL_NOT_ALLOWED");
  }
  return { userId: claims.userId, isAdmin: config.adminEmails.has(email) };
}

export function validateSessionExchange(input: {
  claims: SessionTokenClaims;
  config: SessionAccessConfig;
  nowSeconds: number;
  origin: string | null;
  expectedOrigin: string;
  csrfHeader: string | null;
  csrfCookie: string | undefined;
}): SessionIdentity {
  validateRequestIntegrity(input);
  if (input.nowSeconds - input.claims.authTimeSeconds > MAX_RECENT_AUTH_AGE_SECONDS || input.claims.authTimeSeconds > input.nowSeconds + 30) {
    throw new SessionPolicyError("AUTH_NOT_RECENT");
  }
  return identityFromClaims(input.claims, input.config);
}

export function validateRequestIntegrity(input: {
  origin: string | null;
  expectedOrigin: string;
  csrfHeader: string | null;
  csrfCookie: string | undefined;
}): void {
  if (input.origin !== input.expectedOrigin) throw new SessionPolicyError("INVALID_ORIGIN");
  if (!matchesSecret(input.csrfHeader, input.csrfCookie)) throw new SessionPolicyError("CSRF_MISMATCH");
}
function parseEmails(value: string | undefined): Set<string> {
  return new Set((value ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));
}

function matchesSecret(left: string | null, right: string | undefined): boolean {
  if (!left || !right) return false;
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}