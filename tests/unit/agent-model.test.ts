import { describe, expect, it } from "vitest";

import {
  AgentResolutionProposalSchema,
  AgentRunMutationSchema,
  AgentRunRecordSchema,
  type AgentResolutionProposal,
  type AgentRunRecord,
} from "@/src/domain/agent/model";
import { ResolutionSnapshotSchema } from "@/src/domain/store/model";
import { FIXED_NOW, makeCase } from "@/tests/fixtures/domain";

const digest = `sha256:${"a".repeat(64)}`;
const rawDigest = `sha256:${"b".repeat(64)}`;

function makeProposal(
  overrides: Partial<AgentResolutionProposal> = {},
): AgentResolutionProposal {
  return {
    caseId: "case-rv-1028",
    basedOnCaseVersion: 4,
    summary: "The merchant assertion is authenticated but remains unverified.",
    currentAssessment: {
      authenticatedAssertionClaimIds: ["claim-refund-processed"],
      supportedPropositionClaimIds: [],
      contradictedPropositionClaimIds: [],
      unknownClaimIds: ["claim-refund-processed"],
      providerVerifiedEvidenceIds: [],
      demoProviderVerifiedEvidenceIds: [],
    },
    blocker: {
      code: "MISSING_SUPPORTING_EVIDENCE",
      explanation: "No provider evidence supports the refund proposition.",
      claimIds: ["claim-refund-processed"],
      evidenceIds: ["evidence-merchant-message"],
      verificationGapIds: ["gap-refund-transaction"],
    },
    nextBestAction: {
      type: "REVIEW_EXISTING_EVIDENCE",
      description: "Review the authenticated merchant assertion.",
      rationale: "Provider evidence is still missing.",
      claimIds: ["claim-refund-processed"],
      evidenceIds: ["evidence-merchant-message"],
      verificationGapIds: ["gap-refund-transaction"],
      approvalLevel: "SAFE_INTERNAL",
    },
    openQuestions: [
      {
        question: "Does a provider refund transaction exist?",
        relatedClaimIds: ["claim-refund-processed"],
        evidenceIds: [],
        verificationGapIds: ["gap-refund-transaction"],
      },
    ],
    uncertainty: [
      {
        code: "EXTERNAL_STATUS_UNKNOWN",
        explanation: "The payment provider has not supplied evidence.",
        relatedClaimIds: ["claim-refund-processed"],
        evidenceIds: [],
        verificationGapIds: ["gap-refund-transaction"],
      },
    ],
    observedVerificationGaps: [
      {
        gapId: "gap-refund-transaction",
        claimId: "claim-refund-processed",
        expectedEvidenceId: "expected-provider-refund-transaction",
        explanation: "A provider transaction is expected but not present.",
      },
    ],
    ...overrides,
  };
}

function makeRun(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
  const proposal = makeProposal();
  return {
    id: "agent-run-1",
    caseId: proposal.caseId,
    basedOnCaseVersion: proposal.basedOnCaseVersion,
    agentName: "resolvia_resolution_agent",
    modelId: "gemini-2.5-flash",
    promptVersion: "resolution-agent-v1",
    schemaVersion: "agent-resolution-proposal-v1",
    validatorVersion: "agent-proposal-validator-v1",
    startedAt: FIXED_NOW,
    completedAt: FIXED_NOW,
    inputDigest: digest,
    suppliedPartyIds: ["party-merchant"],
    suppliedClaimIds: ["claim-refund-processed"],
    suppliedEvidenceIds: ["evidence-merchant-message"],
    suppliedEventIds: ["event-initial-evidence"],
    suppliedVerificationGapIds: ["gap-refund-transaction"],
    outcome: "SUCCEEDED_VALID",
    summary: proposal.summary,
    assessment: proposal.currentAssessment,
    blocker: proposal.blocker,
    recommendedAction: proposal.nextBestAction,
    uncertainty: proposal.uncertainty,
    openQuestions: proposal.openQuestions,
    observedVerificationGapIds: ["gap-refund-transaction"],
    validationErrors: [],
    ...overrides,
  };
}

const structuredFields = {
  summary: undefined,
  assessment: undefined,
  blocker: undefined,
  recommendedAction: undefined,
  uncertainty: undefined,
  openQuestions: undefined,
  observedVerificationGapIds: undefined,
};

describe("AgentResolutionProposalSchema", () => {
  it("accepts the complete strict proposal contract", () => {
    expect(AgentResolutionProposalSchema.parse(makeProposal())).toEqual(
      makeProposal(),
    );
  });

  it("rejects unknown authoritative mutation fields", () => {
    expect(
      AgentResolutionProposalSchema.safeParse({
        ...makeProposal(),
        targetState: "RESOLVED",
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate, excessive, and overlong IDs", () => {
    const duplicate = makeProposal({
      currentAssessment: {
        ...makeProposal().currentAssessment,
        unknownClaimIds: [
          "claim-refund-processed",
          "claim-refund-processed",
        ],
      },
    });
    const excessive = makeProposal({
      currentAssessment: {
        ...makeProposal().currentAssessment,
        unknownClaimIds: Array.from({ length: 51 }, (_, index) => `claim-${index}`),
      },
    });
    const overlong = makeProposal({ caseId: "x".repeat(129) });

    expect(AgentResolutionProposalSchema.safeParse(duplicate).success).toBe(
      false,
    );
    expect(AgentResolutionProposalSchema.safeParse(excessive).success).toBe(
      false,
    );
    expect(AgentResolutionProposalSchema.safeParse(overlong).success).toBe(
      false,
    );
  });
});

describe("AgentRunRecordSchema", () => {
  it("accepts both legacy V1 and hardened V2 prompt audit versions", () => {
    expect(AgentRunRecordSchema.safeParse(makeRun()).success).toBe(true);
    expect(
      AgentRunRecordSchema.safeParse({
        ...makeRun(),
        promptVersion: "resolution-agent-v2",
      }).success,
    ).toBe(true);
  });
  it("accepts SUCCEEDED_VALID only with complete analysis and no errors", () => {
    expect(AgentRunRecordSchema.safeParse(makeRun()).success).toBe(true);
    expect(
      AgentRunRecordSchema.safeParse(
        makeRun({ summary: undefined, validationErrors: ["ASSESSMENT_MISMATCH"] }),
      ).success,
    ).toBe(false);
  });

  it("permits retained structured analysis for a same-case semantic rejection", () => {
    const rejected = makeRun({
      outcome: "REJECTED_VALIDATION",
      rawOutputDigest: rawDigest,
      validationErrors: ["ASSESSMENT_MISMATCH"],
    });

    expect(AgentRunRecordSchema.safeParse(rejected).success).toBe(true);
  });

  it("requires reference-unsafe rejections to retain only digest and metadata", () => {
    const safeRejected = makeRun({
      ...structuredFields,
      outcome: "REJECTED_VALIDATION",
      rawOutputDigest: rawDigest,
      validationErrors: ["CROSS_CASE_EVIDENCE_REFERENCE"],
    });

    expect(AgentRunRecordSchema.safeParse(safeRejected).success).toBe(true);
    expect(
      AgentRunRecordSchema.safeParse({
        ...safeRejected,
        summary: "Unsafe retained narrative",
      }).success,
    ).toBe(false);
    expect(
      AgentRunRecordSchema.safeParse({
        ...safeRejected,
        rawOutputDigest: undefined,
      }).success,
    ).toBe(false);
  });

  it("accepts all six technical failures without analysis or validation errors", () => {
    const outcomes = [
      "FAILED_CONFIGURATION",
      "FAILED_TIMEOUT",
      "FAILED_NETWORK",
      "FAILED_QUOTA",
      "FAILED_MALFORMED_OUTPUT",
      "FAILED_SCHEMA",
    ] as const;

    for (const outcome of outcomes) {
      const failed = makeRun({
        ...structuredFields,
        outcome,
        rawOutputDigest:
          outcome === "FAILED_MALFORMED_OUTPUT" || outcome === "FAILED_SCHEMA"
            ? rawDigest
            : undefined,
        validationErrors: [],
      });
      expect(AgentRunRecordSchema.safeParse(failed).success, outcome).toBe(true);
      expect(
        AgentRunRecordSchema.safeParse({
          ...failed,
          summary: "Must not be retained",
        }).success,
        outcome,
      ).toBe(false);
    }
  });

  it("rejects extra fields and invalid digests", () => {
    expect(
      AgentRunRecordSchema.safeParse({ ...makeRun(), rawOutput: "secret" })
        .success,
    ).toBe(false);
    expect(
      AgentRunRecordSchema.safeParse(makeRun({ inputDigest: "not-a-digest" }))
        .success,
    ).toBe(false);
  });
});

describe("AgentRunMutationSchema", () => {
  it("accepts only one append against an explicit existing case version", () => {
    expect(
      AgentRunMutationSchema.parse({
        agentRun: makeRun(),
        expectedCaseVersion: 4,
      }).expectedCaseVersion,
    ).toBe(4);
  });
});

describe("ResolutionSnapshotSchema migration", () => {
  it("defaults a Phase 1-3 snapshot to an empty AgentRun collection", () => {
    const parsed = ResolutionSnapshotSchema.parse({
      cases: [makeCase()],
      events: [],
      evidence: [],
      claims: [],
      auditRecords: [],
    });

    expect(parsed.agentRuns).toEqual([]);
  });
});
