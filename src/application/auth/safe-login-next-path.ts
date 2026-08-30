const DEFAULT_LOGIN_PATH = "/cases/RV-1028";
const MAX_LOGIN_PATH_LENGTH = 2_048;
const INTERNAL_ORIGIN = "https://resolvia.invalid";

export function safeLoginNextPath(candidate: string | undefined): string {
  if (
    !candidate ||
    candidate.length > MAX_LOGIN_PATH_LENGTH ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    /%5c/iu.test(candidate) ||
    /[\u0000-\u001F\u007F]/u.test(candidate)
  ) {
    return DEFAULT_LOGIN_PATH;
  }

  try {
    const parsed = new URL(candidate, INTERNAL_ORIGIN);
    if (parsed.origin !== INTERNAL_ORIGIN) return DEFAULT_LOGIN_PATH;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_LOGIN_PATH;
  }
}