import type { ResolutionStore } from "@/src/application/ports/resolution-store";
import type { AgentRunMutation } from "@/src/domain/agent/model";
import type { AutomationClaimInput, AutomationCompletionInput, AutomationMutationResult, AutomationRequestRecord } from "@/src/domain/automation/model";
import { claimAutomationRequest as applyClaim, compareAutomationRequests, completeAutomationRequest as applyCompletion } from "@/src/domain/automation/lease-policy";
import type {
  PartnerRequestAccess,
  PartnerRequestMutation,
  PartnerSubmissionPublication,
  PartnerSubmissionReservation,
  PartnerSubmissionRelease,
} from "@/src/domain/partners/model";
import { applyPartnerRequestMutation } from "@/src/domain/partners/apply-mutation";
import { applyPartnerSubmissionReservation } from "@/src/domain/partners/apply-submission-reservation";
import { applyPartnerSubmissionPublication } from "@/src/domain/partners/apply-submission-publication";
import { applyPartnerSubmissionRelease } from "@/src/domain/partners/apply-submission-release";
import { applyAgentRunMutation } from "@/src/domain/store/apply-agent-run-mutation";
import { validateCaseMutationView } from "@/src/domain/store/validate-mutation";
import {
  ResolutionSnapshotSchema,
  type AppendAgentRunResult,
  type CreatePartnerRequestResult,
  type CaseMutation,
  type CommitResult,
  type ResolutionCaseBundle,
  type ResolutionSnapshot,
} from "@/src/domain/store/model";

export class InMemoryResolutionStore implements ResolutionStore {
  private snapshot: ResolutionSnapshot;

  constructor(initialSnapshot: ResolutionSnapshot) {
    this.snapshot = structuredClone(
      ResolutionSnapshotSchema.parse(initialSnapshot),
    );
  }

  async loadPartnerRequest(
    requestId: string,
  ): Promise<PartnerRequestAccess | null> {
    const request = (this.snapshot.partnerRequests ?? []).find(
      (record) => record.id === requestId,
    );
    if (!request) return null;
    const tokenReceipt = (this.snapshot.partnerTokenReceipts ?? []).find(
      (record) => record.requestId === requestId,
    );
    return tokenReceipt ? structuredClone({ request, tokenReceipt }) : null;
  }
  async getCaseOwnerUserId(caseId: string): Promise<string | null> {
    return this.snapshot.cases.find((record) => record.id === caseId)?.ownerUserId ?? null;
  }
  async loadCaseBundle(caseId: string): Promise<ResolutionCaseBundle | null> {
    const caseRecord = this.snapshot.cases.find((record) => record.id === caseId);
    if (!caseRecord) return null;

    return structuredClone({
      caseRecord,
      events: this.snapshot.events.filter((record) => record.caseId === caseId),
      evidence: this.snapshot.evidence.filter(
        (record) => record.caseId === caseId,
      ),
      claims: this.snapshot.claims.filter((record) => record.caseId === caseId),
      auditRecords: this.snapshot.auditRecords.filter(
        (record) => record.caseId === caseId,
      ),
      providerTransactions: this.snapshot.providerTransactions.filter(
        (record) => record.caseId === caseId,
      ),
      agentRuns: this.snapshot.agentRuns.filter(
        (record) => record.caseId === caseId,
      ),
      partnerRequests: (this.snapshot.partnerRequests ?? []).filter(
        (record) => record.caseId === caseId,
      ),
      partnerTokenReceipts: (this.snapshot.partnerTokenReceipts ?? []).filter(
        (record) => record.caseId === caseId,
      ),
      automationRequests: (this.snapshot.automationRequests ?? []).filter(
        (record) => record.caseId === caseId,
      ),
      deadlines: (this.snapshot.deadlines ?? []).filter(
        (record) => record.caseId === caseId,
      ),
    });
  }

  async commitCaseMutation(mutation: CaseMutation): Promise<CommitResult> {
    const applied = validateCaseMutationView(this.snapshot, mutation);
    if (applied.result === "COMMITTED") {
      this.snapshot = applied.snapshot;
    }
    return applied.result;
  }

  async reservePartnerSubmission(
    mutation: PartnerSubmissionReservation,
  ): Promise<CreatePartnerRequestResult> {
    const applied = applyPartnerSubmissionReservation(this.snapshot, mutation);
    if (applied.result === "COMMITTED") this.snapshot = applied.snapshot;
    return applied.result;
  }

  async releasePartnerSubmission(
    mutation: PartnerSubmissionRelease,
  ): Promise<CreatePartnerRequestResult> {
    const applied = applyPartnerSubmissionRelease(this.snapshot, mutation);
    if (applied.result === "COMMITTED") this.snapshot = applied.snapshot;
    return applied.result;
  }

  async markPartnerSubmissionPublished(
    mutation: PartnerSubmissionPublication,
  ): Promise<CreatePartnerRequestResult> {
    const applied = applyPartnerSubmissionPublication(this.snapshot, mutation);
    if (applied.result === "COMMITTED") this.snapshot = applied.snapshot;
    return applied.result;
  }
  async createPartnerRequest(
    mutation: PartnerRequestMutation,
  ): Promise<CreatePartnerRequestResult> {
    const applied = applyPartnerRequestMutation(this.snapshot, mutation);
    if (applied.result === "COMMITTED") {
      this.snapshot = applied.snapshot;
    }
    return applied.result;
  }

  async appendAgentRun(
    mutation: AgentRunMutation,
  ): Promise<AppendAgentRunResult> {
    const applied = applyAgentRunMutation(this.snapshot, mutation);
    if (applied.result === "COMMITTED") {
      this.snapshot = applied.snapshot;
    }
    return applied.result;
  }

  async listDueAutomationRequests(now: string, limit: number): Promise<AutomationRequestRecord[]> {
    const timestamp = Date.parse(now);
    return structuredClone((this.snapshot.automationRequests ?? [])
      .filter((request) =>
        ((request.state === "PENDING" || request.state === "FAILED_RETRYABLE") && Date.parse(request.nextAttemptAt) <= timestamp) ||
        (request.state === "LEASED" && Boolean(request.leaseUntil) && Date.parse(request.leaseUntil!) <= timestamp))
      .sort(compareAutomationRequests)
      .slice(0, Math.max(0, Math.min(limit, 50))));
  }

  async claimAutomationRequest(input: AutomationClaimInput): Promise<AutomationMutationResult> {
    const index = (this.snapshot.automationRequests ?? []).findIndex((request) => request.id === input.requestId);
    if (index < 0) return "NOT_FOUND";
    const result = applyClaim(this.snapshot.automationRequests![index]!, input);
    if (!result.ok) return "NOT_CLAIMABLE";
    this.snapshot.automationRequests![index] = result.request;
    return "COMMITTED";
  }

  async completeAutomationRequest(input: AutomationCompletionInput): Promise<AutomationMutationResult> {
    const index = (this.snapshot.automationRequests ?? []).findIndex((request) => request.id === input.requestId);
    if (index < 0) return "NOT_FOUND";
    const result = applyCompletion(this.snapshot.automationRequests![index]!, input);
    if (!result.ok) return "NOT_CLAIMABLE";
    this.snapshot.automationRequests![index] = result.request;
    return "COMMITTED";
  }
}
