import { describe, expect, it } from "vitest";

import { validateAgentResolutionProposal } from "@/src/application/agents/validate-agent-proposal";
import {
  AgentResolutionProposalSchema,
  type ActionType,
  type AgentResolutionProposal,
  type ApprovalLevel,
} from "@/src/domain/agent/model";
import { buildTruthGraph } from "@/src/domain/truth-graph/build-truth-graph";
import { makeAgentRun } from "@/tests/fixtures/agent";
import {
  initialRefundBundle,
  makeEvidence,
} from "@/tests/fixtures/domain";

function makeProposal(
  overrides: Partial<AgentResolutionProposal> = {},
): AgentResolutionProposal {
  const run = makeAgentRun();
  return AgentResolutionProposalSchema.parse({
    caseId: run.caseId,
    basedOnCaseVersion: run.basedOnCaseVersion,
    summary: run.summary,
    currentAssessment: run.assessment,
    blocker: run.blocker,
    nextBestAction: run.recommendedAction,
    openQuestions: run.openQuestions,
    uncertainty: run.uncertainty,
    observedVerificationGaps: [
      {
        gapId: "verification-gap:claim-refund-processed",
        claimId: "claim-refund-processed",
        expectedEvidenceId: "expected-evidence:claim-refund-processed",
        explanation: "Supporting provider evidence is absent.",
      },
    ],
    ...overrides,
  });
}

function validate(
  proposal = makeProposal(),
  bundle = initialRefundBundle(),
) {
  return validateAgentResolutionProposal(
    proposal,
    bundle,
    buildTruthGraph(bundle),
  );
}

describe("validateAgentResolutionProposal", () => {
  it("accepts authenticated assertion as authenticated and still unknown", () => {
    expect(validate()).toEqual({
      valid: true,
      errors: [],
      retainStructuredAnalysis: true,
    });
  });

  it("returns stable identity and freshness errors", () => {
    const result = validate(
      makeProposal({ caseId: "case-other", basedOnCaseVersion: 3 }),
    );

    expect(result).toEqual({
      valid: false,
      errors: ["CASE_ID_MISMATCH", "STALE_CASE_VERSION"],
      retainStructuredAnalysis: true,
    });
  });

  it("fails closed and discards analysis for a missing reference", () => {
    const proposal = makeProposal({
      blocker: {
        ...makeProposal().blocker,
        evidenceIds: ["evidence-hallucinated"],
      },
    });

    expect(validate(proposal)).toMatchObject({
      valid: false,
      errors: ["MISSING_REFERENCE"],
      retainStructuredAnalysis: false,
    });
  });

  it("distinguishes a cross-case evidence reference and discards analysis", () => {
    const bundle = initialRefundBundle();
    bundle.evidence.push(
      makeEvidence({
        id: "evidence-other-case",
        caseId: "case-other",
        relatedClaimIds: [],
      }),
    );
    const proposal = makeProposal({
      nextBestAction: {
        ...makeProposal().nextBestAction,
        evidenceIds: ["evidence-other-case"],
      },
    });

    expect(validate(proposal, bundle)).toEqual({
      valid: false,
      errors: ["CROSS_CASE_EVIDENCE_REFERENCE"],
      retainStructuredAnalysis: false,
    });
  });

  it("rejects authentication, UNKNOWN, and provider-verification promotion", () => {
    const proposal = makeProposal({
      currentAssessment: {
        authenticatedAssertionClaimIds: ["claim-refund-processed"],
        supportedPropositionClaimIds: ["claim-refund-processed"],
        contradictedPropositionClaimIds: [],
        unknownClaimIds: [],
        providerVerifiedEvidenceIds: ["evidence-merchant-message"],
        demoProviderVerifiedEvidenceIds: [],
      },
    });

    expect(validate(proposal).errors).toEqual([
      "ASSESSMENT_MISMATCH",
      "PROVIDER_VERIFICATION_PROMOTION",
      "AUTHENTICATION_TRUTH_PROMOTION",
      "UNKNOWN_PROMOTION",
    ]);
  });

  it("derives provider-verified evidence only from the stored record", () => {
    const bundle = initialRefundBundle();
    bundle.evidence[0] = makeEvidence({
      verificationLevel: "PROVIDER_VERIFIED",
    });
    const proposal = makeProposal({
      currentAssessment: {
        ...makeProposal().currentAssessment,
        providerVerifiedEvidenceIds: ["evidence-merchant-message"],
      },
    });

    expect(validate(proposal, bundle).valid).toBe(true);
  });

  it("keeps Demo Provider evidence out of the real-provider assessment", () => {
    const bundle = initialRefundBundle();
    bundle.evidence[0] = makeEvidence({
      verificationLevel: "DEMO_PROVIDER_VERIFIED",
      sourceProvider: "resolvia_demo_provider",
    });
    const proposal = makeProposal({
      currentAssessment: {
        ...makeProposal().currentAssessment,
        providerVerifiedEvidenceIds: ["evidence-merchant-message"],
      },
    });

    expect(validate(proposal, bundle)).toEqual({
      valid: false,
      errors: ["ASSESSMENT_MISMATCH", "PROVIDER_VERIFICATION_PROMOTION"],
      retainStructuredAnalysis: true,
    });
  });
  it("rejects unknown or mismatched derived verification gaps", () => {
    const proposal = makeProposal({
      observedVerificationGaps: [
        {
          ...makeProposal().observedVerificationGaps[0]!,
          expectedEvidenceId: "expected-evidence:hallucinated",
        },
      ],
    });

    expect(validate(proposal)).toMatchObject({
      valid: false,
      errors: ["UNKNOWN_VERIFICATION_GAP"],
      retainStructuredAnalysis: false,
    });
  });

  it("rejects NO_CURRENT_BLOCKER while a proposition gap remains", () => {
    const proposal = makeProposal({
      blocker: {
        ...makeProposal().blocker,
        code: "NO_CURRENT_BLOCKER",
      },
    });

    expect(validate(proposal).errors).toContain("ASSESSMENT_MISMATCH");
  });

  it.each([
    ["REVIEW_EXISTING_EVIDENCE", "SAFE_INTERNAL", undefined],
    ["WAIT_FOR_NEW_EVIDENCE", "SAFE_INTERNAL", undefined],
    ["REQUEST_USER_EVIDENCE", "USER_APPROVAL_REQUIRED", "party-customer"],
    [
      "PREPARE_EXTERNAL_FOLLOW_UP",
      "USER_APPROVAL_REQUIRED",
      "party-merchant",
    ],
    ["REFER_TO_HUMAN_REVIEW", "USER_APPROVAL_REQUIRED", undefined],
    ["NO_PERMITTED_ACTION", "OUT_OF_SCOPE_HIGH_RISK", undefined],
  ] as const)(
    "accepts %s only with its deterministic approval and target policy",
    (type, approvalLevel, targetPartyId) => {
      const proposal = proposalForAction(type, approvalLevel, targetPartyId);

      expect(validate(proposal).valid).toBe(true);
    },
  );

  it.each([
    ["REVIEW_EXISTING_EVIDENCE", "USER_APPROVAL_REQUIRED"],
    ["WAIT_FOR_NEW_EVIDENCE", "USER_APPROVAL_REQUIRED"],
    ["REQUEST_USER_EVIDENCE", "SAFE_INTERNAL"],
    ["PREPARE_EXTERNAL_FOLLOW_UP", "SAFE_INTERNAL"],
    ["REFER_TO_HUMAN_REVIEW", "SAFE_INTERNAL"],
    ["NO_PERMITTED_ACTION", "SAFE_INTERNAL"],
  ] as const)("rejects the wrong approval for %s", (type, approvalLevel) => {
    const validTarget =
      type === "REQUEST_USER_EVIDENCE"
        ? "party-customer"
        : type === "PREPARE_EXTERNAL_FOLLOW_UP"
          ? "party-merchant"
          : undefined;
    const proposal = proposalForAction(type, approvalLevel, validTarget);

    expect(validate(proposal).errors).toContain("APPROVAL_LEVEL_MISMATCH");
  });

  it("rejects invalid action target and missing wait gap", () => {
    const wrongCustomer = proposalForAction(
      "REQUEST_USER_EVIDENCE",
      "USER_APPROVAL_REQUIRED",
      "party-merchant",
    );
    const waitWithoutGap = proposalForAction(
      "WAIT_FOR_NEW_EVIDENCE",
      "SAFE_INTERNAL",
      undefined,
      [],
    );

    expect(validate(wrongCustomer).errors).toContain("ACTION_NOT_ALLOWED");
    expect(validate(waitWithoutGap).errors).toContain("ACTION_NOT_ALLOWED");
  });

  it("rejects transition fields structurally before deterministic validation", () => {
    expect(
      AgentResolutionProposalSchema.safeParse({
        ...makeProposal(),
        transitionTo: "RESOLVED",
      }).success,
    ).toBe(false);
  });
});

function proposalForAction(
  type: ActionType,
  approvalLevel: ApprovalLevel,
  targetPartyId?: string,
  verificationGapIds = ["verification-gap:claim-refund-processed"],
): AgentResolutionProposal {
  const current = makeProposal().nextBestAction;
  return makeProposal({
    nextBestAction: {
      ...current,
      type,
      approvalLevel,
      verificationGapIds,
      ...(targetPartyId ? { targetPartyId } : {}),
    },
  });
}
