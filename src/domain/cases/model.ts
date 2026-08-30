import { z } from "zod";

const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const CaseStateSchema = z.enum([
  "NEW",
  "EVIDENCE_COLLECTION",
  "INVESTIGATING",
  "WAITING_EXTERNAL",
  "ACTION_REQUIRED",
  "ESCALATION_REQUIRED",
  "RESOLUTION_PENDING",
  "RESOLVED",
  "CLOSED",
]);

export const PartyKindSchema = z.enum([
  "CUSTOMER",
  "MERCHANT",
  "PROVIDER",
  "PARTNER",
]);

export const PartyRecordSchema = z.object({
  id: z.string().min(1),
  caseId: z.string().min(1),
  kind: PartyKindSchema,
  name: z.string().min(1),
});

export const ResolutionCaseSchema = z.object({
  id: z.string().min(1),
  displayId: z.string().min(1),
  ownerUserId: z.string().min(1).max(128),
  issueType: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  state: CaseStateSchema,
  version: z.number().int().min(1),
  parties: z.array(PartyRecordSchema),
  currentBlocker: z.string().min(1),
  nextBestAction: z.string().min(1),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  resolvedAt: IsoDateTimeSchema.optional(),
  closedAt: IsoDateTimeSchema.optional(),
});

export type CaseState = z.infer<typeof CaseStateSchema>;
export type PartyKind = z.infer<typeof PartyKindSchema>;
export type PartyRecord = z.infer<typeof PartyRecordSchema>;
export type ResolutionCase = z.infer<typeof ResolutionCaseSchema>;
