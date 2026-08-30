import { AutomationRequestRecordSchema, type AutomationRequestRecord } from "@/src/domain/automation/model";

type ClaimInput = { workerId: string; now: string; leaseUntil: string };
type ClaimResult = { ok: true; request: AutomationRequestRecord } | { ok: false; reason: "NOT_CLAIMABLE" };

export function claimAutomationRequest(request: AutomationRequestRecord, input: ClaimInput): ClaimResult {
  const now = Date.parse(input.now);
  const leaseUntil = Date.parse(input.leaseUntil);
  const expiredLease = request.state === "LEASED" && Boolean(request.leaseUntil) && Date.parse(request.leaseUntil!) <= now;
  const queued = (request.state === "PENDING" || request.state === "FAILED_RETRYABLE") && Date.parse(request.nextAttemptAt) <= now;
  if ((!queued && !expiredLease) || !Number.isFinite(now) || !Number.isFinite(leaseUntil) || leaseUntil <= now) {
    return { ok: false, reason: "NOT_CLAIMABLE" };
  }
  const retryCount = request.retryCount + (expiredLease ? 1 : 0);
  if (retryCount >= 5) return { ok: false, reason: "NOT_CLAIMABLE" };
  return {
    ok: true,
    request: AutomationRequestRecordSchema.parse({
      ...request,
      state: "LEASED",
      leaseOwner: input.workerId,
      leaseUntil: input.leaseUntil,
      retryCount,
      updatedAt: input.now,
    }),
  };
}

type CompleteInput = {
  workerId: string;
  now: string;
  outcome: "SUCCEEDED" | "FAILED_RETRYABLE" | "FAILED_TERMINAL";
  nextAttemptAt?: string;
  errorClass?: string;
};
type CompleteResult = { ok: true; request: AutomationRequestRecord } | { ok: false; reason: "LEASE_MISMATCH" | "INVALID_COMPLETION" };

export function completeAutomationRequest(request: AutomationRequestRecord, input: CompleteInput): CompleteResult {
  if (request.state !== "LEASED" || request.leaseOwner !== input.workerId) {
    return { ok: false, reason: "LEASE_MISMATCH" };
  }
  const retryCount = request.retryCount + (input.outcome === "FAILED_RETRYABLE" ? 1 : 0);
  const state = input.outcome === "FAILED_RETRYABLE" && retryCount >= 5 ? "FAILED_TERMINAL" : input.outcome;
  if (state === "FAILED_RETRYABLE" && !input.nextAttemptAt) {
    return { ok: false, reason: "INVALID_COMPLETION" };
  }
  const next = {
    ...request,
    state,
    retryCount,
    nextAttemptAt: state === "FAILED_RETRYABLE" ? input.nextAttemptAt! : request.nextAttemptAt,
    updatedAt: input.now,
    ...(input.errorClass ? { lastErrorClass: input.errorClass } : {}),
  } as Record<string, unknown>;
  delete next.leaseOwner;
  delete next.leaseUntil;
  return { ok: true, request: AutomationRequestRecordSchema.parse(next) };
}

const KIND_PRIORITY = {
  RUN_AGENT_ANALYSIS: 0,
  RECALCULATE_GUIDANCE: 1,
  EVALUATE_RESOLUTION: 2,
} as const;

export function compareAutomationRequests(left: AutomationRequestRecord, right: AutomationRequestRecord): number {
  return left.nextAttemptAt.localeCompare(right.nextAttemptAt) ||
    left.basedOnCaseVersion - right.basedOnCaseVersion ||
    KIND_PRIORITY[left.kind] - KIND_PRIORITY[right.kind] ||
    left.id.localeCompare(right.id);
}
