const REDACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu, "[REDACTED_PRIVATE_KEY]"],
  [/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/giu, "[REDACTED_TOKEN]"],
  [/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9_-]{16,}\b/gu, "[REDACTED_TOKEN]"],
  [/\bAIza[A-Za-z0-9_-]{20,}\b/gu, "[REDACTED_TOKEN]"],
  [/\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*[^\s;,]+/giu, "[REDACTED_TOKEN]"],
  [/\b[A-Z][A-Z0-9_]*(?:API_KEY|SECRET|TOKEN)\s*[:=]\s*[^\s;,]+/gu, "[REDACTED_TOKEN]"],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[REDACTED_EMAIL]"],
  [/(?<!\w)(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\w)/gu, "[REDACTED_PHONE]"],
  [/[A-Za-z]:\\(?:Users|Windows|Program Files|workspace|tmp)\\[^\s;,]+/gu, "[REDACTED_PATH]"],
  [/(?:\/(?:Users|home|root|workspace|tmp)\/)[^\s;,]+/gu, "[REDACTED_PATH]"],
];

export function redactSensitiveText(value: string): string {
  return REDACTIONS.reduce(
    (redacted, [pattern, replacement]) => redacted.replace(pattern, replacement),
    value,
  );
}
