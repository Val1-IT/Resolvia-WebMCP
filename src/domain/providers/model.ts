import { z } from "zod";

export const ProviderIdSchema = z.enum([
  "stripe",
  "resolvia_demo_provider",
]);

export type ProviderId = z.infer<typeof ProviderIdSchema>;
