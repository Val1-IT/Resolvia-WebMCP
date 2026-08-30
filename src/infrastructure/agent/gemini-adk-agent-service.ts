import { createHash } from "node:crypto";

import {
  InMemoryRunner,
  LlmAgent,
  isFinalResponse,
  stringifyContent,
  type Event,
} from "@google/adk";

import type {
  AgentService,
  AgentServiceDiagnosticCode,
  AgentServiceRequest,
  AgentServiceResult,
} from "@/src/application/ports/external-services";
import { RESOLUTION_AGENT_INSTRUCTION } from "@/src/application/agents/resolution-agent-prompt";
import {
  AgentResolutionProposalSchema,
  type AgentRunOutcome,
} from "@/src/domain/agent/model";
import type { GeminiConfig } from "@/src/infrastructure/agent/gemini-config";
import {
  GeminiResolutionProposalTransportSchema,
  canonicalizeGeminiResolutionProposal,
} from "@/src/infrastructure/agent/gemini-resolution-proposal-transport";

const APP_NAME = "resolvia";
const AGENT_NAME = "resolvia_resolution_agent";
const MAX_GEMINI_INPUT_BYTES = 256 * 1024;
const MAX_GEMINI_OUTPUT_BYTES = 64 * 1024;

export type GeminiAdapterEvent = {
  isFinal: boolean;
  text?: string;
  errorCode?: string;
  modelVersion?: string;
};

export type GeminiEventSourceRequest = AgentServiceRequest & {
  abortSignal: AbortSignal;
};

export type GeminiEventSource = (
  request: GeminiEventSourceRequest,
) => AsyncIterable<GeminiAdapterEvent>;

type GeminiAdkAgentServiceOptions = {
  eventSource?: GeminiEventSource;
};

export class GeminiAdkAgentService implements AgentService {
  private readonly eventSource: GeminiEventSource;

  constructor(
    private readonly config: GeminiConfig,
    options: GeminiAdkAgentServiceOptions = {},
  ) {
    this.eventSource =
      options.eventSource ?? createAdkEventSource(createResolutionAgent(config));
  }

  async proposeResolution(
    request: AgentServiceRequest,
  ): Promise<AgentServiceResult> {
    if (!this.config.isConfigured) {
      return failure("FAILED_CONFIGURATION", this.config.model);
    }

    if (Buffer.byteLength(request.serializedInput, "utf8") > MAX_GEMINI_INPUT_BYTES) {
      return failure(
        "FAILED_SCHEMA",
        this.config.model,
        undefined,
        undefined,
        "INPUT_TOO_LARGE",
      );
    }

    const controller = new AbortController();

    try {
      const iterator = this.eventSource({
        ...request,
        abortSignal: controller.signal,
      })[Symbol.asyncIterator]();
      const finalEvents = await collectFinalEvents(
        iterator,
        controller,
        this.config.timeoutMs,
      );

      if (finalEvents.length !== 1) {
        const combined = finalEvents
          .map((event) => event.text ?? "")
          .filter(Boolean)
          .join("\n");
        if (Buffer.byteLength(combined, "utf8") > MAX_GEMINI_OUTPUT_BYTES) {
          return failure(
            "FAILED_MALFORMED_OUTPUT",
            this.config.model,
            digest(combined),
            undefined,
            "OUTPUT_TOO_LARGE",
          );
        }
        return failure(
          "FAILED_MALFORMED_OUTPUT",
          this.config.model,
          combined ? digest(combined) : undefined,
        );
      }

      const finalEvent = finalEvents[0]!;
      const rawOutput = finalEvent.text ?? "";
      const rawOutputDigest = rawOutput ? digest(rawOutput) : undefined;
      if (Buffer.byteLength(rawOutput, "utf8") > MAX_GEMINI_OUTPUT_BYTES) {
        return failure(
          "FAILED_MALFORMED_OUTPUT",
          this.config.model,
          rawOutputDigest,
          finalEvent.modelVersion,
          "OUTPUT_TOO_LARGE",
        );
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(rawOutput);
      } catch {
        return failure(
          "FAILED_MALFORMED_OUTPUT",
          this.config.model,
          rawOutputDigest,
          finalEvent.modelVersion,
        );
      }

      const transport = GeminiResolutionProposalTransportSchema.safeParse(
        decoded,
      );
      if (!transport.success) {
        return failure(
          "FAILED_SCHEMA",
          this.config.model,
          rawOutputDigest,
          finalEvent.modelVersion,
          "TRANSPORT_SCHEMA_REJECTED",
        );
      }
      const parsed = AgentResolutionProposalSchema.safeParse(
        canonicalizeGeminiResolutionProposal(transport.data, request.input),
      );
      if (!parsed.success) {
        return failure(
          "FAILED_SCHEMA",
          this.config.model,
          rawOutputDigest,
          finalEvent.modelVersion,
          "CANONICAL_SCHEMA_REJECTED",
        );
      }

      return {
        kind: "PROPOSAL",
        proposal: parsed.data,
        modelId: this.config.model,
        ...(finalEvent.modelVersion
          ? { modelVersion: finalEvent.modelVersion }
          : {}),
        rawOutputDigest: rawOutputDigest!,
      };
    } catch (error) {
      const outcome = classifyProviderFailure(error, controller.signal);
      return failure(
        outcome,
        this.config.model,
        undefined,
        undefined,
        outcome === "FAILED_SCHEMA"
          ? "PROVIDER_SCHEMA_REJECTED"
          : undefined,
      );
    }
  }
}


async function collectFinalEvents(
  iterator: AsyncIterator<GeminiAdapterEvent>,
  controller: AbortController,
  timeoutMs: number,
): Promise<GeminiAdapterEvent[]> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const providerResult = (async () => {
    const finalEvents: GeminiAdapterEvent[] = [];
    while (true) {
      const next = await iterator.next();
      if (next.done) return finalEvents;
      const event = next.value;
      if (event.errorCode) throw new ProviderEventError(event.errorCode);
      if (event.isFinal) {
        finalEvents.push(event);
        if (finalEvents.length > 1) {
          closeIterator(iterator);
          return finalEvents;
        }
      }
    }
  })();
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      closeIterator(iterator);
      reject(new HardTimeoutError());
    }, timeoutMs);
  });

  try {
    return await Promise.race([providerResult, deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function closeIterator(iterator: AsyncIterator<GeminiAdapterEvent>): void {
  try {
    const completion = iterator.return?.();
    if (completion) void completion.catch(() => undefined);
  } catch {
    // Cleanup is best-effort after the authoritative timeout/failure result.
  }
}

class HardTimeoutError extends Error {
  constructor() {
    super("Gemini adapter hard timeout");
    this.name = "HardTimeoutError";
  }
}
export function createResolutionAgent(config: GeminiConfig): LlmAgent {
  return new LlmAgent({
    name: AGENT_NAME,
    description:
      "Produces a constrained resolution proposal from case-scoped data.",
    model: config.model,
    instruction: RESOLUTION_AGENT_INSTRUCTION,
    includeContents: "none",
    outputSchema: GeminiResolutionProposalTransportSchema,
    tools: [],
  });
}

function createAdkEventSource(agent: LlmAgent): GeminiEventSource {
  return async function* ({
    runId,
    input,
    serializedInput,
    abortSignal,
  }): AsyncIterable<GeminiAdapterEvent> {
    const runner = new InMemoryRunner({ agent, appName: APP_NAME });
    const userId = `case:${input.case.id}`;
    await runner.sessionService.createSession({
      appName: APP_NAME,
      userId,
      sessionId: runId,
    });

    try {
      const rawEvents = runner.runAsync({
        userId,
        sessionId: runId,
        abortSignal,
        newMessage: {
          role: "user",
          parts: [{ text: serializedInput }],
        },
      });

      for await (const event of rawEvents) {
        yield normalizeAdkEvent(event);
      }
    } finally {
      await runner.sessionService.deleteSession({
        appName: APP_NAME,
        userId,
        sessionId: runId,
      });
    }
  };
}

function normalizeAdkEvent(event: Event): GeminiAdapterEvent {
  return {
    isFinal: isFinalResponse(event),
    ...(isFinalResponse(event) ? { text: stringifyContent(event) } : {}),
    ...(event.errorCode ? { errorCode: event.errorCode } : {}),
    ...(event.modelVersion ? { modelVersion: event.modelVersion } : {}),
  };
}

function failure(
  outcome: Exclude<
    AgentRunOutcome,
    "SUCCEEDED_VALID" | "REJECTED_VALIDATION"
  >,
  modelId: string,
  rawOutputDigest?: string,
  modelVersion?: string,
  diagnosticCode?: AgentServiceDiagnosticCode,
): AgentServiceResult {
  return {
    kind: "FAILURE",
    outcome,
    modelId,
    ...(modelVersion ? { modelVersion } : {}),
    ...(rawOutputDigest ? { rawOutputDigest } : {}),
    ...(diagnosticCode ? { diagnosticCode } : {}),
  };
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

class ProviderEventError extends Error {
  constructor(readonly providerCode: string) {
    super("Provider event failed");
  }
}

function isTimeout(error: unknown, signal: AbortSignal): boolean {
  return (
    signal.aborted ||
    (error instanceof Error && error.name === "AbortError") ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "AbortError")
  );
}

function classifyProviderFailure(
  error: unknown,
  signal: AbortSignal,
): Exclude<
  AgentRunOutcome,
  "SUCCEEDED_VALID" | "REJECTED_VALIDATION"
> {
  if (isTimeout(error, signal)) return "FAILED_TIMEOUT";

  const codes = providerFailureCodes(error);
  if (codes.some((code) => QUOTA_CODES.has(code))) return "FAILED_QUOTA";
  if (codes.some((code) => SCHEMA_CODES.has(code))) return "FAILED_SCHEMA";
  if (codes.some((code) => CONFIGURATION_CODES.has(code))) {
    return "FAILED_CONFIGURATION";
  }
  return "FAILED_NETWORK";
}

const QUOTA_CODES = new Set(["429", "RESOURCE_EXHAUSTED"]);
const SCHEMA_CODES = new Set(["400", "INVALID_ARGUMENT"]);
const CONFIGURATION_CODES = new Set([
  "401",
  "403",
  "404",
  "UNAUTHENTICATED",
  "PERMISSION_DENIED",
  "NOT_FOUND",
  "FAILED_PRECONDITION",
]);

function providerFailureCodes(error: unknown): string[] {
  if (error instanceof ProviderEventError) {
    return [normalizeProviderCode(error.providerCode)];
  }
  if (typeof error !== "object" || error === null) return [];

  const candidate = error as { code?: unknown; status?: unknown };
  return [candidate.status, candidate.code]
    .filter((value): value is string | number =>
      typeof value === "string" || typeof value === "number",
    )
    .map(normalizeProviderCode);
}

function normalizeProviderCode(code: string | number): string {
  return String(code).trim().toUpperCase();
}
