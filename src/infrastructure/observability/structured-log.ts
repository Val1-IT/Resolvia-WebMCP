import { z } from "zod";

const OperationalTokenSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);

const StructuredLogSchema = z
  .object({
    severity: z.enum(["DEBUG", "INFO", "NOTICE", "WARNING", "ERROR", "CRITICAL"]),
    component: OperationalTokenSchema,
    requestId: OperationalTokenSchema.optional(),
    eventId: OperationalTokenSchema.optional(),
    caseId: OperationalTokenSchema.optional(),
    agentRunId: OperationalTokenSchema.optional(),
    outcome: OperationalTokenSchema.optional(),
    errorClass: OperationalTokenSchema.optional(),
    revision: OperationalTokenSchema.optional(),
  })
  .strict();

export type StructuredLog = z.infer<typeof StructuredLogSchema>;

export function formatStructuredLog(input: unknown): string {
  return JSON.stringify(StructuredLogSchema.parse(input));
}