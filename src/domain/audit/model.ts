import { z } from "zod";

import { CaseStateSchema } from "@/src/domain/cases/model";
import { EventSourceCategorySchema } from "@/src/domain/events/model";

const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const AuditActorSchema = z.object({
  category: EventSourceCategorySchema,
  id: z.string().min(1),
});

export const AuditRecordSchema = z.object({
  id: z.string().min(1),
  caseId: z.string().min(1),
  timestamp: IsoDateTimeSchema,
  triggeringEventId: z.string().min(1),
  ruleId: z.string().min(1),
  actor: AuditActorSchema,
  previousState: CaseStateSchema,
  resultingState: CaseStateSchema,
  reason: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)),
  changedFields: z.array(z.string().min(1)).min(1),
});

export type AuditActor = z.infer<typeof AuditActorSchema>;
export type AuditRecord = z.infer<typeof AuditRecordSchema>;
