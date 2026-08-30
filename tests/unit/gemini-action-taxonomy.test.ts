import { describe, expect, it } from "vitest";

import { buildAgentResolutionInput } from "@/src/application/agents/build-agent-input";
import {
  RESOLUTION_AGENT_INSTRUCTION,
  serializeAgentRequest,
} from "@/src/application/agents/resolution-agent-prompt";
import { validateAgentResolutionProposal } from "@/src/application/agents/validate-agent-proposal";
import { REQUIRED_APPROVAL_BY_ACTION } from "@/src/domain/agent/policy";
import { AgentResolutionProposalSchema } from "@/src/domain/agent/model";
import { canonicalizeGeminiResolutionProposal, GeminiResolutionProposalTransportSchema } from "@/src/infrastructure/agent/gemini-resolution-proposal-transport";
import { initialRefundBundle } from "@/tests/fixtures/domain";

const TRANSPORT = {
  caseId: "case-rv-1028",
  basedOnCaseVersion: 4,
  assessmentCode: "EXTERNAL_STATUS_UNKNOWN",
  rationale: "Provider evidence is still missing.",
  actionCode: "REVIEW_EXISTING_EVIDENCE",
  targetPartyId: null,
  evidenceIds: ["evidence-merchant-message"],
  verificationGapIds: ["verification-gap:claim-refund-processed"],
  uncertainty: "The provider refund record remains unknown.",
  openQuestions: ["Can the provider supply a refund record?"],
};

describe("Gemini action-taxonomy boundary", () => {
  it("rejects an unknown actionCode at the Transport V2 boundary", () => {
    expect(
      GeminiResolutionProposalTransportSchema.safeParse({
        ...TRANSPORT,
        actionCode: "CLOSE_CASE",
      }).success,
    ).toBe(false);
  });

  it("exposes every and only Resolvia policy action through Transport V2", () => {
    for (const actionCode of Object.keys(REQUIRED_APPROVAL_BY_ACTION)) {
      expect(
        GeminiResolutionProposalTransportSchema.safeParse({
          ...TRANSPORT,
          actionCode,
        }).success,
      ).toBe(true);
    }
    expect(
      GeminiResolutionProposalTransportSchema.safeParse({
        ...TRANSPORT,
        actionCode: "MODEL_INVENTED_ACTION",
      }).success,
    ).toBe(false);
  });

  it("supplies a deterministic action catalog with only semantically valid targets", () => {
    const { input } = buildAgentResolutionInput(initialRefundBundle());

    expect(input).toMatchObject({
      actionPolicy: [
        { code: "REVIEW_EXISTING_EVIDENCE", targetPartyIds: [] },
        { code: "WAIT_FOR_NEW_EVIDENCE", targetPartyIds: [] },
        { code: "REQUEST_USER_EVIDENCE", targetPartyIds: ["party-customer"] },
        {
          code: "PREPARE_EXTERNAL_FOLLOW_UP",
          targetPartyIds: ["party-merchant"],
        },
        { code: "REFER_TO_HUMAN_REVIEW", targetPartyIds: [] },
        { code: "NO_PERMITTED_ACTION", targetPartyIds: [] },
      ],
    });
    expect(serializeAgentRequest(input)).toContain('"actionPolicy"');
  });

  it("instructs Gemini to select an exact policy action without inventing or renaming one", () => {
    expect(RESOLUTION_AGENT_INSTRUCTION).toContain(
      "MUST choose actionCode from the provided allowed action codes.",
    );
    expect(RESOLUTION_AGENT_INSTRUCTION).toContain(
      "Do not invent, paraphrase, rename, or combine action codes.",
    );
  });

  it("preserves a selected canonical action and its authorized target", () => {
    const bundle = initialRefundBundle();
    const built = buildAgentResolutionInput(bundle);
    const proposal = AgentResolutionProposalSchema.parse(
      canonicalizeGeminiResolutionProposal(
        GeminiResolutionProposalTransportSchema.parse({
          ...TRANSPORT,
          actionCode: "PREPARE_EXTERNAL_FOLLOW_UP",
          targetPartyId: "party-merchant",
        }),
        built.input,
      ),
    );

    expect(proposal.nextBestAction).toMatchObject({
      type: "PREPARE_EXTERNAL_FOLLOW_UP",
      targetPartyId: "party-merchant",
      approvalLevel: "USER_APPROVAL_REQUIRED",
    });
    expect(
      validateAgentResolutionProposal(proposal, bundle, built.truthGraph),
    ).toMatchObject({ valid: true, errors: [] });
  });

  it("still rejects a target-invalid canonical action outside the Gemini boundary", () => {
    const bundle = initialRefundBundle();
    const built = buildAgentResolutionInput(bundle);
    const valid = AgentResolutionProposalSchema.parse(
      canonicalizeGeminiResolutionProposal(
        GeminiResolutionProposalTransportSchema.parse(TRANSPORT),
        built.input,
      ),
    );
    const invalid = AgentResolutionProposalSchema.parse({
      ...valid,
      nextBestAction: {
        ...valid.nextBestAction,
        type: "REQUEST_USER_EVIDENCE",
        targetPartyId: "party-merchant",
        approvalLevel: "USER_APPROVAL_REQUIRED",
      },
    });

    expect(
      validateAgentResolutionProposal(invalid, bundle, built.truthGraph),
    ).toMatchObject({ valid: false, errors: ["ACTION_NOT_ALLOWED"] });
  });
});
