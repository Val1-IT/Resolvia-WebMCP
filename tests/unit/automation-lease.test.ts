import { describe, expect, it } from "vitest";

import { claimAutomationRequest, completeAutomationRequest } from "@/src/domain/automation/lease-policy";
import { AutomationRequestRecordSchema } from "@/src/domain/automation/model";

const base = AutomationRequestRecordSchema.parse({
  id: "automation:case-rv-1028:v5:RUN_AGENT_ANALYSIS",
  automationKey: "case-rv-1028:v5:RUN_AGENT_ANALYSIS",
  caseId: "case-rv-1028",
  basedOnCaseVersion: 5,
  kind: "RUN_AGENT_ANALYSIS",
  state: "PENDING",
  retryCount: 0,
  nextAttemptAt: "2026-08-12T17:00:00.000Z",
  createdAt: "2026-08-12T17:00:00.000Z",
  updatedAt: "2026-08-12T17:00:00.000Z",
});

describe("automation lease policy", () => {
  it("allows one worker to claim due work and rejects a live competing lease", () => {
    const first = claimAutomationRequest(base, {
      workerId: "worker-a", now: "2026-08-12T17:01:00.000Z", leaseUntil: "2026-08-12T17:03:00.000Z",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.request).toMatchObject({ state: "LEASED", leaseOwner: "worker-a", retryCount: 0 });
    expect(claimAutomationRequest(first.request, {
      workerId: "worker-b", now: "2026-08-12T17:02:00.000Z", leaseUntil: "2026-08-12T17:04:00.000Z",
    })).toEqual({ ok: false, reason: "NOT_CLAIMABLE" });
  });

  it("recovers an expired lease and increments the bounded retry count", () => {
    const expired = { ...base, state: "LEASED" as const, leaseOwner: "worker-a", leaseUntil: "2026-08-12T17:01:30.000Z" };
    const result = claimAutomationRequest(expired, {
      workerId: "worker-b", now: "2026-08-12T17:02:00.000Z", leaseUntil: "2026-08-12T17:04:00.000Z",
    });
    expect(result).toEqual({ ok: true, request: expect.objectContaining({ leaseOwner: "worker-b", retryCount: 1 }) });
  });

  it("completes only for the lease owner and clears lease metadata", () => {
    const leased = { ...base, state: "LEASED" as const, leaseOwner: "worker-a", leaseUntil: "2026-08-12T17:03:00.000Z" };
    expect(completeAutomationRequest(leased, { workerId: "worker-b", now: "2026-08-12T17:02:00.000Z", outcome: "SUCCEEDED" }))
      .toEqual({ ok: false, reason: "LEASE_MISMATCH" });
    const completed = completeAutomationRequest(leased, { workerId: "worker-a", now: "2026-08-12T17:02:00.000Z", outcome: "SUCCEEDED" });
    expect(completed).toEqual({ ok: true, request: expect.objectContaining({ state: "SUCCEEDED" }) });
    if (completed.ok) {
      expect(completed.request.leaseOwner).toBeUndefined();
      expect(completed.request.leaseUntil).toBeUndefined();
    }
  });

  it("returns retryable work to the queue with a future attempt and terminalizes after five retries", () => {
    const leased = { ...base, state: "LEASED" as const, leaseOwner: "worker-a", leaseUntil: "2026-08-12T17:03:00.000Z", retryCount: 4 };
    const failed = completeAutomationRequest(leased, {
      workerId: "worker-a", now: "2026-08-12T17:02:00.000Z", outcome: "FAILED_RETRYABLE", nextAttemptAt: "2026-08-12T17:07:00.000Z", errorClass: "AGENT_UNAVAILABLE",
    });
    expect(failed).toEqual({ ok: true, request: expect.objectContaining({ state: "FAILED_TERMINAL", retryCount: 5, lastErrorClass: "AGENT_UNAVAILABLE" }) });
  });
});
