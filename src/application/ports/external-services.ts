import type { AgentResolutionInput } from "@/src/application/agents/build-agent-input";
import type {
  AgentResolutionProposal,
  AgentRunOutcome,
} from "@/src/domain/agent/model";
import type { ResolutionEvent } from "@/src/domain/events/model";

export interface ResolutionEventPublisher {
  publish(event: ResolutionEvent): Promise<void>;
}

export type AgentServiceRequest = {
  runId: string;
  input: AgentResolutionInput;
  serializedInput: string;
};

export type AgentServiceDiagnosticCode =
  | "PROVIDER_SCHEMA_REJECTED"
  | "TRANSPORT_SCHEMA_REJECTED"
  | "CANONICAL_SCHEMA_REJECTED"
  | "INPUT_TOO_LARGE"
  | "OUTPUT_TOO_LARGE";

export type AgentServiceResult =
  | {
      kind: "PROPOSAL";
      proposal: AgentResolutionProposal;
      modelId: string;
      modelVersion?: string;
      rawOutputDigest: string;
    }
  | {
      kind: "FAILURE";
      outcome: Exclude<
        AgentRunOutcome,
        "SUCCEEDED_VALID" | "REJECTED_VALIDATION"
      >;
      modelId: string;
      modelVersion?: string;
      rawOutputDigest?: string;
      diagnosticCode?: AgentServiceDiagnosticCode;
    };

export interface AgentService {
  proposeResolution(input: AgentServiceRequest): Promise<AgentServiceResult>;
}

export type AuthenticatedProviderPayload<TRaw> = {
  provider: string;
  caseId?: string;
  authenticatedAt: string;
  raw: TRaw;
};

export interface ProviderAdapter<
  TRaw = unknown,
  TAuthenticated = TRaw,
> {
  readonly provider: string;
  authenticate(input: TRaw): Promise<AuthenticatedProviderPayload<TAuthenticated>>;
  normalize(
    input: AuthenticatedProviderPayload<TAuthenticated>,
  ): Promise<ResolutionEvent[]>;
}
