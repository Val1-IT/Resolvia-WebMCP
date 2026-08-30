import type { AgentRunMutation } from "@/src/domain/agent/model";
import type { AutomationClaimInput, AutomationCompletionInput, AutomationMutationResult, AutomationRequestRecord } from "@/src/domain/automation/model";
import type {
  PartnerRequestAccess,
  PartnerRequestMutation,
  PartnerSubmissionPublication,
  PartnerSubmissionReservation,
  PartnerSubmissionRelease,
} from "@/src/domain/partners/model";
import type {
  AppendAgentRunResult,
  CreatePartnerRequestResult,
  CaseMutation,
  CommitResult,
  ResolutionCaseBundle,
} from "@/src/domain/store/model";

export interface ResolutionStore {
  loadCaseBundle(caseId: string): Promise<ResolutionCaseBundle | null>;
  loadPartnerRequest(requestId: string): Promise<PartnerRequestAccess | null>;
  commitCaseMutation(mutation: CaseMutation): Promise<CommitResult>;
  appendAgentRun(mutation: AgentRunMutation): Promise<AppendAgentRunResult>;
  createPartnerRequest(
    mutation: PartnerRequestMutation,
  ): Promise<CreatePartnerRequestResult>;
  reservePartnerSubmission(
    mutation: PartnerSubmissionReservation,
  ): Promise<CreatePartnerRequestResult>;
  markPartnerSubmissionPublished(
    mutation: PartnerSubmissionPublication,
  ): Promise<CreatePartnerRequestResult>;
  releasePartnerSubmission(
    mutation: PartnerSubmissionRelease,
  ): Promise<CreatePartnerRequestResult>;
  listDueAutomationRequests?(now: string, limit: number): Promise<AutomationRequestRecord[]>;
  claimAutomationRequest?(input: AutomationClaimInput): Promise<AutomationMutationResult>;
  completeAutomationRequest?(input: AutomationCompletionInput): Promise<AutomationMutationResult>;
  getCaseOwnerUserId?(caseId: string): Promise<string | null>;
}
