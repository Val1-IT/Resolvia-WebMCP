import { z } from "zod";

import type { AgentResolutionInput } from "@/src/application/agents/build-agent-input";
import {
  REQUIRED_APPROVAL_BY_ACTION,
  RESOLUTION_ACTION_CODES,
} from "@/src/domain/agent/policy";
import {
  AgentResolutionProposalSchema,
  type ActionType,
  type AgentResolutionProposal,
  type BlockerCode,
} from "@/src/domain/agent/model";
import type { ClaimStatus } from "@/src/domain/claims/model";

/**
 * Provider-facing structured-output transport only.
 *
 * Constraints that protect the application contract remain on
 * AgentResolutionProposalSchema and are deliberately not duplicated here.
 */
export const GeminiResolutionProposalTransportSchema = z
  .object({
    caseId: z.string(),
    basedOnCaseVersion: z.number(),
    assessmentCode: z.string(),
    rationale: z.string(),
    actionCode: z.enum(RESOLUTION_ACTION_CODES),
    targetPartyId: z.string().nullable(),
    evidenceIds: z.array(z.string()),
    verificationGapIds: z.array(z.string()),
    uncertainty: z.string(),
    openQuestions: z.array(z.string()),
  })
  .strict();

export type GeminiResolutionProposalTransport = z.infer<
  typeof GeminiResolutionProposalTransportSchema
>;

/**
 * Combines a grounded recommendation with Resolvia's deterministic read model.
 * Model output never supplies claim truth, provenance, blocker state, provider
 * verification, or derived verification-gap facts.
 */
export function canonicalizeGeminiResolutionProposal(
  transport: GeminiResolutionProposalTransport,
  input: AgentResolutionInput,
): unknown {
  const blockerClaimIds = uniqueIds([
    ...input.verificationGaps.map((gap) => gap.claimId),
    ...input.claims
      .filter((claim) => isContradicted(claim.evaluatedStatus))
      .map((claim) => claim.id),
  ]);
  const blockerEvidenceIds = uniqueIds(
    input.evidence
      .filter((evidence) =>
        evidence.relatedClaimIds.some((claimId) =>
          blockerClaimIds.includes(claimId),
        ),
      )
      .map((evidence) => evidence.id),
  );
  const groundedClaimIds = deriveGroundedClaimIds(transport, input);
  const actionType = transport.actionCode as ActionType;

  const canonical = {
    caseId: transport.caseId,
    basedOnCaseVersion: transport.basedOnCaseVersion,
    summary: transport.rationale,
    currentAssessment: deriveAssessment(input),
    blocker: {
      code: deriveBlockerCode(input),
      explanation: input.case.currentBlocker,
      claimIds: blockerClaimIds,
      evidenceIds: blockerEvidenceIds,
      verificationGapIds: input.verificationGaps.map((gap) => gap.id),
    },
    nextBestAction: {
      type: transport.actionCode,
      description: input.case.nextBestAction,
      rationale: transport.rationale,
      ...(transport.targetPartyId
        ? { targetPartyId: transport.targetPartyId }
        : {}),
      claimIds: groundedClaimIds,
      evidenceIds: transport.evidenceIds,
      verificationGapIds: transport.verificationGapIds,
      approvalLevel: REQUIRED_APPROVAL_BY_ACTION[actionType],
    },
    uncertainty: [
      {
        code: transport.assessmentCode,
        explanation: transport.uncertainty,
        relatedClaimIds: groundedClaimIds,
        evidenceIds: transport.evidenceIds,
        verificationGapIds: transport.verificationGapIds,
      },
    ],
    openQuestions: transport.openQuestions.map((question) => ({
      question,
      relatedClaimIds: groundedClaimIds,
      evidenceIds: transport.evidenceIds,
      verificationGapIds: transport.verificationGapIds,
    })),
    observedVerificationGaps: input.verificationGaps.map((gap) => ({
      gapId: gap.id,
      claimId: gap.claimId,
      expectedEvidenceId: gap.expectedEvidenceId,
      explanation: gap.label,
    })),
  };

  return canonical;
}

export function parseCanonicalGeminiResolutionProposal(
  transportInput: unknown,
  authoritativeInput: AgentResolutionInput,
): AgentResolutionProposal {
  const transport =
    GeminiResolutionProposalTransportSchema.parse(transportInput);
  return AgentResolutionProposalSchema.parse(
    canonicalizeGeminiResolutionProposal(transport, authoritativeInput),
  );
}

function deriveAssessment(input: AgentResolutionInput) {
  return {
    authenticatedAssertionClaimIds: input.claims
      .filter((claim) =>
        claim.evidenceRelationships.some(
          (relationship) =>
            relationship.kind === "AUTHENTICATES_ASSERTION",
        ),
      )
      .map((claim) => claim.id),
    supportedPropositionClaimIds: input.claims
      .filter((claim) => isSupported(claim.evaluatedStatus))
      .map((claim) => claim.id),
    contradictedPropositionClaimIds: input.claims
      .filter((claim) => isContradicted(claim.evaluatedStatus))
      .map((claim) => claim.id),
    unknownClaimIds: input.claims
      .filter((claim) => claim.evaluatedStatus === "UNVERIFIED")
      .map((claim) => claim.id),
    providerVerifiedEvidenceIds: input.evidence
      .filter(
        (evidence) =>
          evidence.verificationLevel === "PROVIDER_VERIFIED",
      )
      .map((evidence) => evidence.id),
    demoProviderVerifiedEvidenceIds: input.evidence
      .filter(
        (evidence) =>
          evidence.verificationLevel === "DEMO_PROVIDER_VERIFIED",
      )
      .map((evidence) => evidence.id),
  };
}

function deriveBlockerCode(input: AgentResolutionInput): BlockerCode {
  if (input.claims.some((claim) => isContradicted(claim.evaluatedStatus))) {
    return "CONTRADICTORY_EVIDENCE";
  }
  return input.verificationGaps.length > 0
    ? "MISSING_SUPPORTING_EVIDENCE"
    : "NO_CURRENT_BLOCKER";
}

function deriveGroundedClaimIds(
  transport: GeminiResolutionProposalTransport,
  input: AgentResolutionInput,
): string[] {
  const evidenceIds = new Set(transport.evidenceIds);
  const gapIds = new Set(transport.verificationGapIds);
  return uniqueIds([
    ...input.evidence
      .filter((evidence) => evidenceIds.has(evidence.id))
      .flatMap((evidence) => evidence.relatedClaimIds),
    ...input.verificationGaps
      .filter((gap) => gapIds.has(gap.id))
      .map((gap) => gap.claimId),
  ]);
}

function isSupported(status: ClaimStatus): boolean {
  return status === "SUPPORTED" || status === "PARTIALLY_VERIFIED";
}

function isContradicted(status: ClaimStatus): boolean {
  return status === "CONTRADICTED" || status === "PARTIALLY_VERIFIED";
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}
