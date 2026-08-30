import { z } from "zod";

const PLAIN_TEXT_PATTERN =
  /^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]*$/u;
const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const MAX_REFERENCE_IDS = 50;

export const RecordIdSchema = z.string().trim().min(1).max(128);

const boundedText = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .regex(PLAIN_TEXT_PATTERN, "Control characters are not allowed");

const UniqueIdArraySchema = z
  .array(RecordIdSchema)
  .max(MAX_REFERENCE_IDS)
  .superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "IDs must be unique",
      });
    }
  });

const DigestSchema = z.string().regex(SHA256_DIGEST_PATTERN);
const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const ApprovalLevelSchema = z.enum([
  "SAFE_INTERNAL",
  "USER_APPROVAL_REQUIRED",
  "OUT_OF_SCOPE_HIGH_RISK",
]);

export const ActionTypeSchema = z.enum([
  "REVIEW_EXISTING_EVIDENCE",
  "WAIT_FOR_NEW_EVIDENCE",
  "REQUEST_USER_EVIDENCE",
  "PREPARE_EXTERNAL_FOLLOW_UP",
  "REFER_TO_HUMAN_REVIEW",
  "NO_PERMITTED_ACTION",
]);

export const BlockerCodeSchema = z.enum([
  "MISSING_SUPPORTING_EVIDENCE",
  "CONTRADICTORY_EVIDENCE",
  "WAITING_ON_EXTERNAL_EVIDENCE",
  "WAITING_ON_USER_INPUT",
  "NO_VERIFIED_RESOLUTION",
  "NO_CURRENT_BLOCKER",
]);

export const UncertaintyCodeSchema = z.enum([
  "MISSING_EVIDENCE",
  "CONFLICTING_EVIDENCE",
  "EXTERNAL_STATUS_UNKNOWN",
  "USER_INTENT_UNKNOWN",
]);

const CurrentAssessmentSchema = z
  .object({
    authenticatedAssertionClaimIds: UniqueIdArraySchema,
    supportedPropositionClaimIds: UniqueIdArraySchema,
    contradictedPropositionClaimIds: UniqueIdArraySchema,
    unknownClaimIds: UniqueIdArraySchema,
    providerVerifiedEvidenceIds: UniqueIdArraySchema,
    demoProviderVerifiedEvidenceIds: UniqueIdArraySchema.default([]),
  })
  .strict();

const BlockerSchema = z
  .object({
    code: BlockerCodeSchema,
    explanation: boundedText(2_000),
    claimIds: UniqueIdArraySchema,
    evidenceIds: UniqueIdArraySchema,
    verificationGapIds: UniqueIdArraySchema,
  })
  .strict();

const NextBestActionSchema = z
  .object({
    type: ActionTypeSchema,
    description: boundedText(1_000),
    rationale: boundedText(2_000),
    targetPartyId: RecordIdSchema.optional(),
    claimIds: UniqueIdArraySchema,
    evidenceIds: UniqueIdArraySchema,
    verificationGapIds: UniqueIdArraySchema,
    approvalLevel: ApprovalLevelSchema,
  })
  .strict();

const OpenQuestionSchema = z
  .object({
    question: boundedText(1_000),
    relatedClaimIds: UniqueIdArraySchema,
    evidenceIds: UniqueIdArraySchema,
    verificationGapIds: UniqueIdArraySchema,
  })
  .strict();

const UncertaintySchema = z
  .object({
    code: UncertaintyCodeSchema,
    explanation: boundedText(2_000),
    relatedClaimIds: UniqueIdArraySchema,
    evidenceIds: UniqueIdArraySchema,
    verificationGapIds: UniqueIdArraySchema,
  })
  .strict();

const ObservedVerificationGapSchema = z
  .object({
    gapId: RecordIdSchema,
    claimId: RecordIdSchema,
    expectedEvidenceId: RecordIdSchema,
    explanation: boundedText(2_000),
  })
  .strict();

export const AgentResolutionProposalSchema = z
  .object({
    caseId: RecordIdSchema,
    basedOnCaseVersion: z.number().int().min(1),
    summary: boundedText(2_000),
    currentAssessment: CurrentAssessmentSchema,
    blocker: BlockerSchema,
    nextBestAction: NextBestActionSchema,
    openQuestions: z.array(OpenQuestionSchema).max(10),
    uncertainty: z.array(UncertaintySchema).max(10),
    observedVerificationGaps: z.array(ObservedVerificationGapSchema).max(25),
  })
  .strict();

export const AgentRunOutcomeSchema = z.enum([
  "SUCCEEDED_VALID",
  "REJECTED_VALIDATION",
  "FAILED_CONFIGURATION",
  "FAILED_TIMEOUT",
  "FAILED_NETWORK",
  "FAILED_QUOTA",
  "FAILED_MALFORMED_OUTPUT",
  "FAILED_SCHEMA",
]);

export const AgentProposalValidationErrorCodeSchema = z.enum([
  "CASE_ID_MISMATCH",
  "STALE_CASE_VERSION",
  "MISSING_REFERENCE",
  "CROSS_CASE_REFERENCE",
  "CROSS_CASE_EVIDENCE_REFERENCE",
  "UNKNOWN_VERIFICATION_GAP",
  "ASSESSMENT_MISMATCH",
  "PROVIDER_VERIFICATION_PROMOTION",
  "AUTHENTICATION_TRUTH_PROMOTION",
  "UNKNOWN_PROMOTION",
  "ACTION_NOT_ALLOWED",
  "APPROVAL_LEVEL_MISMATCH",
]);

const analysisKeys = [
  "summary",
  "assessment",
  "blocker",
  "recommendedAction",
  "uncertainty",
  "openQuestions",
  "observedVerificationGapIds",
] as const;

const unsafeReferenceErrors = new Set<AgentProposalValidationErrorCode>([
  "MISSING_REFERENCE",
  "CROSS_CASE_REFERENCE",
  "CROSS_CASE_EVIDENCE_REFERENCE",
  "UNKNOWN_VERIFICATION_GAP",
]);

export const AgentRunRecordSchema = z
  .object({
    id: RecordIdSchema,
    caseId: RecordIdSchema,
    basedOnCaseVersion: z.number().int().min(1),
    agentName: z.literal("resolvia_resolution_agent"),
    modelId: RecordIdSchema,
    modelVersion: boundedText(128).optional(),
    promptVersion: z.enum(["resolution-agent-v1", "resolution-agent-v2"]),
    schemaVersion: z.literal("agent-resolution-proposal-v1"),
    validatorVersion: z.literal("agent-proposal-validator-v1"),
    startedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema,
    inputDigest: DigestSchema,
    rawOutputDigest: DigestSchema.optional(),
    suppliedPartyIds: UniqueIdArraySchema,
    suppliedClaimIds: UniqueIdArraySchema,
    suppliedEvidenceIds: UniqueIdArraySchema,
    suppliedEventIds: UniqueIdArraySchema,
    suppliedVerificationGapIds: UniqueIdArraySchema,
    outcome: AgentRunOutcomeSchema,
    summary: AgentResolutionProposalSchema.shape.summary.optional(),
    assessment: CurrentAssessmentSchema.optional(),
    blocker: BlockerSchema.optional(),
    recommendedAction: NextBestActionSchema.optional(),
    uncertainty: z.array(UncertaintySchema).max(10).optional(),
    openQuestions: z.array(OpenQuestionSchema).max(10).optional(),
    observedVerificationGapIds: UniqueIdArraySchema.optional(),
    validationErrors: z
      .array(AgentProposalValidationErrorCodeSchema)
      .max(25)
      .superRefine((errors, context) => {
        if (new Set(errors).size !== errors.length) {
          context.addIssue({ code: "custom", message: "Errors must be unique" });
        }
      }),
  })
  .strict()
  .superRefine((run, context) => {
    const presentAnalysis = analysisKeys.filter((key) => run[key] !== undefined);
    const hasAnyAnalysis = presentAnalysis.length > 0;
    const hasCompleteAnalysis = presentAnalysis.length === analysisKeys.length;

    if (run.outcome === "SUCCEEDED_VALID") {
      if (!hasCompleteAnalysis || run.validationErrors.length !== 0) {
        context.addIssue({
          code: "custom",
          message: "A valid run requires complete analysis and no errors",
        });
      }
      return;
    }

    if (run.outcome === "REJECTED_VALIDATION") {
      if (run.validationErrors.length === 0) {
        context.addIssue({
          code: "custom",
          message: "A rejected run requires validation errors",
        });
      }

      const hasUnsafeReference = run.validationErrors.some((error) =>
        unsafeReferenceErrors.has(error),
      );
      if (hasUnsafeReference && (hasAnyAnalysis || !run.rawOutputDigest)) {
        context.addIssue({
          code: "custom",
          message:
            "Reference-unsafe rejection requires a digest and no analysis",
        });
      } else if (!hasUnsafeReference && hasAnyAnalysis && !hasCompleteAnalysis) {
        context.addIssue({
          code: "custom",
          message: "Retained rejected analysis must be complete",
        });
      }
      return;
    }

    if (hasAnyAnalysis || run.validationErrors.length !== 0) {
      context.addIssue({
        code: "custom",
        message: "Technical failures cannot retain analysis or validation errors",
      });
    }
  });

export const AgentRunMutationSchema = z
  .object({
    agentRun: AgentRunRecordSchema,
    expectedCaseVersion: z.number().int().min(1),
  })
  .strict();

export type ApprovalLevel = z.infer<typeof ApprovalLevelSchema>;
export type ActionType = z.infer<typeof ActionTypeSchema>;
export type BlockerCode = z.infer<typeof BlockerCodeSchema>;
export type UncertaintyCode = z.infer<typeof UncertaintyCodeSchema>;
export type AgentResolutionProposal = z.infer<
  typeof AgentResolutionProposalSchema
>;
export type AgentRunOutcome = z.infer<typeof AgentRunOutcomeSchema>;
export type AgentProposalValidationErrorCode = z.infer<
  typeof AgentProposalValidationErrorCodeSchema
>;
export type AgentRunRecord = z.infer<typeof AgentRunRecordSchema>;
export type AgentRunMutation = z.infer<typeof AgentRunMutationSchema>;
