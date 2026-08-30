import { readFile } from "node:fs/promises";

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
  emptyResolutionSnapshot,
  type AppendAgentRunResult,
  type CreatePartnerRequestResult,
  type CaseMutation,
  type CommitResult,
  type ResolutionCaseBundle,
  type ResolutionSnapshot,
} from "@/src/domain/store/model";
import {
  writeJsonAtomically,
  type AtomicJsonFileOptions,
} from "@/src/infrastructure/local/atomic-json-file";

export class JsonResolutionStore implements ResolutionStore {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly fileOptions: AtomicJsonFileOptions = {},
  ) {}

  async loadPartnerRequest(
    requestId: string,
  ): Promise<PartnerRequestAccess | null> {
    await this.queue;
    const snapshot = await this.loadSnapshot();
    const request = (snapshot.partnerRequests ?? []).find(
      (record) => record.id === requestId,
    );
    if (!request) return null;
    const tokenReceipt = (snapshot.partnerTokenReceipts ?? []).find(
      (record) => record.requestId === requestId,
    );
    return tokenReceipt ? structuredClone({ request, tokenReceipt }) : null;
  }
  async getCaseOwnerUserId(caseId: string): Promise<string | null> {
    await this.queue;
    return (await this.loadSnapshot()).cases.find((record) => record.id === caseId)?.ownerUserId ?? null;
  }
  async loadCaseBundle(caseId: string): Promise<ResolutionCaseBundle | null> {
    await this.queue;
    const snapshot = await this.loadSnapshot();
    const caseRecord = snapshot.cases.find((record) => record.id === caseId);
    if (!caseRecord) return null;

    return structuredClone({
      caseRecord,
      events: snapshot.events.filter((record) => record.caseId === caseId),
      evidence: snapshot.evidence.filter((record) => record.caseId === caseId),
      claims: snapshot.claims.filter((record) => record.caseId === caseId),
      auditRecords: snapshot.auditRecords.filter(
        (record) => record.caseId === caseId,
      ),
      providerTransactions: snapshot.providerTransactions.filter(
        (record) => record.caseId === caseId,
      ),
      agentRuns: snapshot.agentRuns.filter((record) => record.caseId === caseId),
      partnerRequests: (snapshot.partnerRequests ?? []).filter(
        (record) => record.caseId === caseId,
      ),
      partnerTokenReceipts: (snapshot.partnerTokenReceipts ?? []).filter(
        (record) => record.caseId === caseId,
      ),
      automationRequests: (snapshot.automationRequests ?? []).filter(
        (record) => record.caseId === caseId,
      ),
      deadlines: (snapshot.deadlines ?? []).filter(
        (record) => record.caseId === caseId,
      ),
    });
  }

  reservePartnerSubmission(
    mutation: PartnerSubmissionReservation,
  ): Promise<CreatePartnerRequestResult> {
    return this.applyPartnerStatusMutation((snapshot) =>
      applyPartnerSubmissionReservation(snapshot, mutation),
    );
  }

  releasePartnerSubmission(
    mutation: PartnerSubmissionRelease,
  ): Promise<CreatePartnerRequestResult> {
    return this.applyPartnerStatusMutation((snapshot) =>
      applyPartnerSubmissionRelease(snapshot, mutation),
    );
  }

  markPartnerSubmissionPublished(
    mutation: PartnerSubmissionPublication,
  ): Promise<CreatePartnerRequestResult> {
    return this.applyPartnerStatusMutation((snapshot) =>
      applyPartnerSubmissionPublication(snapshot, mutation),
    );
  }
  createPartnerRequest(
    mutation: PartnerRequestMutation,
  ): Promise<CreatePartnerRequestResult> {
    const operation = this.queue.then(async () => {
      const snapshot = await this.loadSnapshot();
      const applied = applyPartnerRequestMutation(snapshot, mutation);

      if (applied.result === "COMMITTED") {
        await writeJsonAtomically(this.filePath, applied.snapshot, this.fileOptions);
      }

      return applied.result;
    });

    this.queue = operation.then(
      () => undefined,
      () => undefined,
    );

    return operation;
  }

  appendAgentRun(
    mutation: AgentRunMutation,
  ): Promise<AppendAgentRunResult> {
    const operation = this.queue.then(async () => {
      const snapshot = await this.loadSnapshot();
      const applied = applyAgentRunMutation(snapshot, mutation);

      if (applied.result === "COMMITTED") {
        await writeJsonAtomically(
          this.filePath,
          applied.snapshot,
          this.fileOptions,
        );
      }

      return applied.result;
    });

    this.queue = operation.then(
      () => undefined,
      () => undefined,
    );

    return operation;
  }

  commitCaseMutation(mutation: CaseMutation): Promise<CommitResult> {
    const operation = this.queue.then(async () => {
      const snapshot = await this.loadSnapshot();
      const applied = validateCaseMutationView(snapshot, mutation);

      if (applied.result === "COMMITTED") {
        await writeJsonAtomically(
          this.filePath,
          applied.snapshot,
          this.fileOptions,
        );
      }

      return applied.result;
    });

    this.queue = operation.then(
      () => undefined,
      () => undefined,
    );

    return operation;
  }

  async listDueAutomationRequests(now: string, limit: number): Promise<AutomationRequestRecord[]> {
    await this.queue;
    const snapshot = await this.loadSnapshot();
    const timestamp = Date.parse(now);
    return (snapshot.automationRequests ?? [])
      .filter((request) =>
        ((request.state === "PENDING" || request.state === "FAILED_RETRYABLE") && Date.parse(request.nextAttemptAt) <= timestamp) ||
        (request.state === "LEASED" && Boolean(request.leaseUntil) && Date.parse(request.leaseUntil!) <= timestamp))
      .sort(compareAutomationRequests)
      .slice(0, Math.max(0, Math.min(limit, 50)));
  }

  claimAutomationRequest(input: AutomationClaimInput): Promise<AutomationMutationResult> {
    return this.updateAutomation(input.requestId, (request) => applyClaim(request, input));
  }

  completeAutomationRequest(input: AutomationCompletionInput): Promise<AutomationMutationResult> {
    return this.updateAutomation(input.requestId, (request) => applyCompletion(request, input));
  }

  private updateAutomation(
    requestId: string,
    apply: (request: AutomationRequestRecord) => { ok: true; request: AutomationRequestRecord } | { ok: false },
  ): Promise<AutomationMutationResult> {
    const operation = this.queue.then(async () => {
      const snapshot = await this.loadSnapshot();
      const index = (snapshot.automationRequests ?? []).findIndex((request) => request.id === requestId);
      if (index < 0) return "NOT_FOUND" as const;
      const result = apply(snapshot.automationRequests![index]!);
      if (!result.ok) return "NOT_CLAIMABLE" as const;
      snapshot.automationRequests![index] = result.request;
      await writeJsonAtomically(this.filePath, snapshot, this.fileOptions);
      return "COMMITTED" as const;
    });
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private applyPartnerStatusMutation(
    apply: (snapshot: ResolutionSnapshot) => {
      result: CreatePartnerRequestResult;
      snapshot: ResolutionSnapshot;
    },
  ): Promise<CreatePartnerRequestResult> {
    const operation = this.queue.then(async () => {
      const applied = apply(await this.loadSnapshot());
      if (applied.result === "COMMITTED") {
        await writeJsonAtomically(this.filePath, applied.snapshot, this.fileOptions);
      }
      return applied.result;
    });
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }
  private async loadSnapshot(): Promise<ResolutionSnapshot> {
    try {
      const stored = await readFile(this.filePath, "utf8");
      return ResolutionSnapshotSchema.parse(JSON.parse(stored));
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return emptyResolutionSnapshot();
      }
      throw error;
    }
  }
}
