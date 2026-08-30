import { buildAgentResolutionInput } from "@/src/application/agents/build-agent-input";
import {
  RESOLUTION_AGENT_PROMPT_VERSION,
  serializeAgentRequest,
} from "@/src/application/agents/resolution-agent-prompt";
import { validateAgentResolutionProposal } from "@/src/application/agents/validate-agent-proposal";
import type {
  AgentService,
  AgentServiceResult,
} from "@/src/application/ports/external-services";
import type { ResolutionStore } from "@/src/application/ports/resolution-store";
import {
  AgentRunRecordSchema,
  type AgentProposalValidationErrorCode,
  type AgentResolutionProposal,
  type AgentRunRecord,
} from "@/src/domain/agent/model";
import { buildTruthGraph } from "@/src/domain/truth-graph/build-truth-graph";
import { redactSensitiveText } from "@/src/domain/privacy/redact-sensitive-text";

export type AnalyzeCaseDependencies = {
  createRunId: () => string;
  now: () => string;
};

export type AnalyzeCaseResult =
  | { kind: "RECORDED"; run: AgentRunRecord }
  | {
      kind: "CASE_NOT_FOUND" | "VERSION_CONFLICT" | "CASE_INTEGRITY_ERROR";
    };

export async function analyzeCase(
  store: ResolutionStore,
  agentService: AgentService,
  caseId: string,
  dependencies: AnalyzeCaseDependencies,
): Promise<AnalyzeCaseResult> {
  const initialBundle = await store.loadCaseBundle(caseId);
  if (!initialBundle) return { kind: "CASE_NOT_FOUND" };

  const runId = dependencies.createRunId();
  const startedAt = dependencies.now();
  const builtInput = buildAgentResolutionInput(initialBundle);
  const serviceResult = await agentService.proposeResolution({
    runId,
    input: builtInput.input,
    serializedInput: serializeAgentRequest(builtInput.input),
  });
  const completedAt = dependencies.now();

  const currentBundle = await store.loadCaseBundle(caseId);
  if (!currentBundle) return { kind: "CASE_NOT_FOUND" };

  const run = buildAgentRun({
    runId,
    startedAt,
    completedAt,
    basedOnCaseVersion: initialBundle.caseRecord.version,
    currentCaseVersion: currentBundle.caseRecord.version,
    caseId,
    builtInput,
    currentBundle,
    serviceResult,
  });

  const appendResult = await store.appendAgentRun({
    agentRun: run,
    expectedCaseVersion: currentBundle.caseRecord.version,
  });
  return appendResult === "COMMITTED"
    ? { kind: "RECORDED", run }
    : { kind: appendResult };
}

type BuildRunInput = {
  runId: string;
  startedAt: string;
  completedAt: string;
  basedOnCaseVersion: number;
  currentCaseVersion: number;
  caseId: string;
  builtInput: ReturnType<typeof buildAgentResolutionInput>;
  currentBundle: NonNullable<
    Awaited<ReturnType<ResolutionStore["loadCaseBundle"]>>
  >;
  serviceResult: AgentServiceResult;
};

function buildAgentRun(input: BuildRunInput): AgentRunRecord {
  const base = {
    id: input.runId,
    caseId: input.caseId,
    basedOnCaseVersion: input.basedOnCaseVersion,
    agentName: "resolvia_resolution_agent" as const,
    modelId: input.serviceResult.modelId,
    ...(input.serviceResult.modelVersion
      ? { modelVersion: input.serviceResult.modelVersion }
      : {}),
    promptVersion: RESOLUTION_AGENT_PROMPT_VERSION,
    schemaVersion: "agent-resolution-proposal-v1" as const,
    validatorVersion: "agent-proposal-validator-v1" as const,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    inputDigest: input.builtInput.inputDigest,
    ...(input.serviceResult.rawOutputDigest
      ? { rawOutputDigest: input.serviceResult.rawOutputDigest }
      : {}),
    suppliedPartyIds: input.builtInput.input.parties.map((record) => record.id),
    suppliedClaimIds: input.builtInput.input.claims.map((record) => record.id),
    suppliedEvidenceIds: input.builtInput.input.evidence.map(
      (record) => record.id,
    ),
    suppliedEventIds: input.builtInput.input.events.map((record) => record.id),
    suppliedVerificationGapIds:
      input.builtInput.input.verificationGaps.map((record) => record.id),
  };

  if (input.serviceResult.kind === "FAILURE") {
    return AgentRunRecordSchema.parse({
      ...base,
      outcome: input.serviceResult.outcome,
      validationErrors: [],
    });
  }

  const validation =
    input.currentCaseVersion !== input.basedOnCaseVersion
      ? {
          valid: false,
          errors: ["STALE_CASE_VERSION"] as AgentProposalValidationErrorCode[],
          retainStructuredAnalysis: true,
        }
      : validateAgentResolutionProposal(
          input.serviceResult.proposal,
          input.currentBundle,
          buildTruthGraph(input.currentBundle),
        );
  const outcome = validation.valid
    ? "SUCCEEDED_VALID"
    : "REJECTED_VALIDATION";

  return AgentRunRecordSchema.parse({
    ...base,
    outcome,
    ...(validation.retainStructuredAnalysis
      ? retainedAnalysis(input.serviceResult.proposal)
      : {}),
    validationErrors: validation.errors,
  });
}

function retainedAnalysis(proposal: AgentResolutionProposal) {
  return {
    summary: redactSensitiveText(proposal.summary),
    assessment: proposal.currentAssessment,
    blocker: {
      ...proposal.blocker,
      explanation: redactSensitiveText(proposal.blocker.explanation),
    },
    recommendedAction: {
      ...proposal.nextBestAction,
      description: redactSensitiveText(proposal.nextBestAction.description),
      rationale: redactSensitiveText(proposal.nextBestAction.rationale),
    },
    uncertainty: proposal.uncertainty.map((item) => ({
      ...item,
      explanation: redactSensitiveText(item.explanation),
    })),
    openQuestions: proposal.openQuestions.map((item) => ({
      ...item,
      question: redactSensitiveText(item.question),
    })),
    observedVerificationGapIds: proposal.observedVerificationGaps.map(
      (gap) => gap.gapId,
    ),
  };
}
