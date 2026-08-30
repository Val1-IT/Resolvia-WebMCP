import { notFound, redirect } from "next/navigation";

import { authorizeCaseAccess } from "@/src/application/auth/authorize-case-access";
import { getCaseWorkspace } from "@/src/application/cases/get-case-workspace";
import { seedDemoCase } from "@/src/application/cases/seed-demo-case";
import { RV_1028_CASE_ID } from "@/src/demo/rv-1028";
import { getRequestIdentity } from "@/src/infrastructure/auth/get-request-identity";
import {
  ConnectedConfigurationError,
  getRuntimeConfig,
} from "@/src/infrastructure/google/runtime-config";
import {
  ConnectedPersistenceUnavailableError,
  getResolutionStoreForRuntime,
} from "@/src/infrastructure/runtime/get-resolution-store-for-runtime";
import { CaseWorkspace } from "@/src/ui/components/case-workspace";

export const dynamic = "force-dynamic";

type LoadResult =
  | { kind: "READY"; runtimeMode: "LOCAL" | "CONNECTED"; viewModel: NonNullable<Awaited<ReturnType<typeof getCaseWorkspace>>> }
  | { kind: "NOT_FOUND" }
  | { kind: "UNAVAILABLE" };

export default async function CasePage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<{ historyPage?: string }>;
}) {
  const { caseId } = await params;
  const historyPage = parseHistoryPage((await searchParams).historyPage);
  let runtime;
  try {
    runtime = getRuntimeConfig(process.env);
  } catch (error) {
    if (error instanceof ConnectedConfigurationError) return unavailable();
    throw error;
  }

  const identity = await getRequestIdentity(runtime);
  if (!identity) redirect(`/login?next=${encodeURIComponent(`/cases/${caseId}`)}`);

  const domainCaseId = caseId.toUpperCase() === "RV-1028" ? RV_1028_CASE_ID : caseId;
  let result: LoadResult;
  try {
    const store = getResolutionStoreForRuntime(runtime);
    if (runtime.mode === "LOCAL" && domainCaseId === RV_1028_CASE_ID) await seedDemoCase(store);
    const authorization = await authorizeCaseAccess(store, domainCaseId, identity);
    if (!authorization.allowed) {
      result = authorization.reason === "AUTHORIZATION_UNAVAILABLE" ? { kind: "UNAVAILABLE" } : { kind: "NOT_FOUND" };
    } else {
      const viewModel = await getCaseWorkspace(store, domainCaseId, { historyPage });
      result = viewModel
        ? { kind: "READY", runtimeMode: runtime.mode === "CONNECTED" ? "CONNECTED" : "LOCAL", viewModel }
        : { kind: "NOT_FOUND" };
    }
  } catch (error) {
    if (error instanceof ConnectedPersistenceUnavailableError) result = { kind: "UNAVAILABLE" };
    else throw error;
  }

  if (result.kind === "UNAVAILABLE") return unavailable();
  if (result.kind === "NOT_FOUND") notFound();
  return <CaseWorkspace viewModel={result.viewModel} runtimeMode={result.runtimeMode} />;
}

function parseHistoryPage(value: string | undefined): number {
  if (!value || !/^\d{1,6}$/u.test(value)) return 1;
  return Math.max(1, Math.min(100_000, Number(value)));
}
function unavailable() {
  return <main><h1>Service unavailable</h1><p>Connected persistence or authorization is not available.</p></main>;
}
