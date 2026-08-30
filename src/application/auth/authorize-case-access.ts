import type { ResolutionStore } from "@/src/application/ports/resolution-store";

export type SessionIdentity = { userId: string; isAdmin: boolean };
export type CaseAuthorizationResult = { allowed: true } | { allowed: false; reason: "NOT_FOUND" | "FORBIDDEN" | "AUTHORIZATION_UNAVAILABLE" };

export async function authorizeCaseAccess(
  store: ResolutionStore,
  caseId: string,
  identity: SessionIdentity,
): Promise<CaseAuthorizationResult> {
  if (!store.getCaseOwnerUserId) return { allowed: false, reason: "AUTHORIZATION_UNAVAILABLE" };
  const ownerUserId = await store.getCaseOwnerUserId(caseId);
  if (!ownerUserId) return { allowed: false, reason: "NOT_FOUND" };
  return identity.isAdmin || ownerUserId === identity.userId
    ? { allowed: true }
    : { allowed: false, reason: "FORBIDDEN" };
}
