import { z } from "zod";

import { ProviderIdSchema } from "@/src/domain/providers/model";

const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const ProviderTransactionRecordSchema = z
  .object({
    id: z.string().min(1),
    caseId: z.string().min(1),
    provider: ProviderIdSchema,
    providerObjectId: z.string().min(1),
    kind: z.literal("REFUND"),
    status: z.enum(["PENDING", "SUCCEEDED", "FAILED", "CANCELED"]),
    evidenceId: z.string().min(1),
    observedAt: IsoDateTimeSchema,
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export type ProviderTransactionRecord = z.infer<
  typeof ProviderTransactionRecordSchema
>;
