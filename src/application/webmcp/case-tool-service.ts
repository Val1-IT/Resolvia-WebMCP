import type { SessionIdentity } from "@/src/application/auth/authorize-case-access";
import { authorizeCaseAccess } from "@/src/application/auth/authorize-case-access";
import {
  normalizeWebmcpCaseId,
  WebmcpAuthorizationError,
  WebmcpEvidenceTargetSchema,
  WebmcpInputError,
  WebmcpRequirementIdSchema,
  WebmcpToolError,
} from "@/src/application/webmcp/schemas";
import type { ResolutionStore } from "@/src/application/ports/resolution-store";
import { evaluateClaimStatus } from "@/src/domain/claims/model";
import {
  listResolutionGaps,
  projectResolutionReadiness,
  type ResolutionRequirementId,
} from "@/src/domain/resolution/resolution-readiness";
import type { ResolutionCaseBundle } from "@/src/domain/store/model";
import { buildTruthGraph } from "@/src/domain/truth-graph/build-truth-graph";

export type WebmcpCaseSummary = {
  caseId: string;
  displayId: string;
  caseVersion: number;
  status: string;
  issueType: string;
  currentBlocker: string;
  nextBestAction: string;
};

export type WebmcpTruthGraphProjection = {
  caseId: string;
  caseVersion: number;
  claims: Array<{
    id: string;
    statement: string;
    /** Deterministic claim evaluation — not evidence. */
    claimStatus: ReturnType<typeof evaluateClaimStatus>;
    evidenceRelationships: Array<{ evidenceId: string; kind: string }>;
  }>;
  evidence: Array<{
    id: string;
    type: string;
    source: string;
    verificationLevel: string;
    contentSummary: string;
  }>;
  verificationGaps: Array<{
    id: string;
    label: string;
    detail?: string;
    expectedEvidenceId?: string;
  }>;
  note: "Claim records are not evidence. Evidence provenance is authoritative and is not reinterpreted by WebMCP.";
};

const FORBIDDEN_OUTPUT_KEYS = [
  "ownerUserId",
  "hmac",
  "token",
  "secret",
  "serviceAccount",
  "privateKey",
  "apiKey",
  "partnerToken",
  "rawPrompt",
  "gemini",
] as const;

export async function loadAuthorizedCaseBundle(
  store: ResolutionStore,
  identity: SessionIdentity,
  rawCaseId: string,
): Promise<{ domainCaseId: string; bundle: ResolutionCaseBundle }> {
  let domainCaseId: string;
  try {
    domainCaseId = normalizeWebmcpCaseId(rawCaseId);
  } catch (error) {
    if (error instanceof WebmcpInputError) throw error;
    throw new WebmcpInputError("INVALID_CASE_ID");
  }

  const authorization = await authorizeCaseAccess(store, domainCaseId, identity);
  if (!authorization.allowed) {
    if (authorization.reason === "AUTHORIZATION_UNAVAILABLE") {
      throw new WebmcpAuthorizationError("UNAVAILABLE");
    }
    // Collapse FORBIDDEN with NOT_FOUND — same as case page.
    throw new WebmcpAuthorizationError("NOT_FOUND");
  }

  const bundle = await store.loadCaseBundle(domainCaseId);
  if (!bundle) throw new WebmcpAuthorizationError("NOT_FOUND");
  return { domainCaseId, bundle };
}

export function projectWebmcpCaseSummary(
  bundle: ResolutionCaseBundle,
): WebmcpCaseSummary {
  return {
    caseId: bundle.caseRecord.id,
    displayId: bundle.caseRecord.displayId,
    caseVersion: bundle.caseRecord.version,
    status: bundle.caseRecord.state,
    issueType: bundle.caseRecord.issueType,
    currentBlocker: bundle.caseRecord.currentBlocker,
    nextBestAction: bundle.caseRecord.nextBestAction,
  };
}

export function projectWebmcpTruthGraph(
  bundle: ResolutionCaseBundle,
): WebmcpTruthGraphProjection {
  const graph = buildTruthGraph(bundle);
  const gapNodes = graph.nodes.filter(
    (node) => node.kind === "VERIFICATION_GAP",
  );
  return {
    caseId: bundle.caseRecord.id,
    caseVersion: bundle.caseRecord.version,
    claims: bundle.claims
      .filter((claim) => claim.caseId === bundle.caseRecord.id)
      .map((claim) => ({
        id: claim.id,
        statement: claim.statement,
        claimStatus: evaluateClaimStatus(claim),
        evidenceRelationships: claim.evidenceRelationships.map((rel) => ({
          evidenceId: rel.evidenceId,
          kind: rel.kind,
        })),
      })),
    evidence: bundle.evidence
      .filter((evidence) => evidence.caseId === bundle.caseRecord.id)
      .map((evidence) => ({
        id: evidence.id,
        type: evidence.type,
        source: evidence.source,
        verificationLevel: evidence.verificationLevel,
        contentSummary: evidence.contentSummary.slice(0, 500),
      })),
    verificationGaps: gapNodes.map((node) => {
      const expected = graph.edges.find(
        (edge) =>
          edge.from === node.id && edge.kind === "EXPECTED_TO_VERIFY",
      );
      return {
        id: node.id,
        label: node.label,
        ...(node.detail ? { detail: node.detail } : {}),
        ...(expected ? { expectedEvidenceId: expected.to } : {}),
      };
    }),
    note: "Claim records are not evidence. Evidence provenance is authoritative and is not reinterpreted by WebMCP.",
  };
}

export function prepareEvidenceRequestDraft(input: {
  bundle: ResolutionCaseBundle;
  requirementId: string;
  target: string;
}): {
  requiresHumanApproval: true;
  caseId: string;
  caseVersion: number;
  target: "PROVIDER" | "PARTNER" | "CUSTOMER";
  requirementId: ResolutionRequirementId;
  draft: {
    subject: string;
    body: string;
    requestedEvidenceType: string;
  };
  authority: "DRAFT_ONLY";
} {
  const requirementId = WebmcpRequirementIdSchema.safeParse(input.requirementId);
  if (!requirementId.success) {
    throw new WebmcpToolError("REQUIREMENT_NOT_FOUND");
  }
  const target = WebmcpEvidenceTargetSchema.safeParse(input.target);
  if (!target.success) {
    throw new WebmcpInputError("INVALID_INPUT", "INVALID_TARGET");
  }

  const readiness = projectResolutionReadiness(input.bundle);
  const requirement = readiness.requirements.find(
    (row) => row.id === requirementId.data,
  );
  if (!requirement) throw new WebmcpToolError("REQUIREMENT_NOT_FOUND");
  if (requirement.status === "SATISFIED") {
    throw new WebmcpToolError("REQUIREMENT_ALREADY_SATISFIED");
  }
  if (requirement.id === "contradictions_resolved") {
    throw new WebmcpToolError(
      "REQUIREMENT_NOT_ACTIONABLE",
      "Contradiction resolution is not an evidence-request draft.",
    );
  }
  if (
    requirement.id === "customer_receipt_confirmation" &&
    target.data !== "CUSTOMER" &&
    target.data !== "PARTNER"
  ) {
    throw new WebmcpToolError(
      "REQUIREMENT_NOT_ACTIONABLE",
      "Customer receipt confirmation must target CUSTOMER or PARTNER.",
    );
  }
  if (
    requirement.id === "provider_transaction_verified" &&
    target.data !== "PROVIDER"
  ) {
    throw new WebmcpToolError(
      "REQUIREMENT_NOT_ACTIONABLE",
      "Provider verification must target PROVIDER.",
    );
  }

  const requestedEvidenceType =
    requirement.id === "customer_receipt_confirmation"
      ? "CUSTOMER_RECEIPT"
      : "PROVIDER_REFUND_TRANSACTION";

  const subject =
    requirement.id === "customer_receipt_confirmation"
      ? `Resolvia case ${input.bundle.caseRecord.displayId}: confirm refund receipt`
      : `Resolvia case ${input.bundle.caseRecord.displayId}: provide provider refund verification`;

  const body =
    requirement.id === "customer_receipt_confirmation"
      ? [
          `Case ${input.bundle.caseRecord.displayId} (${input.bundle.caseRecord.id}) still lacks independently confirmed customer receipt evidence.`,
          `Current case version: ${input.bundle.caseRecord.version}.`,
          `Please confirm whether the customer received the refund for issue ${input.bundle.caseRecord.issueType}.`,
          "This draft was prepared by WebMCP and requires human approval before any send.",
        ].join("\n\n")
      : [
          `Case ${input.bundle.caseRecord.displayId} (${input.bundle.caseRecord.id}) still lacks a succeeded provider-verified refund transaction.`,
          `Current case version: ${input.bundle.caseRecord.version}.`,
          "Please supply the authoritative provider refund transaction evidence.",
          "This draft was prepared by WebMCP and requires human approval before any send.",
        ].join("\n\n");

  return {
    requiresHumanApproval: true,
    caseId: input.bundle.caseRecord.id,
    caseVersion: input.bundle.caseRecord.version,
    target: target.data,
    requirementId: requirementId.data,
    draft: {
      subject,
      body,
      requestedEvidenceType,
    },
    authority: "DRAFT_ONLY",
  };
}

export function assertNoSecretFields(payload: unknown): void {
  const json = JSON.stringify(payload);
  for (const key of FORBIDDEN_OUTPUT_KEYS) {
    if (new RegExp(`"${key}"\\s*:`, "i").test(json)) {
      throw new Error(`WEBMCP_DATA_MINIMIZATION_VIOLATION:${key}`);
    }
  }
}

export function projectWebmcpReadiness(bundle: ResolutionCaseBundle) {
  return projectResolutionReadiness(bundle);
}

export function projectWebmcpGaps(bundle: ResolutionCaseBundle) {
  const readiness = projectResolutionReadiness(bundle);
  return {
    caseId: readiness.caseId,
    caseVersion: readiness.caseVersion,
    gaps: listResolutionGaps(readiness),
    ready: readiness.ready,
  };
}
