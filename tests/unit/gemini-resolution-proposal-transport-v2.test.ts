import { LlmAgent } from "@google/adk";
import { describe, expect, it } from "vitest";

import { buildAgentResolutionInput } from "@/src/application/agents/build-agent-input";
import { validateAgentResolutionProposal } from "@/src/application/agents/validate-agent-proposal";
import { AgentResolutionProposalSchema } from "@/src/domain/agent/model";
import { buildTruthGraph } from "@/src/domain/truth-graph/build-truth-graph";
import {
  GeminiResolutionProposalTransportSchema,
  canonicalizeGeminiResolutionProposal,
  type GeminiResolutionProposalTransport,
} from "@/src/infrastructure/agent/gemini-resolution-proposal-transport";
import { initialRefundBundle, makeEvidence } from "@/tests/fixtures/domain";

const TRANSPORT_KEYS = [
  "actionCode",
  "assessmentCode",
  "basedOnCaseVersion",
  "caseId",
  "evidenceIds",
  "openQuestions",
  "rationale",
  "targetPartyId",
  "uncertainty",
  "verificationGapIds",
] as const;

function makeTransport(
  overrides: Partial<GeminiResolutionProposalTransport> = {},
): GeminiResolutionProposalTransport {
  return GeminiResolutionProposalTransportSchema.parse({
    caseId: "case-rv-1028",
    basedOnCaseVersion: 4,
    assessmentCode: "EXTERNAL_STATUS_UNKNOWN",
    rationale:
      "The authenticated merchant assertion does not verify refund execution.",
    actionCode: "REVIEW_EXISTING_EVIDENCE",
    targetPartyId: null,
    evidenceIds: ["evidence-merchant-message"],
    verificationGapIds: ["verification-gap:claim-refund-processed"],
    uncertainty: "Provider refund evidence remains unavailable.",
    openQuestions: ["Does the provider have a refund transaction?"],
    ...overrides,
  });
}

function canonicalize(
  overrides: Partial<GeminiResolutionProposalTransport> = {},
) {
  const bundle = initialRefundBundle();
  const built = buildAgentResolutionInput(bundle);
  return {
    bundle,
    built,
    proposal: AgentResolutionProposalSchema.parse(
      canonicalizeGeminiResolutionProposal(
        makeTransport(overrides),
        built.input,
      ),
    ),
  };
}

describe("Gemini Resolution Proposal Transport V2", () => {
  it("exposes only one ultra-small recommendation and grounding object", () => {
    const transport = makeTransport();

    expect(Object.keys(transport).sort()).toEqual(TRANSPORT_KEYS);
    expect(transport).not.toHaveProperty("supportedClaimIds");
    expect(transport).not.toHaveProperty("authenticatedClaimIds");
    expect(transport).not.toHaveProperty("blocker");
    expect(transport).not.toHaveProperty("nextBestAction");
    expect(
      GeminiResolutionProposalTransportSchema.safeParse({
        ...transport,
        supportedClaimIds: ["claim-refund-processed"],
      }).success,
    ).toBe(false);
  });

  it("meets the shallow provider-schema engineering targets", () => {
    const agent = new LlmAgent({
      name: "transport_v2_schema_metric",
      model: "gemini-test-model",
      outputSchema: GeminiResolutionProposalTransportSchema,
    });
    const metrics = schemaMetrics(agent.outputSchema);

    expect(metrics.bytes).toBeLessThanOrEqual(1_200);
    expect(metrics.typedNodes).toBeLessThanOrEqual(25);
    expect(metrics.arrays).toBeLessThanOrEqual(6);
    expect(metrics.objectGroups).toBe(1);
    expect(metrics.enums).toBe(1);
    expect(metrics.constraints).toBe(0);
  });

  it("reconstructs claim truth, blocker, gaps, and policy from Resolvia data", () => {
    const { built, proposal } = canonicalize();

    expect(proposal.currentAssessment).toEqual({
      authenticatedAssertionClaimIds: ["claim-refund-processed"],
      supportedPropositionClaimIds: [],
      contradictedPropositionClaimIds: [],
      unknownClaimIds: ["claim-refund-processed"],
      providerVerifiedEvidenceIds: [],
      demoProviderVerifiedEvidenceIds: [],
    });
    expect(proposal.blocker).toEqual({
      code: "MISSING_SUPPORTING_EVIDENCE",
      explanation: built.input.case.currentBlocker,
      claimIds: ["claim-refund-processed"],
      evidenceIds: ["evidence-merchant-message"],
      verificationGapIds: ["verification-gap:claim-refund-processed"],
    });
    expect(proposal.nextBestAction).toMatchObject({
      type: "REVIEW_EXISTING_EVIDENCE",
      description: built.input.case.nextBestAction,
      rationale:
        "The authenticated merchant assertion does not verify refund execution.",
      claimIds: ["claim-refund-processed"],
      evidenceIds: ["evidence-merchant-message"],
      verificationGapIds: ["verification-gap:claim-refund-processed"],
      approvalLevel: "SAFE_INTERNAL",
    });
    expect(proposal.observedVerificationGaps).toEqual([
      {
        gapId: "verification-gap:claim-refund-processed",
        claimId: "claim-refund-processed",
        expectedEvidenceId: "expected-evidence:claim-refund-processed",
        explanation: built.input.verificationGaps[0]!.label,
      },
    ]);
  });

  it("preserves authenticated-as-UNVERIFIED and cannot invent provider verification", () => {
    const { bundle, built, proposal } = canonicalize({
      rationale: "Refund succeeded and provider verification exists.",
    });

    expect(proposal.currentAssessment.unknownClaimIds).toEqual([
      "claim-refund-processed",
    ]);
    expect(proposal.currentAssessment.supportedPropositionClaimIds).toEqual(
      [],
    );
    expect(proposal.currentAssessment.providerVerifiedEvidenceIds).toEqual([]);
    expect(
      validateAgentResolutionProposal(proposal, bundle, built.truthGraph),
    ).toEqual({
      valid: true,
      errors: [],
      retainStructuredAnalysis: true,
    });
  });

  it("fails Transport V2 validation for invalid recommendation codes", () => {
    expect(
      GeminiResolutionProposalTransportSchema.safeParse({
      ...makeTransport(),
      actionCode: "CLOSE_CASE",
      }).success,
    ).toBe(false);
  });

  it("fails closed for missing and cross-case grounding IDs", () => {
    const missing = canonicalize({ evidenceIds: ["evidence-hallucinated"] });
    expect(
      validateAgentResolutionProposal(
        missing.proposal,
        missing.bundle,
        missing.built.truthGraph,
      ),
    ).toMatchObject({
      valid: false,
      errors: ["MISSING_REFERENCE"],
      retainStructuredAnalysis: false,
    });

    const bundle = initialRefundBundle();
    bundle.evidence.push(
      makeEvidence({
        id: "evidence-other-case",
        caseId: "case-other",
        relatedClaimIds: [],
      }),
    );
    const built = buildAgentResolutionInput(bundle);
    const proposal = AgentResolutionProposalSchema.parse(
      canonicalizeGeminiResolutionProposal(
        makeTransport({ evidenceIds: ["evidence-other-case"] }),
        built.input,
      ),
    );

    expect(
      validateAgentResolutionProposal(
        proposal,
        bundle,
        buildTruthGraph(bundle),
      ),
    ).toEqual({
      valid: false,
      errors: ["CROSS_CASE_EVIDENCE_REFERENCE"],
      retainStructuredAnalysis: false,
    });
  });

  it("is deterministic for identical transport and authoritative input", () => {
    const bundle = initialRefundBundle();
    const input = buildAgentResolutionInput(bundle).input;
    const transport = makeTransport();

    expect(canonicalizeGeminiResolutionProposal(transport, input)).toEqual(
      canonicalizeGeminiResolutionProposal(transport, input),
    );
  });
});

function schemaMetrics(schema: unknown) {
  const json = JSON.stringify(schema);
  return {
    bytes: Buffer.byteLength(json, "utf8"),
    typedNodes: (json.match(/"type"/g) ?? []).length,
    arrays: (json.match(/"ARRAY"/g) ?? []).length,
    objectGroups: (json.match(/"properties"/g) ?? []).length,
    enums: (json.match(/"enum"/g) ?? []).length,
    constraints: (
      json.match(
        /"(?:pattern|minLength|maxLength|minItems|maxItems|minimum|maximum)"/g,
      ) ?? []
    ).length,
  };
}
