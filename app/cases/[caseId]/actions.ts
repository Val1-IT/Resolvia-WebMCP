"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { analyzeCase } from "@/src/application/agents/analyze-case";
import { authorizeCaseAccess } from "@/src/application/auth/authorize-case-access";
import { RV_1028_CASE_ID } from "@/src/demo/rv-1028";
import { getAgentService } from "@/src/infrastructure/agent/get-agent-service";
import { getRequestIdentity } from "@/src/infrastructure/auth/get-request-identity";
import { getRuntimeConfig } from "@/src/infrastructure/google/runtime-config";
import { getResolutionStoreForRuntime } from "@/src/infrastructure/runtime/get-resolution-store-for-runtime";

export type AnalyzeCaseActionState = { message: string };

export async function analyzeCaseAction(
  caseId: string,
  previousState: AnalyzeCaseActionState,
  formData: FormData,
): Promise<AnalyzeCaseActionState> {
  void previousState;
  void formData;

  const casePath = caseId === RV_1028_CASE_ID ? "/cases/RV-1028" : `/cases/${encodeURIComponent(caseId)}`;

  try {
    const runtime = getRuntimeConfig(process.env);
    const identity = await getRequestIdentity(runtime);
    if (!identity) return { message: "Sign in with an approved account to analyze this case." };
    const store = getResolutionStoreForRuntime(runtime);
    const authorization = await authorizeCaseAccess(store, caseId, identity);
    if (!authorization.allowed) return { message: "Case analysis is not authorized." };

    const result = await analyzeCase(store, getAgentService(), caseId, {
      createRunId: () => randomUUID(),
      now: () => new Date().toISOString(),
    });
    revalidatePath(casePath);

    if (result.kind === "RECORDED") return { message: actionMessage(result.run.outcome) };
    if (result.kind === "VERSION_CONFLICT") return { message: "Case changed during analysis. Refresh and try again." };
    if (result.kind === "CASE_NOT_FOUND") return { message: "Case is no longer available." };
    return { message: "Analysis could not be recorded safely." };
  } catch {
    return { message: "Agent analysis unavailable. Deterministic case data is unchanged." };
  }
}

function actionMessage(outcome: string): string {
  if (outcome === "SUCCEEDED_VALID") return "Analysis recorded. No case status changed and no action was performed.";
  if (outcome === "REJECTED_VALIDATION") return "Analysis was rejected by deterministic validation. Case data is unchanged.";
  return "Agent analysis unavailable. Deterministic case data is unchanged.";
}