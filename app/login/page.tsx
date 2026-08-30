import { safeLoginNextPath } from "@/src/application/auth/safe-login-next-path";
import { getFirebaseClientConfig } from "@/src/infrastructure/auth/firebase-client-config";

import { LoginControl } from "./login-control";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const requested = (await searchParams).next;
  const nextPath = safeLoginNextPath(requested);
  return <main className="login-shell"><h1>Resolvia</h1><LoginControl config={getFirebaseClientConfig(process.env)} nextPath={nextPath} /></main>;
}