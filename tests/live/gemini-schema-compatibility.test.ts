import { GoogleGenAI } from "@google/genai";
import { describe, expect, it } from "vitest";

import { createResolutionAgent } from "@/src/infrastructure/agent/gemini-adk-agent-service";
import { getGeminiConfig } from "@/src/infrastructure/agent/gemini-config";
import { GeminiResolutionProposalTransportSchema } from "@/src/infrastructure/agent/gemini-resolution-proposal-transport";

const liveEnabled =
  process.env.RUN_LIVE_GEMINI_SMOKE === "1" &&
  Boolean(process.env.GEMINI_API_KEY?.trim());

describe.skipIf(!liveEnabled)("direct Gemini Transport V2 compatibility", () => {
  it("accepts the exact ADK provider schema without ResolutionStore", async () => {
    const config = getGeminiConfig();
    const providerSchema = createResolutionAgent(config).outputSchema;
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

    const response = await client.models.generateContent({
      model: config.model,
      contents:
        "Return a grounded recommendation for case-rv-1028 version 4. " +
        "Use assessmentCode EXTERNAL_STATUS_UNKNOWN, actionCode REVIEW_EXISTING_EVIDENCE, " +
        "targetPartyId null, evidenceIds [evidence-merchant-message], " +
        "verificationGapIds [verification-gap:claim-refund-processed], a cautious rationale, " +
        "one uncertainty sentence, and one open question.",
      config: {
        responseMimeType: "application/json",
        responseSchema: providerSchema,
      },
    });

    const decoded = JSON.parse(response.text ?? "");
    expect(GeminiResolutionProposalTransportSchema.parse(decoded)).toMatchObject({
      caseId: "case-rv-1028",
      basedOnCaseVersion: 4,
    });
    expect(JSON.stringify(decoded)).not.toContain("supportedClaimIds");
    expect(JSON.stringify(decoded)).not.toContain("authenticatedClaimIds");
  }, 60_000);
});
