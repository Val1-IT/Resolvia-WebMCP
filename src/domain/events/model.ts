import { z } from "zod";

const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const EventSourceCategorySchema = z.enum([
  "USER",
  "PROVIDER",
  "PARTNER",
  "SYSTEM",
  "AGENT",
]);

export const RuntimeModeSchema = z.enum([
  "LOCAL",
  "TEST",
  "EMULATOR",
  "CONNECTED",
]);

export const ResolutionEventKindSchema = z.enum([
  "CASE_INTAKE_STARTED",
  "INITIAL_EVIDENCE_RECORDED",
  "PROVIDER_REFUND_OBSERVED",
  "PROVIDER_REFUND_STATUS_UPDATED",
  "PARTNER_EVIDENCE_SUBMITTED",
  "EXTERNAL_EVIDENCE_REQUESTED",
  "USER_ACTION_REQUIRED",
  "ESCALATION_NEEDED",
  "RESOLUTION_PROVISIONAL",
  "RELEVANT_EVIDENCE_RECEIVED",
  "REQUIRED_ACTION_COMPLETED",
  "ESCALATION_COMPLETED",
  "RESOLUTION_EVIDENCE_SATISFIED",
  "RESOLUTION_EVIDENCE_INVALIDATED",
  "CASE_REOPENED",
  "CASE_CLOSED",
]);

export const EventSourceSchema = z.object({
  category: EventSourceCategorySchema,
  runtimeMode: RuntimeModeSchema,
  provider: z.string().min(1).optional(),
  actorId: z.string().min(1).optional(),
});

export const ResolutionEventSchema = z.object({
  id: z.string().min(1),
  caseId: z.string().min(1),
  kind: ResolutionEventKindSchema,
  source: EventSourceSchema,
  occurredAt: IsoDateTimeSchema,
  receivedAt: IsoDateTimeSchema,
  correlationId: z.string().min(1),
  causationId: z.string().min(1).optional(),
  payload: z.record(z.string(), z.unknown()),
});

export type EventSourceCategory = z.infer<typeof EventSourceCategorySchema>;
export type RuntimeMode = z.infer<typeof RuntimeModeSchema>;
export type ResolutionEventKind = z.infer<typeof ResolutionEventKindSchema>;
export type EventSource = z.infer<typeof EventSourceSchema>;
export type ResolutionEvent = z.infer<typeof ResolutionEventSchema>;
