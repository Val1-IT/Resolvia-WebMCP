import { randomUUID } from "node:crypto";

import { runAutomationBatch } from "@/src/application/automation/run-automation-batch";
import { getAgentService } from "@/src/infrastructure/agent/get-agent-service";
import { verifyGooglePubSubIdentity, type PubSubIdentityVerifier } from "@/src/infrastructure/google/pubsub-push-identity";
import { getRuntimeConfig, type RuntimeConfig } from "@/src/infrastructure/google/runtime-config";
import { getResolutionStoreForRuntime } from "@/src/infrastructure/runtime/get-resolution-store-for-runtime";

type BatchSummary = { scanned: number; claimed: number; succeeded: number; retryable: number; terminal: number };
type Dependencies = {
  getRuntime: () => RuntimeConfig;
  verifyIdentity: PubSubIdentityVerifier;
  runBatch: (limit: number) => Promise<BatchSummary>;
};

const defaultDependencies: Dependencies = {
  getRuntime: () => getRuntimeConfig(process.env),
  verifyIdentity: verifyGooglePubSubIdentity,
  runBatch: (limit) => runAutomationBatch({
    store: getResolutionStoreForRuntime(getRuntimeConfig(process.env)),
    agentService: getAgentService(),
    workerId: `scheduler:${process.env.K_REVISION ?? "local"}:${randomUUID()}`,
    limit,
    now: () => new Date().toISOString(),
    createRunId: () => `agent-run:${randomUUID()}`,
  }),
};

export const POST = createAutomationRunRoute(defaultDependencies);

export function createAutomationRunRoute(dependencies: Dependencies): (request: Request) => Promise<Response> {
  return async (request) => {
    let runtime: RuntimeConfig;
    try {
      runtime = dependencies.getRuntime();
    } catch {
      return unavailable();
    }
    if (runtime.mode !== "CONNECTED" || !runtime.projectId || !runtime.engineAudience) return unavailable();
    const schedulerAccount = `resolvia-scheduler@${runtime.projectId}.iam.gserviceaccount.com`;
    if (!(await dependencies.verifyIdentity(request, runtime.engineAudience, [schedulerAccount]))) {
      return new Response(null, { status: 401 });
    }
    try {
      return Response.json(await dependencies.runBatch(25));
    } catch {
      return unavailable();
    }
  };
}

function unavailable(): Response {
  return Response.json({ error: "AUTOMATION_UNAVAILABLE" }, { status: 503 });
}
