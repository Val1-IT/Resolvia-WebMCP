const DEFAULT_MODEL = "gemini-3.6-flash";
const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;

export type GeminiConfig = {
  model: string;
  timeoutMs: number;
  isConfigured: boolean;
};

type Environment = Record<string, string | undefined>;

export function getGeminiConfig(
  environment: Environment = process.env,
): GeminiConfig {
  const requestedTimeout = Number.parseInt(
    environment.RESOLVIA_GEMINI_TIMEOUT_MS ?? "",
    10,
  );
  const timeoutMs = Number.isFinite(requestedTimeout)
    ? Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, requestedTimeout))
    : DEFAULT_TIMEOUT_MS;
  const model = environment.RESOLVIA_GEMINI_MODEL?.trim() || DEFAULT_MODEL;

  return {
    model,
    timeoutMs,
    isConfigured: Boolean(environment.GEMINI_API_KEY?.trim()),
  };
}
