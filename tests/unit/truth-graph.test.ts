import { describe, expect, it } from "vitest";

import { buildTruthGraph } from "@/src/domain/truth-graph/build-truth-graph";
import { initialRefundBundle, makeClaim } from "@/tests/fixtures/domain";

describe("buildTruthGraph", () => {
  it("distinguishes an authenticated assertion from proposition support", () => {
    const graph = buildTruthGraph(initialRefundBundle());

    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        kind: "ASSERTED",
        from: "party-merchant",
        to: "claim-refund-processed",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        kind: "AUTHENTICATES_ASSERTION",
        from: "evidence-merchant-message",
        to: "claim-refund-processed",
      }),
    );
    expect(
      graph.edges.some((edge) => edge.kind === "SUPPORTS_PROPOSITION"),
    ).toBe(false);
  });

  it("derives a non-authoritative provider verification gap", () => {
    const graph = buildTruthGraph(initialRefundBundle());

    expect(graph.nodes).toContainEqual(
      expect.objectContaining({
        kind: "VERIFICATION_GAP",
        source: "DERIVED",
        authoritative: false,
        placeholder: true,
      }),
    );
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({
        kind: "EXPECTED_EVIDENCE",
        source: "DERIVED",
        authoritative: false,
        placeholder: true,
      }),
    );
    expect(graph.nodes.some((node) => node.kind === "TRANSACTION")).toBe(
      false,
    );
  });

  it("does not derive a verification gap when provider evidence supports the claim", () => {
    const bundle = initialRefundBundle();
    bundle.claims = [
      makeClaim({
        status: "SUPPORTED",
        evidenceRelationships: [
          {
            evidenceId: "evidence-merchant-message",
            kind: "SUPPORTS_PROPOSITION",
          },
        ],
      }),
    ];

    const graph = buildTruthGraph(bundle);

    expect(
      graph.nodes.some((node) => node.kind === "VERIFICATION_GAP"),
    ).toBe(false);
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        kind: "SUPPORTS_PROPOSITION",
        from: "evidence-merchant-message",
        to: "claim-refund-processed",
      }),
    );
  });

  it("marks records from the bundle as authoritative domain nodes", () => {
    const graph = buildTruthGraph(initialRefundBundle());

    for (const id of [
      "party-merchant",
      "claim-refund-processed",
      "evidence-merchant-message",
      "event-intake",
      "audit-transition-1",
    ]) {
      expect(graph.nodes).toContainEqual(
        expect.objectContaining({
          id,
          source: "DOMAIN",
          authoritative: true,
          placeholder: false,
        }),
      );
    }
  });
});
