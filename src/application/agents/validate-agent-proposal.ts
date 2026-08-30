import {
  REQUIRED_APPROVAL_BY_ACTION,
  actionRequiresTarget,
} from "@/src/domain/agent/policy";
import type {
  AgentProposalValidationErrorCode,
  AgentResolutionProposal,
} from "@/src/domain/agent/model";
import { evaluateClaimStatus } from "@/src/domain/claims/model";
import type { ResolutionCaseBundle } from "@/src/domain/store/model";
import type { TruthGraph } from "@/src/domain/truth-graph/model";

const ERROR_ORDER: AgentProposalValidationErrorCode[] = [
  "CASE_ID_MISMATCH",
  "STALE_CASE_VERSION",
  "MISSING_REFERENCE",
  "CROSS_CASE_REFERENCE",
  "CROSS_CASE_EVIDENCE_REFERENCE",
  "UNKNOWN_VERIFICATION_GAP",
  "ASSESSMENT_MISMATCH",
  "PROVIDER_VERIFICATION_PROMOTION",
  "AUTHENTICATION_TRUTH_PROMOTION",
  "UNKNOWN_PROMOTION",
  "ACTION_NOT_ALLOWED",
  "APPROVAL_LEVEL_MISMATCH",
];

const REFERENCE_ERRORS = new Set<AgentProposalValidationErrorCode>([
  "MISSING_REFERENCE",
  "CROSS_CASE_REFERENCE",
  "CROSS_CASE_EVIDENCE_REFERENCE",
  "UNKNOWN_VERIFICATION_GAP",
]);

export type AgentProposalValidationResult = {
  valid: boolean;
  errors: AgentProposalValidationErrorCode[];
  retainStructuredAnalysis: boolean;
};

export function validateAgentResolutionProposal(
  proposal: AgentResolutionProposal,
  bundle: ResolutionCaseBundle,
  truthGraph: TruthGraph,
): AgentProposalValidationResult {
  const found = new Set<AgentProposalValidationErrorCode>();
  const add = (error: AgentProposalValidationErrorCode) => found.add(error);
  const caseId = bundle.caseRecord.id;

  if (proposal.caseId !== caseId) add("CASE_ID_MISMATCH");
  if (proposal.basedOnCaseVersion !== bundle.caseRecord.version) {
    add("STALE_CASE_VERSION");
  }

  validateReferences(proposal, bundle, truthGraph, add);
  validateAssessment(proposal, bundle, add);
  validateVerificationGaps(proposal, bundle, truthGraph, add);
  validateBlocker(proposal, bundle, truthGraph, add);
  validateAction(proposal, bundle, add);

  const errors = ERROR_ORDER.filter((error) => found.has(error));
  return {
    valid: errors.length === 0,
    errors,
    retainStructuredAnalysis: !errors.some((error) =>
      REFERENCE_ERRORS.has(error),
    ),
  };
}

type AddError = (error: AgentProposalValidationErrorCode) => void;

function validateReferences(
  proposal: AgentResolutionProposal,
  bundle: ResolutionCaseBundle,
  truthGraph: TruthGraph,
  add: AddError,
): void {
  const caseId = bundle.caseRecord.id;
  const parties = new Map(
    bundle.caseRecord.parties.map((record) => [record.id, record]),
  );
  const claims = new Map(bundle.claims.map((record) => [record.id, record]));
  const evidence = new Map(
    bundle.evidence.map((record) => [record.id, record]),
  );

  for (const id of collectClaimIds(proposal)) {
    const record = claims.get(id);
    if (!record) add("MISSING_REFERENCE");
    else if (record.caseId !== caseId) add("CROSS_CASE_REFERENCE");
  }

  for (const id of collectEvidenceIds(proposal)) {
    const record = evidence.get(id);
    if (!record) add("MISSING_REFERENCE");
    else if (record.caseId !== caseId) add("CROSS_CASE_EVIDENCE_REFERENCE");
  }

  const targetPartyId = proposal.nextBestAction.targetPartyId;
  if (targetPartyId) {
    const party = parties.get(targetPartyId);
    if (!party) add("MISSING_REFERENCE");
    else if (party.caseId !== caseId) add("CROSS_CASE_REFERENCE");
  }

  const nodes = new Map(truthGraph.nodes.map((node) => [node.id, node]));
  for (const gapId of collectGapIds(proposal)) {
    const node = nodes.get(gapId);
    if (!isDerivedPlaceholder(node, "VERIFICATION_GAP")) {
      add("UNKNOWN_VERIFICATION_GAP");
    }
  }
}

function validateAssessment(
  proposal: AgentResolutionProposal,
  bundle: ResolutionCaseBundle,
  add: AddError,
): void {
  const authenticated = bundle.claims
    .filter((claim) =>
      claim.evidenceRelationships.some(
        (relationship) => relationship.kind === "AUTHENTICATES_ASSERTION",
      ),
    )
    .map((claim) => claim.id);
  const supported = bundle.claims
    .filter((claim) => {
      const status = evaluateClaimStatus(claim);
      return status === "SUPPORTED" || status === "PARTIALLY_VERIFIED";
    })
    .map((claim) => claim.id);
  const contradicted = bundle.claims
    .filter((claim) => {
      const status = evaluateClaimStatus(claim);
      return status === "CONTRADICTED" || status === "PARTIALLY_VERIFIED";
    })
    .map((claim) => claim.id);
  const unknown = bundle.claims
    .filter((claim) => evaluateClaimStatus(claim) === "UNVERIFIED")
    .map((claim) => claim.id);
  const providerVerified = bundle.evidence
    .filter((record) => record.verificationLevel === "PROVIDER_VERIFIED")
    .map((record) => record.id);
  const demoProviderVerified = bundle.evidence
    .filter((record) => record.verificationLevel === "DEMO_PROVIDER_VERIFIED")
    .map((record) => record.id);

  const proposed = proposal.currentAssessment;
  if (
    !sameSet(proposed.authenticatedAssertionClaimIds, authenticated) ||
    !sameSet(proposed.supportedPropositionClaimIds, supported) ||
    !sameSet(proposed.contradictedPropositionClaimIds, contradicted) ||
    !sameSet(proposed.unknownClaimIds, unknown) ||
    !sameSet(proposed.providerVerifiedEvidenceIds, providerVerified) ||
    !sameSet(proposed.demoProviderVerifiedEvidenceIds, demoProviderVerified)
  ) {
    add("ASSESSMENT_MISMATCH");
  }

  const evidenceById = new Map(
    bundle.evidence.map((record) => [record.id, record]),
  );
  if (
    proposed.providerVerifiedEvidenceIds.some(
      (id) =>
        evidenceById.get(id)?.verificationLevel !== "PROVIDER_VERIFIED",
    )
  ) {
    add("PROVIDER_VERIFICATION_PROMOTION");
  }
  if (
    proposed.demoProviderVerifiedEvidenceIds.some(
      (id) =>
        evidenceById.get(id)?.verificationLevel !== "DEMO_PROVIDER_VERIFIED",
    )
  ) {
    add("PROVIDER_VERIFICATION_PROMOTION");
  }

  const authenticatedSet = new Set(authenticated);
  const unknownSet = new Set(unknown);
  if (
    proposed.supportedPropositionClaimIds.some(
      (id) => authenticatedSet.has(id) && unknownSet.has(id),
    )
  ) {
    add("AUTHENTICATION_TRUTH_PROMOTION");
  }
  if (
    !sameSet(proposed.unknownClaimIds, unknown) ||
    proposed.supportedPropositionClaimIds.some((id) => unknownSet.has(id)) ||
    proposed.contradictedPropositionClaimIds.some((id) => unknownSet.has(id))
  ) {
    add("UNKNOWN_PROMOTION");
  }
}

function validateVerificationGaps(
  proposal: AgentResolutionProposal,
  bundle: ResolutionCaseBundle,
  truthGraph: TruthGraph,
  add: AddError,
): void {
  const nodes = new Map(truthGraph.nodes.map((node) => [node.id, node]));
  const claimIds = new Set(
    bundle.claims
      .filter((claim) => claim.caseId === bundle.caseRecord.id)
      .map((claim) => claim.id),
  );

  for (const gap of proposal.observedVerificationGaps) {
    const gapNode = nodes.get(gap.gapId);
    const expectedNode = nodes.get(gap.expectedEvidenceId);
    const hasGapEdge = truthGraph.edges.some(
      (edge) =>
        edge.kind === "RESULTED_IN" &&
        edge.from === gap.claimId &&
        edge.to === gap.gapId,
    );
    const hasExpectedEdge = truthGraph.edges.some(
      (edge) =>
        edge.kind === "EXPECTED_TO_VERIFY" &&
        edge.from === gap.expectedEvidenceId &&
        edge.to === gap.claimId,
    );

    if (
      !claimIds.has(gap.claimId) ||
      !isDerivedPlaceholder(gapNode, "VERIFICATION_GAP") ||
      !isDerivedPlaceholder(expectedNode, "EXPECTED_EVIDENCE") ||
      !hasGapEdge ||
      !hasExpectedEdge
    ) {
      add("UNKNOWN_VERIFICATION_GAP");
    }
  }
}

function validateBlocker(
  proposal: AgentResolutionProposal,
  bundle: ResolutionCaseBundle,
  truthGraph: TruthGraph,
  add: AddError,
): void {
  if (proposal.blocker.code === "MISSING_SUPPORTING_EVIDENCE") {
    const claimsById = new Map(
      bundle.claims.map((claim) => [claim.id, claim]),
    );
    const hasUnsupportedClaim = proposal.blocker.claimIds.some((id) => {
      const claim = claimsById.get(id);
      return claim ? evaluateClaimStatus(claim) !== "SUPPORTED" : false;
    });
    const hasMatchingGap = proposal.blocker.verificationGapIds.some((gapId) =>
      proposal.blocker.claimIds.some((claimId) =>
        truthGraph.edges.some(
          (edge) =>
            edge.kind === "RESULTED_IN" &&
            edge.from === claimId &&
            edge.to === gapId,
        ),
      ),
    );
    if (!hasUnsupportedClaim || !hasMatchingGap) add("ASSESSMENT_MISMATCH");
  }

  if (proposal.blocker.code === "NO_CURRENT_BLOCKER") {
    const hasGap = truthGraph.nodes.some(
      (node) =>
        node.kind === "VERIFICATION_GAP" &&
        node.source === "DERIVED" &&
        !node.authoritative,
    );
    const hasContradiction = bundle.claims.some((claim) => {
      const status = evaluateClaimStatus(claim);
      return status === "CONTRADICTED" || status === "PARTIALLY_VERIFIED";
    });
    if (hasGap || hasContradiction) add("ASSESSMENT_MISMATCH");
  }
}

function validateAction(
  proposal: AgentResolutionProposal,
  bundle: ResolutionCaseBundle,
  add: AddError,
): void {
  const action = proposal.nextBestAction;
  if (action.approvalLevel !== REQUIRED_APPROVAL_BY_ACTION[action.type]) {
    add("APPROVAL_LEVEL_MISMATCH");
  }

  const target = action.targetPartyId
    ? bundle.caseRecord.parties.find((party) => party.id === action.targetPartyId)
    : undefined;

  if (actionRequiresTarget(action.type)) {
    if (!target) {
      add("ACTION_NOT_ALLOWED");
    } else if (
      action.type === "REQUEST_USER_EVIDENCE" &&
      target.kind !== "CUSTOMER"
    ) {
      add("ACTION_NOT_ALLOWED");
    } else if (
      action.type === "PREPARE_EXTERNAL_FOLLOW_UP" &&
      target.kind === "CUSTOMER"
    ) {
      add("ACTION_NOT_ALLOWED");
    }
  } else if (action.targetPartyId !== undefined) {
    add("ACTION_NOT_ALLOWED");
  }

  if (
    action.type === "WAIT_FOR_NEW_EVIDENCE" &&
    action.verificationGapIds.length === 0
  ) {
    add("ACTION_NOT_ALLOWED");
  }
}

function collectClaimIds(proposal: AgentResolutionProposal): string[] {
  return [
    ...proposal.currentAssessment.authenticatedAssertionClaimIds,
    ...proposal.currentAssessment.supportedPropositionClaimIds,
    ...proposal.currentAssessment.contradictedPropositionClaimIds,
    ...proposal.currentAssessment.unknownClaimIds,
    ...proposal.blocker.claimIds,
    ...proposal.nextBestAction.claimIds,
    ...proposal.openQuestions.flatMap((item) => item.relatedClaimIds),
    ...proposal.uncertainty.flatMap((item) => item.relatedClaimIds),
    ...proposal.observedVerificationGaps.map((item) => item.claimId),
  ];
}

function collectEvidenceIds(proposal: AgentResolutionProposal): string[] {
  return [
    ...proposal.currentAssessment.providerVerifiedEvidenceIds,
    ...proposal.currentAssessment.demoProviderVerifiedEvidenceIds,
    ...proposal.blocker.evidenceIds,
    ...proposal.nextBestAction.evidenceIds,
    ...proposal.openQuestions.flatMap((item) => item.evidenceIds),
    ...proposal.uncertainty.flatMap((item) => item.evidenceIds),
  ];
}

function collectGapIds(proposal: AgentResolutionProposal): string[] {
  return [
    ...proposal.blocker.verificationGapIds,
    ...proposal.nextBestAction.verificationGapIds,
    ...proposal.openQuestions.flatMap((item) => item.verificationGapIds),
    ...proposal.uncertainty.flatMap((item) => item.verificationGapIds),
    ...proposal.observedVerificationGaps.map((item) => item.gapId),
  ];
}

function isDerivedPlaceholder(
  node: TruthGraph["nodes"][number] | undefined,
  kind: "VERIFICATION_GAP" | "EXPECTED_EVIDENCE",
): boolean {
  return Boolean(
    node &&
      node.kind === kind &&
      node.source === "DERIVED" &&
      !node.authoritative &&
      node.placeholder,
  );
}

function sameSet(actual: string[], expected: string[]): boolean {
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  return (
    sortedActual.length === sortedExpected.length &&
    sortedActual.every((value, index) => value === sortedExpected[index])
  );
}
