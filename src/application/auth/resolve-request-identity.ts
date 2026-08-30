import type { SessionIdentity } from "@/src/application/auth/authorize-case-access";
import { identityFromClaims, parseSessionAccessConfig } from "@/src/application/auth/session-policy";
import type { SessionService } from "@/src/application/ports/session-service";
import type { RuntimeMode } from "@/src/domain/events/model";

export async function resolveRequestIdentity(input: {
  runtimeMode: RuntimeMode;
  sessionCookie: string | undefined;
  sessionService?: SessionService;
  env: Record<string, string | undefined>;
}): Promise<SessionIdentity | null> {
  if (input.runtimeMode === "LOCAL") {
    return { userId: "resolvia-demo-user", isAdmin: true };
  }
  if (!input.sessionCookie || !input.sessionService) return null;
  try {
    const claims = await input.sessionService.verifySessionCookie(input.sessionCookie);
    return identityFromClaims(claims, parseSessionAccessConfig(input.env));
  } catch {
    return null;
  }
}