import { describe, expect, it } from "vitest";

import {
  evaluateClaimStatus,
  type EvidenceRelationshipKind,
} from "@/src/domain/claims/model";
import { makeClaim } from "@/tests/fixtures/domain";

const claimWith = (...kinds: EvidenceRelationshipKind[]) =>
  makeClaim({
    evidenceRelationships: kinds.map((kind, index) => ({
      evidenceId: `evidence-${index}`,
      kind,
    })),
  });

describe("evaluateClaimStatus", () => {
  it("leaves an authenticated assertion unverified", () => {
    expect(evaluateClaimStatus(claimWith("AUTHENTICATES_ASSERTION"))).toBe(
      "UNVERIFIED",
    );
  });

  it("leaves a claim with no relationships unverified", () => {
    expect(evaluateClaimStatus(claimWith())).toBe("UNVERIFIED");
  });

  it.each([
    [["SUPPORTS_PROPOSITION"], "SUPPORTED"],
    [["CONTRADICTS_PROPOSITION"], "CONTRADICTED"],
    [
      ["SUPPORTS_PROPOSITION", "CONTRADICTS_PROPOSITION"],
      "PARTIALLY_VERIFIED",
    ],
  ] as const)(
    "evaluates substantive relationships %j as %s",
    (relationships, status) => {
      expect(evaluateClaimStatus(claimWith(...relationships))).toBe(status);
    },
  );
});
