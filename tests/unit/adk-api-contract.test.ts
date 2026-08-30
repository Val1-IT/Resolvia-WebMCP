import {
  InMemoryRunner,
  LlmAgent,
  isFinalResponse,
  stringifyContent,
} from "@google/adk";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const ContractOutputSchema = z
  .object({
    summary: z.string(),
  })
  .strict();

describe("Google ADK API contract", () => {
  it("supports a tool-less agent and abortable runner input without invoking Gemini", () => {
    const agent = new LlmAgent({
      name: "resolvia_resolution_agent",
      model: "gemini-2.5-flash",
      instruction: "Return only the requested structured output.",
      outputSchema: ContractOutputSchema,
      includeContents: "none",
      tools: [],
    });

    const abortController = new AbortController();
    const runInput: Parameters<InMemoryRunner["runAsync"]>[0] = {
      userId: "contract-user",
      sessionId: "contract-session",
      newMessage: {
        role: "user",
        parts: [{ text: "Compile contract only." }],
      },
      abortSignal: abortController.signal,
    };

    expect(agent.name).toBe("resolvia_resolution_agent");
    expect(runInput.abortSignal).toBe(abortController.signal);
    expect(typeof isFinalResponse).toBe("function");
    expect(typeof stringifyContent).toBe("function");
  });
});
