import { describe, expect, it } from "vitest";

import { BoundedBodyError, readBoundedBody } from "@/src/infrastructure/http/bounded-body";

describe("readBoundedBody", () => {
  it("returns exact UTF-8 request bytes within the declared bound", async () => {
    const request = new Request("https://resolvia.test", {
      method: "POST", headers: { "content-type": "application/json" }, body: '{"ok":true}',
    });
    await expect(readBoundedBody(request, 32, ["application/json"])).resolves.toBe('{"ok":true}');
  });

  it("rejects content-length and streamed bodies above the limit before downstream parsing", async () => {
    const declared = new Request("https://resolvia.test", {
      method: "POST", headers: { "content-type": "application/json", "content-length": "100" }, body: "{}",
    });
    await expect(readBoundedBody(declared, 16, ["application/json"]))
      .rejects.toMatchObject({ code: "BODY_TOO_LARGE" } satisfies Partial<BoundedBodyError>);

    const streamed = new Request("https://resolvia.test", {
      method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(17),
    });
    await expect(readBoundedBody(streamed, 16, ["application/json"]))
      .rejects.toMatchObject({ code: "BODY_TOO_LARGE" } satisfies Partial<BoundedBodyError>);
  });

  it("rejects unsupported content types and invalid content-length", async () => {
    const text = new Request("https://resolvia.test", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
    await expect(readBoundedBody(text, 16, ["application/json"]))
      .rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE" } satisfies Partial<BoundedBodyError>);
    const invalid = new Request("https://resolvia.test", { method: "POST", headers: { "content-type": "application/json", "content-length": "nan" }, body: "{}" });
    await expect(readBoundedBody(invalid, 16, ["application/json"]))
      .rejects.toMatchObject({ code: "INVALID_CONTENT_LENGTH" } satisfies Partial<BoundedBodyError>);
  });
});
