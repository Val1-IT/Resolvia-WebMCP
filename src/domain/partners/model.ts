import { z } from "zod";

const RecordIdSchema = z.string().trim().min(1).max(128);
const IsoDateTimeSchema = z.string().datetime({ offset: true });
const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

export const PartnerRequestedEvidenceTypeSchema = z.enum([
  "SETTLEMENT_OCCURRED",
  "CUSTOMER_RECEIPT",
]);

export const PartnerRequestStateSchema = z.enum(["OPEN"]);

export const PartnerRequestRecordSchema = z.object({
  id: RecordIdSchema,
  caseId: RecordIdSchema,
  requestedEvidenceType: PartnerRequestedEvidenceTypeSchema,
  targetPartner: z.literal("RESOLVIA DEMO PARTNER"),
  minimumContext: z.object({ caseDisplayId: RecordIdSchema }).strict(),
  createdAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema,
  state: PartnerRequestStateSchema,
}).strict();

export const PartnerTokenReceiptStateSchema = z.enum([
  "OPEN",
  "RESERVED",
  "PUBLISHED",
  "FAILED_RETRYABLE",
  "USED",
  "EXPIRED",
  "REVOKED",
]);

export const PartnerTokenReceiptSchema = z.object({
  digest: DigestSchema,
  requestId: RecordIdSchema,
  caseId: RecordIdSchema,
  expiresAt: IsoDateTimeSchema,
  state: PartnerTokenReceiptStateSchema,
  leaseUntil: IsoDateTimeSchema.optional(),
  submissionEventId: RecordIdSchema.optional(),
  publishedAt: IsoDateTimeSchema.optional(),
}).strict();

export const PartnerSubmissionReservationSchema = z.object({
  requestId: RecordIdSchema,
  tokenDigest: DigestSchema,
  submissionEventId: RecordIdSchema,
  expectedCaseVersion: z.number().int().min(1),
  now: IsoDateTimeSchema,
}).strict();

export const PartnerSubmissionReleaseSchema = z.object({
  requestId: RecordIdSchema,
  tokenDigest: DigestSchema,
  submissionEventId: RecordIdSchema,
  now: IsoDateTimeSchema,
}).strict();
export const PartnerSubmissionPublicationSchema = z.object({
  requestId: RecordIdSchema,
  tokenDigest: DigestSchema,
  submissionEventId: RecordIdSchema,
  now: IsoDateTimeSchema,
}).strict();
export const PartnerRequestMutationSchema = z.object({
  request: PartnerRequestRecordSchema,
  tokenReceipt: PartnerTokenReceiptSchema,
  expectedCaseVersion: z.number().int().min(1),
}).strict();

export type PartnerSubmissionReservation = z.infer<typeof PartnerSubmissionReservationSchema>;
export type PartnerSubmissionRelease = z.infer<typeof PartnerSubmissionReleaseSchema>;
export type PartnerSubmissionPublication = z.infer<typeof PartnerSubmissionPublicationSchema>;
export type PartnerRequestRecord = z.infer<typeof PartnerRequestRecordSchema>;
export type PartnerTokenReceipt = z.infer<typeof PartnerTokenReceiptSchema>;
export type PartnerRequestMutation = z.infer<typeof PartnerRequestMutationSchema>;
export type PartnerRequestAccess = {
  request: PartnerRequestRecord;
  tokenReceipt: PartnerTokenReceipt;
};