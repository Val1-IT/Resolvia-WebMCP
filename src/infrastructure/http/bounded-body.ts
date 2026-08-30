export type BoundedBodyErrorCode =
  | "BODY_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "INVALID_CONTENT_LENGTH"
  | "MALFORMED_UTF8";

export class BoundedBodyError extends Error {
  constructor(public readonly code: BoundedBodyErrorCode) {
    super(code);
    this.name = "BoundedBodyError";
  }
}

export async function readBoundedBody(
  request: Request,
  maxBytes: number,
  allowedContentTypes: readonly string[],
): Promise<string> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (!contentType || !allowedContentTypes.includes(contentType)) {
    throw new BoundedBodyError("UNSUPPORTED_MEDIA_TYPE");
  }
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/u.test(declared)) throw new BoundedBodyError("INVALID_CONTENT_LENGTH");
    if (Number(declared) > maxBytes) throw new BoundedBodyError("BODY_TOO_LARGE");
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BoundedBodyError("BODY_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new BoundedBodyError("MALFORMED_UTF8");
  }
}
