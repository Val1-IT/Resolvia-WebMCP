import { z } from "zod";

const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const VerificationLevelSchema = z.enum([
  "USER_REPORTED",
  "DOCUMENT_EXTRACTED",
  "AUTHENTICATED_SOURCE",
  "PROVIDER_VERIFIED",
  "DEMO_PROVIDER_VERIFIED",
  "PARTNER_VERIFIED",
]);

export const EvidenceTypeSchema = z.enum([
  "COMMUNICATION",
  "DOCUMENT",
  "PROVIDER_TRANSACTION",
  "PARTNER_RESPONSE",
]);

export const EvidenceRecordSchema = z.object({
  id: z.string().min(1),
  caseId: z.string().min(1),
  type: EvidenceTypeSchema,
  source: z.string().min(1),
  sourceProvider: z.string().min(1).optional(),
  externalReference: z.string().min(1).optional(),
  contentSummary: z.string().min(1),
  verificationLevel: VerificationLevelSchema,
  retrievedAt: IsoDateTimeSchema,
  createdAt: IsoDateTimeSchema,
  metadata: z.record(z.string(), z.unknown()),
  relatedClaimIds: z.array(z.string().min(1)),
});

export type VerificationLevel = z.infer<typeof VerificationLevelSchema>;
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;
