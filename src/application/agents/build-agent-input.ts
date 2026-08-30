import { createHash } from "node:crypto";

import type { CaseState, PartyKind } from "@/src/domain/cases/model";
import { redactSensitiveText } from "@/src/domain/privacy/redact-sensitive-text";
import { actionRequiresTarget, RESOLUTION_ACTION_CODES } from "@/src/domain/agent/policy";
import {
  evaluateClaimStatus,
  type ClaimStatus,
  type EvidenceRelationshipKind,
} from "@/src/domain/claims/model";
import type {
  EvidenceType,
  VerificationLevel,
} from "@/src/domain/evidence/model";
import type {
  EventSourceCategory,
  ResolutionEventKind,
  RuntimeMode,
} from "@/src/domain/events/model";
import type { ResolutionCaseBundle } from "@/src/domain/store/model";
import { buildTruthGraph } from "@/src/domain/truth-graph/build-truth-graph";
import type { TruthGraph } from "@/src/domain/truth-graph/model";

const LIMITS = {
  id: 128,
  shortText: 256,
  narrative: 2_000,
  parties: 25,
  claims: 50,
  evidence: 50,
  events: 100,
  gaps: 50,
  references: 50,
} as const;

export type AgentResolutionInput = {
  case: {
    id: string;
    version: number;
    state: CaseState;
    issueType: string;
    title: string;
    summary: string;
    currentBlocker: string;
    nextBestAction: string;
  };
  actionPolicy: Array<{
    code: (typeof RESOLUTION_ACTION_CODES)[number];
    targetPartyIds: string[];
  }>;
  parties: Array<{ id: string; kind: PartyKind; name: string }>;
  claims: Array<{
    id: string;
    statement: string;
    claimantPartyId: string;
    sourceEventId: string;
    evaluatedStatus: ClaimStatus;
    evidenceRelationships: Array<{
      evidenceId: string;
      kind: EvidenceRelationshipKind;
    }>;
  }>;
  evidence: Array<{
    id: string;
    type: EvidenceType;
    source: string;
    sourceProvider?: string;
    verificationLevel: VerificationLevel;
    relatedClaimIds: string[];
    untrustedContentSummary: string;
  }>;
  events: Array<{
    id: string;
    kind: ResolutionEventKind;
    sourceCategory: EventSourceCategory;
    runtimeMode: RuntimeMode;
    occurredAt: string;
    causationId?: string;
  }>;
  verificationGaps: Array<{
    id: string;
    claimId: string;
    expectedEvidenceId: string;
    label: string;
  }>;
};

export type BuiltAgentResolutionInput = {
  input: AgentResolutionInput;
  canonicalJson: string;
  inputDigest: string;
  truthGraph: TruthGraph;
};

export function buildAgentResolutionInput(
  bundle: ResolutionCaseBundle,
): BuiltAgentResolutionInput {
  const scopedBundle = caseScopedBundle(bundle);
  const truthGraph = buildTruthGraph(scopedBundle);
  const selectedEvidence = [...scopedBundle.evidence]
    .sort(
      (left, right) =>
        Number(right.relatedClaimIds.length > 0) -
          Number(left.relatedClaimIds.length > 0) ||
        left.id.localeCompare(right.id),
    )
    .slice(0, LIMITS.evidence)
    .sort(byId);
  const verificationGaps = projectVerificationGaps(truthGraph);

  const input: AgentResolutionInput = {
    case: {
      id: normalizeId(scopedBundle.caseRecord.id),
      version: scopedBundle.caseRecord.version,
      state: scopedBundle.caseRecord.state,
      issueType: normalizeText(scopedBundle.caseRecord.issueType, LIMITS.shortText),
      title: normalizeText(scopedBundle.caseRecord.title, LIMITS.shortText),
      summary: normalizeText(scopedBundle.caseRecord.summary, LIMITS.narrative),
      currentBlocker: normalizeText(
        scopedBundle.caseRecord.currentBlocker,
        LIMITS.narrative,
      ),
      nextBestAction: normalizeText(
        scopedBundle.caseRecord.nextBestAction,
        LIMITS.narrative,
      ),
    },
    actionPolicy: projectActionPolicy(
      scopedBundle.caseRecord.parties,
      verificationGaps,
    ),
    parties: [...scopedBundle.caseRecord.parties]
      .sort(byId)
      .slice(0, LIMITS.parties)
      .map((party) => ({
        id: normalizeId(party.id),
        kind: party.kind,
        name: normalizeText(party.name, LIMITS.shortText),
      })),
    claims: [...scopedBundle.claims]
      .sort(byId)
      .slice(0, LIMITS.claims)
      .map((claim) => ({
        id: normalizeId(claim.id),
        statement: normalizeText(claim.statement, LIMITS.narrative),
        claimantPartyId: normalizeId(claim.claimantPartyId),
        sourceEventId: normalizeId(claim.sourceEventId),
        evaluatedStatus: evaluateClaimStatus(claim),
        evidenceRelationships: [...claim.evidenceRelationships]
          .sort(
            (left, right) =>
              left.evidenceId.localeCompare(right.evidenceId) ||
              left.kind.localeCompare(right.kind),
          )
          .slice(0, LIMITS.references)
          .map((relationship) => ({
            evidenceId: normalizeId(relationship.evidenceId),
            kind: relationship.kind,
          })),
      })),
    evidence: selectedEvidence.map((evidence) => ({
      id: normalizeId(evidence.id),
      type: evidence.type,
      source: normalizeText(evidence.source, LIMITS.shortText),
      ...(evidence.sourceProvider
        ? {
            sourceProvider: normalizeText(
              evidence.sourceProvider,
              LIMITS.shortText,
            ),
          }
        : {}),
      verificationLevel: evidence.verificationLevel,
      relatedClaimIds: sortedIds(evidence.relatedClaimIds),
      untrustedContentSummary:
        evidence.type === "PARTNER_RESPONSE"
          ? "[PARTNER_RESPONSE_REDACTED]"
          : redactSensitiveText(
              normalizeText(evidence.contentSummary, LIMITS.narrative),
            ),
    })),
    events: [...scopedBundle.events]
      .sort(byId)
      .slice(0, LIMITS.events)
      .map((event) => ({
        id: normalizeId(event.id),
        kind: event.kind,
        sourceCategory: event.source.category,
        runtimeMode: event.source.runtimeMode,
        occurredAt: event.occurredAt,
        ...(event.causationId
          ? { causationId: normalizeId(event.causationId) }
          : {}),
      })),
    verificationGaps,
  };

  const canonicalJson = JSON.stringify(input);
  const inputDigest = `sha256:${createHash("sha256")
    .update(canonicalJson, "utf8")
    .digest("hex")}`;
function projectActionPolicy(
  parties: ResolutionCaseBundle["caseRecord"]["parties"],
  verificationGaps: AgentResolutionInput["verificationGaps"],
): AgentResolutionInput["actionPolicy"] {
  return RESOLUTION_ACTION_CODES.flatMap((code) => {
    if (code === "WAIT_FOR_NEW_EVIDENCE" && verificationGaps.length === 0) {
      return [];
    }

    const targetPartyIds =
      code === "REQUEST_USER_EVIDENCE"
        ? sortedIds(
            parties
              .filter((party) => party.kind === "CUSTOMER")
              .map((party) => party.id),
          )
        : code === "PREPARE_EXTERNAL_FOLLOW_UP"
          ? sortedIds(
              parties
                .filter((party) => party.kind !== "CUSTOMER")
                .map((party) => party.id),
            )
          : [];

    if (actionRequiresTarget(code) && targetPartyIds.length === 0) return [];
    return [{ code, targetPartyIds }];
  });
}

  return { input, canonicalJson, inputDigest, truthGraph };
}

function caseScopedBundle(bundle: ResolutionCaseBundle): ResolutionCaseBundle {
  const caseId = bundle.caseRecord.id;
  return {
    caseRecord: {
      ...bundle.caseRecord,
      parties: bundle.caseRecord.parties.filter(
        (record) => record.caseId === caseId,
      ),
    },
    events: bundle.events.filter((record) => record.caseId === caseId),
    evidence: bundle.evidence.filter((record) => record.caseId === caseId),
    claims: bundle.claims.filter((record) => record.caseId === caseId),
    auditRecords: bundle.auditRecords.filter((record) => record.caseId === caseId),
    providerTransactions: bundle.providerTransactions.filter(
      (record) => record.caseId === caseId,
    ),
    agentRuns: bundle.agentRuns.filter((record) => record.caseId === caseId),
  };
}

function projectVerificationGaps(
  truthGraph: TruthGraph,
): AgentResolutionInput["verificationGaps"] {
  const nodes = new Map(truthGraph.nodes.map((node) => [node.id, node]));
  return truthGraph.nodes
    .filter(
      (node) =>
        node.kind === "VERIFICATION_GAP" &&
        node.source === "DERIVED" &&
        !node.authoritative &&
        node.placeholder,
    )
    .sort(byId)
    .slice(0, LIMITS.gaps)
    .flatMap((gap) => {
      const claimEdge = truthGraph.edges.find(
        (edge) => edge.kind === "RESULTED_IN" && edge.to === gap.id,
      );
      if (!claimEdge) return [];
      const expectedEdge = truthGraph.edges.find(
        (edge) =>
          edge.kind === "EXPECTED_TO_VERIFY" && edge.to === claimEdge.from,
      );
      const expectedNode = expectedEdge ? nodes.get(expectedEdge.from) : undefined;
      if (
        !expectedEdge ||
        expectedNode?.kind !== "EXPECTED_EVIDENCE" ||
        expectedNode.source !== "DERIVED" ||
        expectedNode.authoritative ||
        !expectedNode.placeholder
      ) {
        return [];
      }

      return [
        {
          id: normalizeId(gap.id),
          claimId: normalizeId(claimEdge.from),
          expectedEvidenceId: normalizeId(expectedEdge.from),
          label: normalizeText(gap.label, LIMITS.shortText),
        },
      ];
    });
}

function normalizeId(value: string): string {
  return normalizeText(value, LIMITS.id);
}

function normalizeText(value: string, maximum: number): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/gu, "")
    .trim()
    .slice(0, maximum);
}

function sortedIds(ids: string[]): string[] {
  return [...new Set(ids.map(normalizeId))]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, LIMITS.references);
}

function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id);
}
