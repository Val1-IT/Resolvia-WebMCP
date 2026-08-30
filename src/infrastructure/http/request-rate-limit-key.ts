export function requestRateLimitKey(request: Request, subject: string): string {
  const forwarded = request.headers.get("x-forwarded-for")?.trim() ?? "source-unavailable";
  const source = forwarded.length > 0 && forwarded.length <= 256
    ? forwarded.replace(/\s+/gu, " ")
    : "source-invalid";
  return `${subject}\u0000${source}`;
}