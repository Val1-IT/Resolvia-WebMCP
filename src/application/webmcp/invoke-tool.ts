import { z } from "zod";

import type { SessionIdentity } from "@/src/application/auth/authorize-case-access";
import type { ResolutionStore } from "@/src/application/ports/resolution-store";
import {
  assertNoSecretFields,
  loadAuthorizedCaseBundle,
  prepareEvidenceRequestDraft,
  projectWebmcpCaseSummary,
  projectWebmcpGaps,
  projectWebmcpReadiness,
  projectWebmcpTruthGraph,
} from "@/src/application/webmcp/case-tool-service";
import {
  WebmcpAuthorizationError,
  WebmcpCaseIdInputSchema,
  WebmcpEvidenceTargetSchema,
  WebmcpInputError,
  WebmcpRequirementIdSchema,
  WebmcpToolError,
  WebmcpToolNameSchema,
  type WebmcpToolName,
} from "@/src/application/webmcp/schemas";

const InvokeBodySchema = z.object({
  tool: WebmcpToolNameSchema,
  arguments: z.record(z.string(), z.unknown()),
});

export type WebmcpInvokeResult =
  | { ok: true; tool: WebmcpToolName; result: unknown }
  | {
      ok: false;
      status: number;
      error: string;
      code: string;
    };

export async function invokeWebmcpTool(input: {
  store: ResolutionStore;
  identity: SessionIdentity;
  body: unknown;
}): Promise<WebmcpInvokeResult> {
  const parsed = InvokeBodySchema.safeParse(input.body);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: "Malformed tool invocation.",
      code: "INVALID_INPUT",
    };
  }

  const { tool, arguments: args } = parsed.data;
  const caseIdRaw = args.caseId;
  const caseIdParsed = WebmcpCaseIdInputSchema.safeParse(caseIdRaw);
  if (!caseIdParsed.success) {
    return {
      ok: false,
      status: 400,
      error: "Invalid caseId.",
      code: "INVALID_CASE_ID",
    };
  }

  try {
    const { bundle } = await loadAuthorizedCaseBundle(
      input.store,
      input.identity,
      caseIdParsed.data,
    );

    let result: unknown;
    switch (tool) {
      case "resolvia_get_case":
        result = projectWebmcpCaseSummary(bundle);
        break;
      case "resolvia_get_truth_graph":
        result = projectWebmcpTruthGraph(bundle);
        break;
      case "resolvia_list_resolution_gaps":
        result = projectWebmcpGaps(bundle);
        break;
      case "resolvia_check_resolution_readiness":
        result = projectWebmcpReadiness(bundle);
        break;
      case "resolvia_prepare_evidence_request": {
        const requirementId = WebmcpRequirementIdSchema.safeParse(
          args.requirementId,
        );
        const target = WebmcpEvidenceTargetSchema.safeParse(args.target);
        if (!requirementId.success || !target.success) {
          return {
            ok: false,
            status: 400,
            error: "Invalid evidence-request arguments.",
            code: "INVALID_INPUT",
          };
        }
        result = prepareEvidenceRequestDraft({
          bundle,
          requirementId: requirementId.data,
          target: target.data,
        });
        break;
      }
      default:
        return {
          ok: false,
          status: 400,
          error: "Unknown tool.",
          code: "INVALID_INPUT",
        };
    }

    assertNoSecretFields(result);
    return { ok: true, tool, result };
  } catch (error) {
    if (error instanceof WebmcpInputError) {
      return {
        ok: false,
        status: 400,
        error: error.message,
        code: error.code,
      };
    }
    if (error instanceof WebmcpAuthorizationError) {
      const status =
        error.code === "UNAUTHORIZED"
          ? 401
          : error.code === "UNAVAILABLE"
            ? 503
            : 404;
      return {
        ok: false,
        status,
        error: error.code === "UNAVAILABLE" ? "Service unavailable." : "Case not found.",
        code: error.code === "FORBIDDEN" ? "NOT_FOUND" : error.code,
      };
    }
    if (error instanceof WebmcpToolError) {
      return {
        ok: false,
        status: 409,
        error: error.message,
        code: error.code,
      };
    }
    throw error;
  }
}

/** Explicit allowlist — high-risk mutation tools must never appear here. */
export const WEBMCP_TOOL_NAMES = WebmcpToolNameSchema.options;

export const HIGH_RISK_TOOL_NAMES_FORBIDDEN = [
  "resolve_case",
  "approve_refund",
  "refund_customer",
  "promote_evidence",
  "mark_provider_verified",
  "set_case_status",
  "write_truth_graph",
  "execute_resolution",
] as const;
