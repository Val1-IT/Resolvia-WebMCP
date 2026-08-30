import {
  AgentRunRecordSchema,
  type AgentRunRecord,
} from "@/src/domain/agent/model";
import type { ResolutionSnapshot } from "@/src/domain/store/model";
import {
  GeminiResolutionProposalTransportSchema,
  type GeminiResolutionProposalTransport,
} from "@/src/infrastructure/agent/gemini-resolution-proposal-transport";
import { FIXED_NOW, initialRefundBundle } from "@/tests/fixtures/domain";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

export function makeAgentRun(
  overrides: Partial<AgentRunRecord> = {},
): AgentRunRecord {
  return AgentRunRecordSchema.parse({
    id: "agent-run-1",
    caseId: "case-rv-1028",
    basedOnCaseVersion: 4,
    agentName: "resolvia_resolution_agent",
    modelId: "gemini-2.5-flash",
    promptVersion: "resolution-agent-v1",
    schemaVersion: "agent-resolution-proposal-v1",
    validatorVersion: "agent-proposal-validator-v1",
    startedAt: FIXED_NOW,
    completedAt: FIXED_NOW,
    inputDigest: digest("a"),
    rawOutputDigest: digest("b"),
    suppliedPartyIds: ["party-customer", "party-merchant"],
    suppliedClaimIds: ["claim-refund-processed"],
    suppliedEvidenceIds: ["evidence-merchant-message"],
    suppliedEventIds: ["event-initial-evidence", "event-intake"],
    suppliedVerificationGapIds: [
      "verification-gap:claim-refund-processed",
    ],
    outcome: "SUCCEEDED_VALID",
    summary: "The authenticated assertion remains unverified.",
    assessment: {
      authenticatedAssertionClaimIds: ["claim-refund-processed"],
      supportedPropositionClaimIds: [],
      contradictedPropositionClaimIds: [],
      unknownClaimIds: ["claim-refund-processed"],
      providerVerifiedEvidenceIds: [],
      demoProviderVerifiedEvidenceIds: [],
    },
    blocker: {
      code: "MISSING_SUPPORTING_EVIDENCE",
      explanation: "Provider transaction evidence is missing.",
      claimIds: ["claim-refund-processed"],
      evidenceIds: ["evidence-merchant-message"],
      verificationGapIds: ["verification-gap:claim-refund-processed"],
    },
    recommendedAction: {
      type: "REVIEW_EXISTING_EVIDENCE",
      description: "Review the authenticated merchant message.",
      rationale: "The proposition is still unsupported.",
      claimIds: ["claim-refund-processed"],
      evidenceIds: ["evidence-merchant-message"],
      verificationGapIds: ["verification-gap:claim-refund-processed"],
      approvalLevel: "SAFE_INTERNAL",
    },
    uncertainty: [
      {
        code: "EXTERNAL_STATUS_UNKNOWN",
        explanation: "No provider record is available.",
        relatedClaimIds: ["claim-refund-processed"],
        evidenceIds: [],
        verificationGapIds: ["verification-gap:claim-refund-processed"],
      },
    ],
    openQuestions: [
      {
        question: "Does the provider have a refund transaction?",
        relatedClaimIds: ["claim-refund-processed"],
        evidenceIds: [],
        verificationGapIds: ["verification-gap:claim-refund-processed"],
      },
    ],
    observedVerificationGapIds: [
      "verification-gap:claim-refund-processed",
    ],
    validationErrors: [],
    ...overrides,
  });
}

export function snapshotForAgentRuns(): ResolutionSnapshot {
  const bundle = initialRefundBundle();
  return {
    cases: [bundle.caseRecord],
    events: bundle.events,
    evidence: bundle.evidence,
    claims: bundle.claims,
    auditRecords: bundle.auditRecords,
    providerTransactions: bundle.providerTransactions,
    agentRuns: [],
  };
}

export function makeGeminiTransportProposal(
  overrides: Partial<GeminiResolutionProposalTransport> = {},
): GeminiResolutionProposalTransport {
  return GeminiResolutionProposalTransportSchema.parse({
    caseId: "case-rv-1028",
    basedOnCaseVersion: 4,
    assessmentCode: "EXTERNAL_STATUS_UNKNOWN",
    rationale: "The authenticated assertion remains unverified.",
    actionCode: "REVIEW_EXISTING_EVIDENCE",
    targetPartyId: null,
    evidenceIds: ["evidence-merchant-message"],
    verificationGapIds: ["verification-gap:claim-refund-processed"],
    uncertainty: "No provider record is available.",
    openQuestions: ["Does the provider have a refund transaction?"],
    ...overrides,
  });
}
