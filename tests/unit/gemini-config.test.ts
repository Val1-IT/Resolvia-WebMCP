import { describe, expect, it } from "vitest";

import { getGeminiConfig } from "@/src/infrastructure/agent/gemini-config";

describe("getGeminiConfig", () => {
  it("reports missing credentials without exposing a credential field", () => {
    const config = getGeminiConfig({});

    expect(config).toEqual({
      model: "gemini-3.6-flash",
      timeoutMs: 30_000,
      isConfigured: false,
    });
    expect(JSON.stringify(config)).not.toContain("GEMINI_API_KEY");
  });

  it("uses safe model and timeout overrides without returning the key", () => {
    const config = getGeminiConfig({
      GEMINI_API_KEY: "super-secret",
      RESOLVIA_GEMINI_MODEL: "gemini-test-model",
      RESOLVIA_GEMINI_TIMEOUT_MS: "45000",
    });

    expect(config).toEqual({
      model: "gemini-test-model",
      timeoutMs: 45_000,
      isConfigured: true,
    });
    expect(JSON.stringify(config)).not.toContain("super-secret");
  });

  it.each([
    ["100", 1_000],
    ["999999", 120_000],
    ["not-a-number", 30_000],
  ])("bounds timeout %s to %d", (raw, expected) => {
    expect(
      getGeminiConfig({
        GEMINI_API_KEY: "configured",
        RESOLVIA_GEMINI_TIMEOUT_MS: raw,
      }).timeoutMs,
    ).toBe(expected);
  });
});
