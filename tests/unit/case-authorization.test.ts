import { describe, expect, it } from "vitest";

import { authorizeCaseAccess } from "@/src/application/auth/authorize-case-access";
import { InMemoryResolutionStore } from "@/src/infrastructure/memory/in-memory-resolution-store";
import { emptyResolutionSnapshot } from "@/src/domain/store/model";
import { makeCase } from "@/tests/fixtures/domain";

function store() {
  return new InMemoryResolutionStore({
    ...emptyResolutionSnapshot(),
    cases: [
      makeCase({ id: "case-a", displayId: "RV-A", ownerUserId: "user-a", parties: [] }),
      makeCase({ id: "case-b", displayId: "RV-B", ownerUserId: "user-b", parties: [] }),
    ],
  });
}

describe("case authorization", () => {
  it("allows an owner and denies a different authenticated user without returning case data", async () => {
    const resolutionStore = store();
    await expect(authorizeCaseAccess(resolutionStore, "case-a", { userId: "user-a", isAdmin: false })).resolves.toEqual({ allowed: true });
    await expect(authorizeCaseAccess(resolutionStore, "case-b", { userId: "user-a", isAdmin: false })).resolves.toEqual({ allowed: false, reason: "FORBIDDEN" });
    await expect(authorizeCaseAccess(resolutionStore, "missing", { userId: "user-a", isAdmin: false })).resolves.toEqual({ allowed: false, reason: "NOT_FOUND" });
  });

  it("allows an explicit admin identity without changing ownership", async () => {
    const resolutionStore = store();
    await expect(authorizeCaseAccess(resolutionStore, "case-b", { userId: "admin", isAdmin: true })).resolves.toEqual({ allowed: true });
    expect((await resolutionStore.loadCaseBundle("case-b"))?.caseRecord.ownerUserId).toBe("user-b");
  });
});
