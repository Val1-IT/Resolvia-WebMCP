import { describe, expect, it } from "vitest";

import { safeLoginNextPath } from "@/src/application/auth/safe-login-next-path";

describe("safeLoginNextPath", () => {
  it.each([
    undefined,
    "",
    "https://evil.example/phish",
    "//evil.example/phish",
    "/\\evil.example/phish",
    "/%5Cevil.example/phish",
    "/cases/RV-1028\nSet-Cookie: forged=1",
  ])("rejects unsafe destination %#", (candidate) => {
    expect(safeLoginNextPath(candidate)).toBe("/cases/RV-1028");
  });

  it("preserves a bounded application-relative destination", () => {
    expect(safeLoginNextPath("/cases/RV-1028?historyPage=2#timeline")).toBe(
      "/cases/RV-1028?historyPage=2#timeline",
    );
  });
});