import type { AgentRunRecord } from "@/src/domain/agent/model";
import { evaluateClaimStatus } from "@/src/domain/claims/model";
import {
  projectResolutionReadiness,
  type ResolutionReadiness,
} from "@/src/domain/resolution/resolution-readiness";
import type { ResolutionCaseBundle } from "@/src/domain/store/model";
import { buildTruthGraph } from "@/src/domain/truth-graph/build-truth-graph";
import type { TruthGraph } from "@/src/domain/truth-graph/model";

export type JourneyStatus =
  | "AUTHENTICATED_CLAIM"
  | "VERIFIED"
  | "UNVERIFIED"
  | "UNKNOWN";

export type AgentAnalysisViewModel = {
  id: string;
  outcome: AgentRunRecord["outcome"];
  freshness: "CURRENT" | "STALE";
  validationPassed: boolean;
  modelId: string;
  modelVersion?: string;
  basedOnCaseVersion: number;
  analyzedAt: string;
  promptVersion: string;
  schemaVersion: string;
  validatorVersion: string;
  rawOutputDigest?: string;
  summary?: NonNullable<AgentRunRecord["summary"]>;
  assessment?: NonNullable<AgentRunRecord["assessment"]>;
  blocker?: NonNullable<AgentRunRecord["blocker"]>;
  recommendedAction?: NonNullable<AgentRunRecord["recommendedAction"]>;
  uncertainty?: NonNullable<AgentRunRecord["uncertainty"]>;
  openQuestions?: NonNullable<AgentRunRecord["openQuestions"]>;
  observedVerificationGapIds?: NonNullable<
    AgentRunRecord["observedVerificationGapIds"]
  >;
  validationErrors: AgentRunRecord["validationErrors"];
};

export type CaseWorkspaceViewModel = {
  caseId: string;
  displayId: string;
  title: string;
  summary: string;
  issueType: string;
  currentState: ResolutionCaseBundle["caseRecord"]["state"];
  version: number;
  currentBlocker: string;
  nextBestAction: string;
  agentAnalysis: AgentAnalysisViewModel | null;
  parties: Array<{
    id: string;
    name: string;
    kind: string;
  }>;
  journey: Array<{
    id: string;
    label: string;
    status: JourneyStatus;
    detail: string;
    projectionOnly: boolean;
  }>;
  claims: Array<{
    id: string;
    statement: string;
    claimant: string;
    status: ReturnType<typeof evaluateClaimStatus>;
    relationships: Array<{
      evidenceId: string;
      kind: string;
    }>;
  }>;
  evidence: Array<{
    id: string;
    type: string;
    source: string;
    contentSummary: string;
    verificationLevel: string;
    retrievedAt: string;
  }>;
  truthGraph: TruthGraph;
  timeline: Array<{
    id: string;
    kind: string;
    timestamp: string;
    source: string;
    detail: string;
  }>;
  auditTrail: Array<{
    id: string;
    ruleId: string;
    triggeringEventId: string;
    timestamp: string;
    explanation: string;
    evidenceIds: string[];
  }>;
  historyPagination: {
    page: number;
    pageSize: number;
    totalTimelineItems: number;
    totalAuditItems: number;
    totalPages: number;
    hasPrevious: boolean;
    hasNext: boolean;
  };
  verificationGap: {
    title: string;
    expectedEvidence: string;
    explanation: string;
    projectionOnly: true;
  } | null;
  resolutionReadiness: ResolutionReadiness;
};

export function buildCaseWorkspaceViewModel(
  bundle: ResolutionCaseBundle,
  options: { historyPage?: number; historyPageSize?: number } = {},
): CaseWorkspaceViewModel {
  const pageSize = boundedInteger(options.historyPageSize, 25, 1, 50);
  const totalPages = Math.max(
    1,
    Math.ceil(Math.max(bundle.events.length, bundle.auditRecords.length) / pageSize),
  );
  const page = boundedInteger(options.historyPage, 1, 1, totalPages);
  const historyOffset = (page - 1) * pageSize;
  const truthGraph = buildTruthGraph(bundle);
  const partyNames = new Map(
    bundle.caseRecord.parties.map((party) => [party.id, party.name]),
  );
  const claims = bundle.claims.map((claim) => ({
    id: claim.id,
    statement: claim.statement,
    claimant: partyNames.get(claim.claimantPartyId) ?? "Unknown party",
    status: evaluateClaimStatus(claim),
    relationships: claim.evidenceRelationships.map((relationship) => ({
      ...relationship,
    })),
  }));
  const refundClaim = bundle.claims.find(
    (claim) => claim.id === "claim-refund-processed",
  );
  const authenticatedClaim = refundClaim?.evidenceRelationships.some(
    ({ kind }) => kind === "AUTHENTICATES_ASSERTION",
  );
  const refundTransaction = bundle.providerTransactions.find(
    (transaction) => transaction.kind === "REFUND",
  );
  const transactionEvidence = refundTransaction
    ? bundle.evidence.find(
        (evidence) => evidence.id === refundTransaction.evidenceId,
      )
    : undefined;
  const providerStatus = readProviderStatus(
    transactionEvidence?.metadata.providerStatus,
  );
  const transactionProviderLabel = refundTransaction?.provider === "resolvia_demo_provider"
    ? "Demo Provider (simulated)"
    : "Stripe";
  const hasGap = truthGraph.nodes.some(
    (node) => node.kind === "VERIFICATION_GAP",
  );

  const latestAgentRun = [...bundle.agentRuns].sort(
    (left, right) =>
      left.completedAt.localeCompare(right.completedAt) ||
      left.id.localeCompare(right.id),
  ).at(-1);
  const agentAnalysis = latestAgentRun
    ? projectAgentAnalysis(latestAgentRun, bundle.caseRecord.version)
    : null;
  const resolutionReadiness = projectResolutionReadiness(bundle);

  return {
    caseId: bundle.caseRecord.id,
    displayId: bundle.caseRecord.displayId,
    title: bundle.caseRecord.title,
    summary: bundle.caseRecord.summary,
    issueType: bundle.caseRecord.issueType,
    currentState: bundle.caseRecord.state,
    version: bundle.caseRecord.version,
    currentBlocker: bundle.caseRecord.currentBlocker,
    nextBestAction: bundle.caseRecord.nextBestAction,
    agentAnalysis,
    parties: bundle.caseRecord.parties.map((party) => ({
      id: party.id,
      name: party.name,
      kind: party.kind,
    })),
    journey: [
      {
        id: "merchant-claim",
        label: "Merchant claim",
        status: authenticatedClaim ? "AUTHENTICATED_CLAIM" : "UNVERIFIED",
        detail: authenticatedClaim
          ? "The merchant communication is authentic; the proposition remains separately evaluated."
          : "The assertion source has not been authenticated.",
        projectionOnly: false,
      },
      {
        id: "refund-transaction",
        label: "Refund transaction",
        status: refundTransaction ? "VERIFIED" : "UNVERIFIED",
        detail: refundTransaction
          ? `Authoritative ${transactionProviderLabel} Test Mode refund ${refundTransaction.providerObjectId} exists.`
          : "No authoritative provider transaction is present.",
        projectionOnly: !refundTransaction,
      },
      {
        id: "processor-status",
        label: "Processor status",
        status: refundTransaction ? "VERIFIED" : "UNKNOWN",
        detail: refundTransaction
          ? `${transactionProviderLabel} Test Mode reports processor status ${providerStatus ?? refundTransaction.status}.`
          : "No authenticated payment processor status is available.",
        projectionOnly: !refundTransaction,
      },
      {
        id: "customer-received",
        label: "Customer received funds",
        status: "UNKNOWN",
        detail: "No settlement or customer receipt evidence has been recorded.",
        projectionOnly: true,
      },
    ],
    claims,
    evidence: bundle.evidence.map((record) => ({
      id: record.id,
      type: record.type,
      source: record.source,
      contentSummary: record.contentSummary,
      verificationLevel: record.verificationLevel,
      retrievedAt: record.retrievedAt,
    })),
    truthGraph,
    timeline: [...bundle.events]
      .sort(
        (left, right) =>
          right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id),
      )
      .slice(historyOffset, historyOffset + pageSize)
      .map((event) => ({
        id: event.id,
        kind: event.kind,
        timestamp: event.occurredAt,
        source: `${event.source.category} · ${event.source.runtimeMode}`,
        detail: eventPayloadSummary(event.payload),
      })),
    auditTrail: [...bundle.auditRecords]
      .sort(
        (left, right) =>
          right.timestamp.localeCompare(left.timestamp) || right.id.localeCompare(left.id),
      )
      .slice(historyOffset, historyOffset + pageSize)
      .map((audit) => ({
        id: audit.id,
        ruleId: audit.ruleId,
        triggeringEventId: audit.triggeringEventId,
        timestamp: audit.timestamp,
        explanation: `${audit.previousState} → ${audit.resultingState} — ${audit.reason}`,
        evidenceIds: [...audit.evidenceIds],
      })),
    historyPagination: {
      page,
      pageSize,
      totalTimelineItems: bundle.events.length,
      totalAuditItems: bundle.auditRecords.length,
      totalPages,
      hasPrevious: page > 1,
      hasNext: page < totalPages,
    },
    verificationGap: hasGap
      ? {
          title: refundTransaction
            ? "Customer outcome verification gap"
            : "Provider verification gap",
          expectedEvidence: refundTransaction
            ? "Independent settlement or customer receipt evidence"
            : "Traceable provider refund transaction",
          explanation: refundTransaction
            ? `${transactionProviderLabel} proves the refund exists and reports processor status; it does not by itself prove that the customer received funds.`
            : "The authenticated merchant message proves the assertion was made, not that a refund transaction exists.",
          projectionOnly: true,
        }
      : null,
    resolutionReadiness,
  };
}

function projectAgentAnalysis(
  run: AgentRunRecord,
  currentCaseVersion: number,
): AgentAnalysisViewModel {
  return {
    id: run.id,
    outcome: run.outcome,
    freshness:
      run.basedOnCaseVersion === currentCaseVersion ? "CURRENT" : "STALE",
    validationPassed: run.outcome === "SUCCEEDED_VALID",
    modelId: run.modelId,
    ...(run.modelVersion ? { modelVersion: run.modelVersion } : {}),
    basedOnCaseVersion: run.basedOnCaseVersion,
    analyzedAt: run.completedAt,
    promptVersion: run.promptVersion,
    schemaVersion: run.schemaVersion,
    validatorVersion: run.validatorVersion,
    ...(run.rawOutputDigest ? { rawOutputDigest: run.rawOutputDigest } : {}),
    ...(run.summary ? { summary: run.summary } : {}),
    ...(run.assessment ? { assessment: run.assessment } : {}),
    ...(run.blocker ? { blocker: run.blocker } : {}),
    ...(run.recommendedAction
      ? { recommendedAction: run.recommendedAction }
      : {}),
    ...(run.uncertainty ? { uncertainty: run.uncertainty } : {}),
    ...(run.openQuestions ? { openQuestions: run.openQuestions } : {}),
    ...(run.observedVerificationGapIds
      ? { observedVerificationGapIds: run.observedVerificationGapIds }
      : {}),
    validationErrors: [...run.validationErrors],
  };
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || !Number.isInteger(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, value));
}
function readProviderStatus(value: unknown): string | null {
  return typeof value === "string" &&
    [
      "pending",
      "requires_action",
      "succeeded",
      "failed",
      "canceled",
    ].includes(value)
    ? value.toUpperCase()
    : null;
}

function eventPayloadSummary(payload: Record<string, unknown>): string {
  const values = Object.entries(payload);
  if (values.length === 0) return "No additional event payload.";
  return values
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" · ");
}
