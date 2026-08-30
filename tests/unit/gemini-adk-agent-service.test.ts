import { describe, expect, it } from "vitest";

import { buildAgentResolutionInput } from "@/src/application/agents/build-agent-input";
import { serializeAgentRequest } from "@/src/application/agents/resolution-agent-prompt";
import { AgentResolutionProposalSchema } from "@/src/domain/agent/model";
import {
  GeminiAdkAgentService,
  createResolutionAgent,
  type GeminiAdapterEvent,
  type GeminiEventSource,
} from "@/src/infrastructure/agent/gemini-adk-agent-service";
import type { GeminiConfig } from "@/src/infrastructure/agent/gemini-config";
import { canonicalizeGeminiResolutionProposal } from "@/src/infrastructure/agent/gemini-resolution-proposal-transport";
import { makeGeminiTransportProposal } from "@/tests/fixtures/agent";
import { initialRefundBundle } from "@/tests/fixtures/domain";

const configured: GeminiConfig = {
  model: "gemini-test-model",
  timeoutMs: 1_000,
  isConfigured: true,
};

function request() {
  const { input } = buildAgentResolutionInput(initialRefundBundle());
  return {
    runId: "agent-run-test",
    input,
    serializedInput: serializeAgentRequest(input),
  };
}

function events(...values: GeminiAdapterEvent[]): GeminiEventSource {
  return async function* () {
    yield* values;
  };
}

describe("GeminiAdkAgentService", () => {
  it("constructs one tool-less no-history Resolution Agent", () => {
    const agent = createResolutionAgent(configured);
    const providerSchema = JSON.stringify(agent.outputSchema);

    expect(agent.name).toBe("resolvia_resolution_agent");
    expect(agent.model).toBe("gemini-test-model");
    expect(agent.includeContents).toBe("none");
    expect(agent.tools).toEqual([]);
    expect(agent.outputSchema).toBeDefined();
    expect(providerSchema).toContain("actionCode");
    expect(providerSchema).not.toContain("authenticatedClaimIds");
  });

  it("returns one strict proposal without retaining raw output", async () => {
    const transport = makeGeminiTransportProposal();
    const proposal = AgentResolutionProposalSchema.parse(
      canonicalizeGeminiResolutionProposal(transport, request().input),
    );
    const service = new GeminiAdkAgentService(configured, {
      eventSource: events({
        isFinal: true,
        text: JSON.stringify(transport),
        modelVersion: "gemini-provider-version",
      }),
    });

    const result = await service.proposeResolution(request());

    expect(result).toMatchObject({
      kind: "PROPOSAL",
      proposal,
      modelId: "gemini-test-model",
      modelVersion: "gemini-provider-version",
    });
    expect(result).not.toHaveProperty("rawOutput");
    expect(result).not.toHaveProperty("providerResponse");
    expect(result.rawOutputDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("distinguishes transport-schema rejection without retaining output", async () => {
    const service = new GeminiAdkAgentService(configured, {
      eventSource: events({
        isFinal: true,
        text: JSON.stringify({
          ...makeGeminiTransportProposal(),
          supportedClaimIds: ["claim-refund-processed"],
        }),
      }),
    });

    const result = await service.proposeResolution(request());

    expect(result).toMatchObject({
      kind: "FAILURE",
      outcome: "FAILED_SCHEMA",
      diagnosticCode: "TRANSPORT_SCHEMA_REJECTED",
    });
    expect(result).not.toHaveProperty("rawOutput");
  });

  it("rejects an unknown actionCode at Transport V2 without retaining output", async () => {
    const service = new GeminiAdkAgentService(configured, {
      eventSource: events({
        isFinal: true,
        text: JSON.stringify({
          ...makeGeminiTransportProposal(),
          actionCode: "CLOSE_CASE",
        }),
      }),
    });

    const result = await service.proposeResolution(request());

    expect(result).toMatchObject({
      kind: "FAILURE",
      outcome: "FAILED_SCHEMA",
      diagnosticCode: "TRANSPORT_SCHEMA_REJECTED",
    });
    expect(result).not.toHaveProperty("proposal");
  });

  it("distinguishes invalid assessment code at canonical Zod", async () => {
    const service = new GeminiAdkAgentService(configured, {
      eventSource: events({
        isFinal: true,
        text: JSON.stringify(
          makeGeminiTransportProposal({
            assessmentCode: "REFUND_SUCCEEDED",
          }),
        ),
      }),
    });

    const result = await service.proposeResolution(request());

    expect(result).toMatchObject({
      kind: "FAILURE",
      outcome: "FAILED_SCHEMA",
      diagnosticCode: "CANONICAL_SCHEMA_REJECTED",
    });
    expect(result).not.toHaveProperty("proposal");
  });

  it.each([
    [[], "FAILED_MALFORMED_OUTPUT"],
    [
      [
        {
          isFinal: true,
          text: JSON.stringify(makeGeminiTransportProposal()),
        },
        {
          isFinal: true,
          text: JSON.stringify(makeGeminiTransportProposal()),
        },
      ],
      "FAILED_MALFORMED_OUTPUT",
    ],
    [[{ isFinal: true, text: "not-json" }], "FAILED_MALFORMED_OUTPUT"],
    [
      [{ isFinal: true, text: JSON.stringify({ caseId: "incomplete" }) }],
      "FAILED_SCHEMA",
    ],
  ] as const)("fails closed for invalid final response %#", async (rawEvents, outcome) => {
    const service = new GeminiAdkAgentService(configured, {
      eventSource: events(...rawEvents),
    });

    const result = await service.proposeResolution(request());

    expect(result).toMatchObject({ kind: "FAILURE", outcome });
    expect(result).not.toHaveProperty("proposal");
    expect(JSON.stringify(result)).not.toContain("not-json");
    expect(JSON.stringify(result)).not.toContain("incomplete");
  });

  it("classifies configuration failure without invoking the provider", async () => {
    const unavailable: GeminiEventSource = async function* () {
      throw new Error("must not run");
    };
    const service = new GeminiAdkAgentService(
      { ...configured, isConfigured: false },
      { eventSource: unavailable },
    );

    await expect(service.proposeResolution(request())).resolves.toEqual({
      kind: "FAILURE",
      outcome: "FAILED_CONFIGURATION",
      modelId: "gemini-test-model",
    });
  });

  it("classifies abort as timeout without exposing exception text", async () => {
    const waitsForAbort: GeminiEventSource = async function* ({ abortSignal }) {
      await new Promise<void>((_resolve, reject) => {
        abortSignal.addEventListener(
          "abort",
          () => reject(new DOMException("sensitive timeout", "AbortError")),
          { once: true },
        );
      });
    };
    const service = new GeminiAdkAgentService(
      { ...configured, timeoutMs: 5 },
      { eventSource: waitsForAbort },
    );

    const result = await service.proposeResolution(request());

    expect(result).toEqual({
      kind: "FAILURE",
      outcome: "FAILED_TIMEOUT",
      modelId: "gemini-test-model",
    });
    expect(JSON.stringify(result)).not.toContain("sensitive timeout");
  });

  it.each([
    [Object.assign(new Error("schema secret"), { status: 400 }), "FAILED_SCHEMA"],
    [
      Object.assign(new Error("request secret"), {
        code: "INVALID_ARGUMENT",
      }),
      "FAILED_SCHEMA",
    ],
    [
      Object.assign(new Error("auth secret"), { status: 401 }),
      "FAILED_CONFIGURATION",
    ],
    [
      Object.assign(new Error("permission secret"), {
        code: "PERMISSION_DENIED",
      }),
      "FAILED_CONFIGURATION",
    ],
    [Object.assign(new Error("quota secret"), { status: 429 }), "FAILED_QUOTA"],
    [
      Object.assign(new Error("provider secret"), {
        code: "RESOURCE_EXHAUSTED",
      }),
      "FAILED_QUOTA",
    ],
    [new Error("network secret"), "FAILED_NETWORK"],
  ] as const)("classifies provider failure without retaining its message", async (error, outcome) => {
    const throws: GeminiEventSource = async function* () {
      throw error;
    };
    const service = new GeminiAdkAgentService(configured, {
      eventSource: throws,
    });

    const result = await service.proposeResolution(request());

    expect(result).toEqual({
      kind: "FAILURE",
      outcome,
      modelId: "gemini-test-model",
      ...(outcome === "FAILED_SCHEMA"
        ? { diagnosticCode: "PROVIDER_SCHEMA_REJECTED" }
        : {}),
    });
    expect(JSON.stringify(result)).not.toContain(error.message);
  });

  it.each([
    ["400", "FAILED_SCHEMA"],
    ["INVALID_ARGUMENT", "FAILED_SCHEMA"],
    ["401", "FAILED_CONFIGURATION"],
    ["PERMISSION_DENIED", "FAILED_CONFIGURATION"],
    ["429", "FAILED_QUOTA"],
    ["RESOURCE_EXHAUSTED", "FAILED_QUOTA"],
    ["503", "FAILED_NETWORK"],
  ] as const)("classifies provider event code %s as %s", async (errorCode, outcome) => {
    const service = new GeminiAdkAgentService(configured, {
      eventSource: events({ isFinal: false, errorCode }),
    });

    await expect(service.proposeResolution(request())).resolves.toEqual({
      kind: "FAILURE",
      outcome,
      modelId: "gemini-test-model",
      ...(outcome === "FAILED_SCHEMA"
        ? { diagnosticCode: "PROVIDER_SCHEMA_REJECTED" }
        : {}),
    });
  });
  it("enforces a hard timeout when the event iterator ignores abort", async () => {
    const ignoresAbort: GeminiEventSource = async function* () {
      await new Promise<void>(() => undefined);
    };
    const service = new GeminiAdkAgentService(
      { ...configured, timeoutMs: 5 },
      { eventSource: ignoresAbort },
    );

    await expect(service.proposeResolution(request())).resolves.toEqual({
      kind: "FAILURE",
      outcome: "FAILED_TIMEOUT",
      modelId: "gemini-test-model",
    });
  }, 500);

  it("rejects oversized final output before JSON/schema parsing", async () => {
    const oversized = JSON.stringify({ summary: "x".repeat(70_000) });
    const service = new GeminiAdkAgentService(configured, {
      eventSource: events({ isFinal: true, text: oversized }),
    });

    const result = await service.proposeResolution(request());

    expect(result).toMatchObject({
      kind: "FAILURE",
      outcome: "FAILED_MALFORMED_OUTPUT",
      diagnosticCode: "OUTPUT_TOO_LARGE",
    });
    expect(result).not.toHaveProperty("proposal");
    expect(JSON.stringify(result)).not.toContain("xxxxx");
  });
  it("rejects oversized serialized input before invoking the provider", async () => {
    let invoked = false;
    const provider: GeminiEventSource = async function* () {
      invoked = true;
    };
    const service = new GeminiAdkAgentService(configured, {
      eventSource: provider,
    });

    const result = await service.proposeResolution({
      ...request(),
      serializedInput: "x".repeat(300_000),
    });

    expect(result).toMatchObject({
      kind: "FAILURE",
      outcome: "FAILED_SCHEMA",
      diagnosticCode: "INPUT_TOO_LARGE",
    });
    expect(invoked).toBe(false);
  });
});
