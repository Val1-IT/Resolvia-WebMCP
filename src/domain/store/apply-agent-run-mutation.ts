import type { AgentRunRecord } from "@/src/domain/agent/model";
import { AgentRunMutationSchema } from "@/src/domain/agent/model";
import type { ResolutionCase } from "@/src/domain/cases/model";
import { buildTruthGraph } from "@/src/domain/truth-graph/build-truth-graph";
import type {
  AppendAgentRunResult,
  ResolutionCaseBundle,
  ResolutionSnapshot,
} from "@/src/domain/store/model";

export type ApplyAgentRunMutationResult = {
  result: AppendAgentRunResult;
  snapshot: ResolutionSnapshot;
};

export function applyAgentRunMutation(
  stored: ResolutionSnapshot,
  input: unknown,
): ApplyAgentRunMutationResult {
  const parsed = AgentRunMutationSchema.safeParse(input);
  if (!parsed.success) return unchanged(stored, "CASE_INTEGRITY_ERROR");

  const mutation = parsed.data;
  const run = toJsonSafeRun(mutation.agentRun);
  const storedCase = stored.cases.find((record) => record.id === run.caseId);

  if (!storedCase) return unchanged(stored, "CASE_INTEGRITY_ERROR");
  if (mutation.expectedCaseVersion !== storedCase.version) {
    return unchanged(stored, "VERSION_CONFLICT");
  }
  if (stored.agentRuns.some((candidate) => candidate.id === run.id)) {
    return unchanged(stored, "CASE_INTEGRITY_ERROR");
  }
  if (!hasValidRunVersion(run, storedCase)) {
    return unchanged(stored, "CASE_INTEGRITY_ERROR");
  }

  const bundle = bundleForCase(stored, storedCase);
  if (
    !suppliedReferencesAreValid(stored, bundle, run) ||
    !retainedReferencesAreValid(run)
  ) {
    return unchanged(stored, "CASE_INTEGRITY_ERROR");
  }

  return {
    result: "COMMITTED",
    snapshot: {
      ...stored,
      agentRuns: [...stored.agentRuns, run],
    },
  };
}

function toJsonSafeRun(run: AgentRunRecord): AgentRunRecord {
  return JSON.parse(JSON.stringify(run)) as AgentRunRecord;
}

function unchanged(
  snapshot: ResolutionSnapshot,
  result: Exclude<AppendAgentRunResult, "COMMITTED">,
): ApplyAgentRunMutationResult {
  return { result, snapshot };
}

function hasValidRunVersion(
  run: AgentRunRecord,
  storedCase: ResolutionCase,
): boolean {
  if (run.basedOnCaseVersion > storedCase.version) return false;
  if (
    run.outcome === "SUCCEEDED_VALID" &&
    run.basedOnCaseVersion !== storedCase.version
  ) {
    return false;
  }

  const isMarkedStale = run.validationErrors.includes("STALE_CASE_VERSION");
  if (run.outcome === "REJECTED_VALIDATION") {
    if (run.basedOnCaseVersion < storedCase.version && !isMarkedStale) {
      return false;
    }
    if (run.basedOnCaseVersion === storedCase.version && isMarkedStale) {
      return false;
    }
  }

  return true;
}

function bundleForCase(
  snapshot: ResolutionSnapshot,
  caseRecord: ResolutionCase,
): ResolutionCaseBundle {
  const caseId = caseRecord.id;
  return {
    caseRecord,
    events: snapshot.events.filter((record) => record.caseId === caseId),
    evidence: snapshot.evidence.filter((record) => record.caseId === caseId),
    claims: snapshot.claims.filter((record) => record.caseId === caseId),
    auditRecords: snapshot.auditRecords.filter(
      (record) => record.caseId === caseId,
    ),
    providerTransactions: snapshot.providerTransactions.filter(
      (record) => record.caseId === caseId,
    ),
    agentRuns: snapshot.agentRuns.filter((record) => record.caseId === caseId),
  };
}

function suppliedReferencesAreValid(
  snapshot: ResolutionSnapshot,
  bundle: ResolutionCaseBundle,
  run: AgentRunRecord,
): boolean {
  const caseId = run.caseId;
  const allParties = snapshot.cases.flatMap((record) => record.parties);
  const derivedGapIds = new Set(
    buildTruthGraph(bundle).nodes
      .filter(
        (node) =>
          node.kind === "VERIFICATION_GAP" &&
          node.source === "DERIVED" &&
          !node.authoritative,
      )
      .map((node) => node.id),
  );

  return (
    idsBelongToCase(run.suppliedPartyIds, allParties, caseId) &&
    idsBelongToCase(run.suppliedClaimIds, snapshot.claims, caseId) &&
    idsBelongToCase(run.suppliedEvidenceIds, snapshot.evidence, caseId) &&
    idsBelongToCase(run.suppliedEventIds, snapshot.events, caseId) &&
    run.suppliedVerificationGapIds.every((id) => derivedGapIds.has(id))
  );
}

function idsBelongToCase(
  ids: string[],
  records: Array<{ id: string; caseId: string }>,
  caseId: string,
): boolean {
  const recordsById = new Map(records.map((record) => [record.id, record]));
  return ids.every((id) => recordsById.get(id)?.caseId === caseId);
}

function retainedReferencesAreValid(run: AgentRunRecord): boolean {
  const suppliedParties = new Set(run.suppliedPartyIds);
  const suppliedClaims = new Set(run.suppliedClaimIds);
  const suppliedEvidence = new Set(run.suppliedEvidenceIds);
  const suppliedGaps = new Set(run.suppliedVerificationGapIds);

  const claimIds = [
    ...(run.assessment?.authenticatedAssertionClaimIds ?? []),
    ...(run.assessment?.supportedPropositionClaimIds ?? []),
    ...(run.assessment?.contradictedPropositionClaimIds ?? []),
    ...(run.assessment?.unknownClaimIds ?? []),
    ...(run.blocker?.claimIds ?? []),
    ...(run.recommendedAction?.claimIds ?? []),
    ...(run.uncertainty?.flatMap((item) => item.relatedClaimIds) ?? []),
    ...(run.openQuestions?.flatMap((item) => item.relatedClaimIds) ?? []),
  ];
  const evidenceIds = [
    ...(run.assessment?.providerVerifiedEvidenceIds ?? []),
    ...(run.assessment?.demoProviderVerifiedEvidenceIds ?? []),
    ...(run.blocker?.evidenceIds ?? []),
    ...(run.recommendedAction?.evidenceIds ?? []),
    ...(run.uncertainty?.flatMap((item) => item.evidenceIds) ?? []),
    ...(run.openQuestions?.flatMap((item) => item.evidenceIds) ?? []),
  ];
  const gapIds = [
    ...(run.blocker?.verificationGapIds ?? []),
    ...(run.recommendedAction?.verificationGapIds ?? []),
    ...(run.uncertainty?.flatMap((item) => item.verificationGapIds) ?? []),
    ...(run.openQuestions?.flatMap((item) => item.verificationGapIds) ?? []),
    ...(run.observedVerificationGapIds ?? []),
  ];

  return (
    claimIds.every((id) => suppliedClaims.has(id)) &&
    evidenceIds.every((id) => suppliedEvidence.has(id)) &&
    gapIds.every((id) => suppliedGaps.has(id)) &&
    (run.recommendedAction?.targetPartyId === undefined ||
      suppliedParties.has(run.recommendedAction.targetPartyId))
  );
}
