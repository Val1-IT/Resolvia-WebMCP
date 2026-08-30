import { describe, expect, it } from "vitest";

import { buildAgentResolutionInput } from "@/src/application/agents/build-agent-input";
import {
  initialRefundBundle,
  makeEvidence,
  makeEvent,
} from "@/tests/fixtures/domain";

describe("buildAgentResolutionInput", () => {
  it("recomputes claim truth and excludes provider-sensitive fields", () => {
    const bundle = initialRefundBundle();
    bundle.claims[0]!.status = "SUPPORTED";
    bundle.evidence[0]!.metadata = { secret: "must-not-leak" };
    bundle.evidence[0]!.externalReference = "C:\\private\\refund.json";
    bundle.events[0]!.payload = { token: "provider-token" };

    const projected = buildAgentResolutionInput(bundle);

    expect(projected.input.claims[0]?.evaluatedStatus).toBe("UNVERIFIED");
    expect(projected.canonicalJson).not.toContain("must-not-leak");
    expect(projected.canonicalJson).not.toContain("provider-token");
    expect(projected.canonicalJson).not.toContain("C:\\\\private");
    expect(projected.canonicalJson).not.toContain("externalReference");
    expect(projected.canonicalJson).not.toContain("metadata");
    expect(projected.canonicalJson).not.toContain("payload");
  });

  it("sorts records and references so canonical JSON and digest are stable", () => {
    const first = initialRefundBundle();
    first.evidence.push(
      makeEvidence({
        id: "evidence-a",
        relatedClaimIds: [],
        contentSummary: "Earlier evidence",
      }),
    );
    first.events.push(
      makeEvent({ id: "event-a", kind: "CASE_INTAKE_STARTED" }),
    );
    first.caseRecord.parties.reverse();

    const second = structuredClone(first);
    second.evidence.reverse();
    second.events.reverse();
    second.caseRecord.parties.reverse();

    const projectedFirst = buildAgentResolutionInput(first);
    const projectedSecond = buildAgentResolutionInput(second);

    expect(projectedFirst.input.parties.map((party) => party.id)).toEqual([
      "party-customer",
      "party-merchant",
    ]);
    expect(projectedFirst.input.evidence.map((record) => record.id)).toEqual([
      "evidence-a",
      "evidence-merchant-message",
    ]);
    expect(projectedFirst.canonicalJson).toBe(projectedSecond.canonicalJson);
    expect(projectedFirst.inputDigest).toBe(projectedSecond.inputDigest);
    expect(projectedFirst.inputDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("normalizes control characters and enforces text and collection bounds", () => {
    const bundle = initialRefundBundle();
    bundle.evidence[0]!.contentSummary = `Line 1\r\nLine 2\u0000${"x".repeat(2_100)}`;
    bundle.evidence.push(
      ...Array.from({ length: 60 }, (_, index) =>
        makeEvidence({
          id: `evidence-extra-${String(index).padStart(2, "0")}`,
          relatedClaimIds: [],
          contentSummary: `Evidence ${index}`,
        }),
      ),
    );

    const projected = buildAgentResolutionInput(bundle);
    const summary = projected.input.evidence.find(
      (record) => record.id === "evidence-merchant-message",
    )?.untrustedContentSummary;

    expect(projected.input.evidence).toHaveLength(50);
    expect(summary).not.toContain("\r");
    expect(summary).not.toContain("\u0000");
    expect(summary?.length).toBeLessThanOrEqual(2_000);
  });

  it("excludes records that do not belong to the requested case", () => {
    const bundle = initialRefundBundle();
    bundle.evidence.push(
      makeEvidence({
        id: "evidence-other-case",
        caseId: "case-other",
        relatedClaimIds: [],
      }),
    );
    bundle.events.push(
      makeEvent({ id: "event-other-case", caseId: "case-other" }),
    );

    const projected = buildAgentResolutionInput(bundle);

    expect(projected.input.evidence.map((record) => record.id)).not.toContain(
      "evidence-other-case",
    );
    expect(projected.input.events.map((record) => record.id)).not.toContain(
      "event-other-case",
    );
  });

  it("projects only derived non-authoritative verification gaps", () => {
    const projected = buildAgentResolutionInput(initialRefundBundle());

    expect(projected.input.verificationGaps).toEqual([
      {
        id: "verification-gap:claim-refund-processed",
        claimId: "claim-refund-processed",
        expectedEvidenceId: "expected-evidence:claim-refund-processed",
        label: "Provider verification missing",
      },
    ]);
    expect(projected.truthGraph.nodes.some((node) => node.kind === "TRANSACTION"))
      .toBe(false);
  });
  it("redacts credentials, contact data, and filesystem paths before model egress", () => {
    const bundle = initialRefundBundle();
    bundle.evidence[0]!.contentSummary =
      "GEMINI_API_KEY=super-secret person@example.com C:\\Users\\example\\private.json";

    const projected = buildAgentResolutionInput(bundle);

    expect(projected.canonicalJson).not.toContain("super-secret");
    expect(projected.canonicalJson).not.toContain("person@example.com");
    expect(projected.canonicalJson).not.toContain("C:\\\\Users\\\\Valen");
    expect(projected.input.evidence[0]?.untrustedContentSummary).toContain(
      "[REDACTED_TOKEN]",
    );
    expect(projected.input.evidence[0]?.untrustedContentSummary).toContain(
      "[REDACTED_EMAIL]",
    );
    expect(projected.input.evidence[0]?.untrustedContentSummary).toContain(
      "[REDACTED_PATH]",
    );
  });

  it("replaces PARTNER_RESPONSE freeform with a fixed marker before Gemini input", () => {
    const bundle = initialRefundBundle();
    bundle.evidence.push(
      makeEvidence({
        id: "evidence-partner-response",
        type: "PARTNER_RESPONSE",
        source: "Resolvia Demo Partner structured response",
        sourceProvider: "resolvia_demo_partner",
        verificationLevel: "PARTNER_VERIFIED",
        contentSummary:
          "Partner confirmed settlement for person@example.com with ref ABC-999",
        relatedClaimIds: [],
      }),
    );

    const projected = buildAgentResolutionInput(bundle);
    const partner = projected.input.evidence.find(
      (record) => record.id === "evidence-partner-response",
    );

    expect(partner?.untrustedContentSummary).toBe("[PARTNER_RESPONSE_REDACTED]");
    expect(projected.canonicalJson).not.toContain("person@example.com");
    expect(projected.canonicalJson).not.toContain("ABC-999");
    expect(projected.canonicalJson).not.toContain("Partner confirmed settlement");
  });
});
