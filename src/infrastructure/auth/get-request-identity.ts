import { cookies } from "next/headers";

import type { SessionIdentity } from "@/src/application/auth/authorize-case-access";
import { resolveRequestIdentity } from "@/src/application/auth/resolve-request-identity";
import type { RuntimeConfig } from "@/src/infrastructure/google/runtime-config";
import { getSessionService } from "@/src/infrastructure/auth/get-session-service";

export const SESSION_COOKIE_NAME = "resolvia_session";
export const CSRF_COOKIE_NAME = "resolvia_csrf";

export async function getRequestIdentity(runtime: RuntimeConfig): Promise<SessionIdentity | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return resolveRequestIdentity({
    runtimeMode: runtime.mode,
    sessionCookie,
    ...(runtime.mode === "CONNECTED" && sessionCookie ? { sessionService: getSessionService() } : {}),
    env: process.env,
  });
}