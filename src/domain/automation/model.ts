import { z } from "zod";

const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const AutomationKindSchema = z.enum([
  "RUN_AGENT_ANALYSIS",
  "RECALCULATE_GUIDANCE",
  "EVALUATE_RESOLUTION",
]);

export const AutomationRequestStateSchema = z.enum([
  "PENDING",
  "LEASED",
  "SUCCEEDED",
  "FAILED_RETRYABLE",
  "FAILED_TERMINAL",
]);

export const AutomationRequestRecordSchema = z.object({
  id: z.string().min(1).max(256),
  automationKey: z.string().min(1).max(256),
  caseId: z.string().min(1).max(128),
  basedOnCaseVersion: z.number().int().min(1),
  kind: AutomationKindSchema,
  state: AutomationRequestStateSchema,
  leaseUntil: IsoDateTimeSchema.optional(),
  leaseOwner: z.string().min(1).max(128).optional(),
  retryCount: z.number().int().min(0).max(5),
  nextAttemptAt: IsoDateTimeSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  lastErrorClass: z.string().min(1).max(128).optional(),
});

export type AutomationKind = z.infer<typeof AutomationKindSchema>;
export type AutomationRequestRecord = z.infer<typeof AutomationRequestRecordSchema>;

export const DeadlineRecordSchema = z.object({
  id: z.string().min(1).max(256),
  caseId: z.string().min(1).max(128),
  basedOnCaseVersion: z.number().int().min(1),
  kind: z.enum(["PROVIDER_FOLLOW_UP", "PARTNER_RESPONSE"]),
  dueAt: IsoDateTimeSchema,
  state: z.enum(["OPEN", "SATISFIED", "CANCELED"]),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type DeadlineRecord = z.infer<typeof DeadlineRecordSchema>;

export type AutomationClaimInput = {
  requestId: string; workerId: string; now: string; leaseUntil: string;
};
export type AutomationCompletionInput = {
  requestId: string; workerId: string; now: string;
  outcome: "SUCCEEDED" | "FAILED_RETRYABLE" | "FAILED_TERMINAL";
  nextAttemptAt?: string; errorClass?: string;
};
export type AutomationMutationResult = "COMMITTED" | "NOT_FOUND" | "NOT_CLAIMABLE" | "CASE_INTEGRITY_ERROR";
