import type { ResolutionCaseBundle } from "@/src/domain/store/model";
import type {
  TruthGraph,
  TruthGraphEdge,
  TruthGraphNode,
} from "@/src/domain/truth-graph/model";

const authoritativeNode = (
  id: string,
  kind: TruthGraphNode["kind"],
  label: string,
  detail?: string,
): TruthGraphNode => ({
  id,
  kind,
  label,
  source: "DOMAIN",
  authoritative: true,
  placeholder: false,
  ...(detail ? { detail } : {}),
});

const derivedNode = (
  id: string,
  kind: "VERIFICATION_GAP" | "EXPECTED_EVIDENCE",
  label: string,
  detail: string,
): TruthGraphNode => ({
  id,
  kind,
  label,
  source: "DERIVED",
  authoritative: false,
  placeholder: true,
  detail,
});

export function buildTruthGraph(bundle: ResolutionCaseBundle): TruthGraph {
  const nodes: TruthGraphNode[] = [];
  const edges: TruthGraphEdge[] = [];

  for (const party of bundle.caseRecord.parties) {
    nodes.push(authoritativeNode(party.id, "PARTY", party.name, party.kind));
  }

  for (const event of bundle.events) {
    nodes.push(
      authoritativeNode(event.id, "EVENT", event.kind, event.source.category),
    );
    if (event.causationId) {
      edges.push({
        id: `${event.causationId}:CAUSED:${event.id}`,
        kind: "CAUSED",
        from: event.causationId,
        to: event.id,
      });
    }
  }

  for (const evidence of bundle.evidence) {
    nodes.push(
      authoritativeNode(
        evidence.id,
        "EVIDENCE",
        evidence.contentSummary,
        evidence.verificationLevel,
      ),
    );
  }

  for (const transaction of bundle.providerTransactions) {
    nodes.push(
      authoritativeNode(
        transaction.id,
        "TRANSACTION",
        `${transaction.provider === "stripe" ? "Stripe" : "Demo Provider (simulated)"} refund ${
          transaction.providerObjectId
        }`,
        `${transaction.status} · observed ${transaction.observedAt}`,
      ),
    );
    edges.push({
      id: `${transaction.evidenceId}:RESULTED_IN:${transaction.id}`,
      kind: "RESULTED_IN",
      from: transaction.evidenceId,
      to: transaction.id,
    });
  }

  for (const claim of bundle.claims) {
    nodes.push(
      authoritativeNode(claim.id, "CLAIM", claim.statement, claim.status),
    );
    edges.push({
      id: `${claim.claimantPartyId}:ASSERTED:${claim.id}`,
      kind: "ASSERTED",
      from: claim.claimantPartyId,
      to: claim.id,
    });

    for (const relationship of claim.evidenceRelationships) {
      edges.push({
        id: `${relationship.evidenceId}:${relationship.kind}:${claim.id}`,
        kind: relationship.kind,
        from: relationship.evidenceId,
        to: claim.id,
      });
    }

    const hasSupportingEvidence = claim.evidenceRelationships.some(
      ({ kind }) => kind === "SUPPORTS_PROPOSITION",
    );

    if (!hasSupportingEvidence) {
      const hasProviderTransaction = bundle.providerTransactions.length > 0;
      const gapId = `verification-gap:${claim.id}`;
      const expectedEvidenceId = `expected-evidence:${claim.id}`;
      nodes.push(
        derivedNode(
          gapId,
          "VERIFICATION_GAP",
          hasProviderTransaction
            ? "Outcome verification remains open"
            : "Provider verification missing",
          `The proposition “${claim.statement}” has no supporting transaction evidence.`,
        ),
        derivedNode(
          expectedEvidenceId,
          "EXPECTED_EVIDENCE",
          hasProviderTransaction
            ? "Settlement or customer receipt evidence"
            : "Provider refund transaction",
          hasProviderTransaction
            ? "Independent evidence is expected before concluding that the customer received funds."
            : "A traceable provider record is expected to verify the refund proposition.",
        ),
      );
      edges.push(
        {
          id: `${claim.id}:RESULTED_IN:${gapId}`,
          kind: "RESULTED_IN",
          from: claim.id,
          to: gapId,
        },
        {
          id: `${expectedEvidenceId}:EXPECTED_TO_VERIFY:${claim.id}`,
          kind: "EXPECTED_TO_VERIFY",
          from: expectedEvidenceId,
          to: claim.id,
        },
      );
    }
  }

  for (const audit of bundle.auditRecords) {
    nodes.push(
      authoritativeNode(
        audit.id,
        "AUDIT",
        audit.ruleId,
        `${audit.previousState} → ${audit.resultingState}`,
      ),
    );
    edges.push({
      id: `${audit.triggeringEventId}:RESULTED_IN:${audit.id}`,
      kind: "RESULTED_IN",
      from: audit.triggeringEventId,
      to: audit.id,
    });
  }

  return { nodes, edges };
}
