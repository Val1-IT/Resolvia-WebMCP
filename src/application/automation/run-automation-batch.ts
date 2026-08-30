import { analyzeCase } from "@/src/application/agents/analyze-case";
import type { AgentService } from "@/src/application/ports/external-services";
import type { ResolutionStore } from "@/src/application/ports/resolution-store";
import { attachAutomationOutbox } from "@/src/domain/automation/outbox-policy";
import { planAutomatedResolutionEvaluation } from "@/src/domain/automation/resolution-policy";

type Dependencies = {
  store: ResolutionStore;
  agentService: AgentService;
  workerId: string;
  limit: number;
  now: () => string;
  createRunId: () => string;
};

type BatchResult = { scanned: number; claimed: number; succeeded: number; retryable: number; terminal: number };

export async function runAutomationBatch(dependencies: Dependencies): Promise<BatchResult> {
  const { store } = dependencies;
  if (!store.listDueAutomationRequests || !store.claimAutomationRequest || !store.completeAutomationRequest) {
    throw new Error("AUTOMATION_STORE_UNAVAILABLE");
  }
  const startedAt = dependencies.now();
  const due = await store.listDueAutomationRequests(startedAt, Math.max(0, Math.min(dependencies.limit, 50)));
  const result: BatchResult = { scanned: due.length, claimed: 0, succeeded: 0, retryable: 0, terminal: 0 };

  for (const request of due) {
    const leaseUntil = new Date(Date.parse(startedAt) + 2 * 60 * 1000).toISOString();
    const claimed = await store.claimAutomationRequest({ requestId: request.id, workerId: dependencies.workerId, now: startedAt, leaseUntil });
    if (claimed !== "COMMITTED") continue;
    result.claimed += 1;

    const bundle = await store.loadCaseBundle(request.caseId);
    if (!bundle || bundle.caseRecord.version !== request.basedOnCaseVersion) {
      await store.completeAutomationRequest({
        requestId: request.id, workerId: dependencies.workerId, now: dependencies.now(),
        outcome: "FAILED_TERMINAL", errorClass: bundle ? "STALE_CASE_VERSION" : "CASE_NOT_FOUND",
      });
      result.terminal += 1;
      continue;
    }

    if (request.kind === "RECALCULATE_GUIDANCE") {
      await store.completeAutomationRequest({ requestId: request.id, workerId: dependencies.workerId, now: dependencies.now(), outcome: "SUCCEEDED" });
      result.succeeded += 1;
      continue;
    }

    if (request.kind === "EVALUATE_RESOLUTION") {
      const evaluated = planAutomatedResolutionEvaluation(bundle, dependencies.now());
      if (evaluated.kind === "NO_CHANGE") {
        await store.completeAutomationRequest({ requestId: request.id, workerId: dependencies.workerId, now: dependencies.now(), outcome: "SUCCEEDED" });
        result.succeeded += 1;
        continue;
      }
      const commit = await store.commitCaseMutation(attachAutomationOutbox(evaluated.mutation, dependencies.now()));
      if (commit === "COMMITTED") {
        await store.completeAutomationRequest({ requestId: request.id, workerId: dependencies.workerId, now: dependencies.now(), outcome: "SUCCEEDED" });
        result.succeeded += 1;
      } else if (commit === "VERSION_CONFLICT") {
        await retry(store, request.id, dependencies.workerId, dependencies.now(), "VERSION_CONFLICT");
        result.retryable += 1;
      } else {
        await store.completeAutomationRequest({ requestId: request.id, workerId: dependencies.workerId, now: dependencies.now(), outcome: "FAILED_TERMINAL", errorClass: commit });
        result.terminal += 1;
      }
      continue;
    }

    try {
      const analysis = await analyzeCase(store, dependencies.agentService, request.caseId, {
        createRunId: dependencies.createRunId,
        now: dependencies.now,
      });
      if (analysis.kind === "RECORDED") {
        await store.completeAutomationRequest({ requestId: request.id, workerId: dependencies.workerId, now: dependencies.now(), outcome: "SUCCEEDED" });
        result.succeeded += 1;
      } else if (analysis.kind === "VERSION_CONFLICT") {
        await retry(store, request.id, dependencies.workerId, dependencies.now(), "VERSION_CONFLICT");
        result.retryable += 1;
      } else {
        await store.completeAutomationRequest({ requestId: request.id, workerId: dependencies.workerId, now: dependencies.now(), outcome: "FAILED_TERMINAL", errorClass: analysis.kind });
        result.terminal += 1;
      }
    } catch {
      await retry(store, request.id, dependencies.workerId, dependencies.now(), "AGENT_UNAVAILABLE");
      result.retryable += 1;
    }
  }
  return result;
}

async function retry(store: ResolutionStore, requestId: string, workerId: string, now: string, errorClass: string): Promise<void> {
  const nextAttemptAt = new Date(Date.parse(now) + 5 * 60 * 1000).toISOString();
  await store.completeAutomationRequest!({ requestId, workerId, now, outcome: "FAILED_RETRYABLE", nextAttemptAt, errorClass });
}
