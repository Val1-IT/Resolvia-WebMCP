import { z } from "zod";

import { RV_1028_CASE_ID } from "@/src/demo/rv-1028";
import { RESOLUTION_REQUIREMENT_IDS } from "@/src/domain/resolution/resolution-readiness";

export const WebmcpCaseIdInputSchema = z
  .string()
  .min(1)
  .max(128)
  .refine(
    (value) =>
      value.toUpperCase() === "RV-1028" ||
      /^case-[A-Za-z0-9_-]+$/u.test(value),
    { message: "INVALID_CASE_ID" },
  );

export const WebmcpEvidenceTargetSchema = z.enum([
  "PROVIDER",
  "PARTNER",
  "CUSTOMER",
]);

export const WebmcpRequirementIdSchema = z.enum(RESOLUTION_REQUIREMENT_IDS);

export const WebmcpToolNameSchema = z.enum([
  "resolvia_get_case",
  "resolvia_get_truth_graph",
  "resolvia_list_resolution_gaps",
  "resolvia_check_resolution_readiness",
  "resolvia_prepare_evidence_request",
]);

export type WebmcpToolName = z.infer<typeof WebmcpToolNameSchema>;

export function normalizeWebmcpCaseId(raw: string): string {
  const parsed = WebmcpCaseIdInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new WebmcpInputError("INVALID_CASE_ID");
  }
  return parsed.data.toUpperCase() === "RV-1028"
    ? RV_1028_CASE_ID
    : parsed.data;
}

export class WebmcpInputError extends Error {
  readonly code: "INVALID_CASE_ID" | "INVALID_INPUT";

  constructor(code: "INVALID_CASE_ID" | "INVALID_INPUT", message?: string) {
    super(message ?? code);
    this.name = "WebmcpInputError";
    this.code = code;
  }
}

export class WebmcpAuthorizationError extends Error {
  readonly code: "NOT_FOUND" | "FORBIDDEN" | "UNAUTHORIZED" | "UNAVAILABLE";

  constructor(
    code: "NOT_FOUND" | "FORBIDDEN" | "UNAUTHORIZED" | "UNAVAILABLE",
  ) {
    super(code);
    this.name = "WebmcpAuthorizationError";
    this.code = code;
  }
}

export class WebmcpToolError extends Error {
  readonly code:
    | "REQUIREMENT_NOT_FOUND"
    | "REQUIREMENT_ALREADY_SATISFIED"
    | "REQUIREMENT_NOT_ACTIONABLE"
    | "CASE_NOT_FOUND";

  constructor(
    code:
      | "REQUIREMENT_NOT_FOUND"
      | "REQUIREMENT_ALREADY_SATISFIED"
      | "REQUIREMENT_NOT_ACTIONABLE"
      | "CASE_NOT_FOUND",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "WebmcpToolError";
    this.code = code;
  }
}
