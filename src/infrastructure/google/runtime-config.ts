import { z } from "zod";

import { RuntimeModeSchema, type RuntimeMode } from "@/src/domain/events/model";

const ServiceAccountEmailSchema = z.string().email().endsWith(".iam.gserviceaccount.com");

const ConnectedEnvironmentSchema = z.object({
  GOOGLE_CLOUD_PROJECT: z.string().trim().min(1), RESOLVIA_GCP_REGION: z.string().trim().min(1),
  RESOLVIA_PUBSUB_TOPIC: z.string().trim().min(1), RESOLVIA_PUBSUB_SUBSCRIPTION: z.string().trim().min(1),
  RESOLVIA_WEB_URL: z.string().url(), RESOLVIA_ENGINE_AUDIENCE: z.string().url(),
  RESOLVIA_FIRESTORE_DATABASE: z.string().trim().min(1),
  RESOLVIA_PUBSUB_PUSH_SERVICE_ACCOUNT: ServiceAccountEmailSchema,
  RESOLVIA_PROVIDER_PUSH_SERVICE_ACCOUNT: ServiceAccountEmailSchema.optional(),
  RESOLVIA_PARTNER_PUSH_SERVICE_ACCOUNT: ServiceAccountEmailSchema.optional(),
}).strict().superRefine((value, context) => {
  const hasProvider = Boolean(value.RESOLVIA_PROVIDER_PUSH_SERVICE_ACCOUNT);
  const hasPartner = Boolean(value.RESOLVIA_PARTNER_PUSH_SERVICE_ACCOUNT);
  if (hasProvider !== hasPartner) {
    context.addIssue({
      code: "custom",
      message: "Provider and partner push service accounts must be configured together.",
      path: hasProvider
        ? ["RESOLVIA_PARTNER_PUSH_SERVICE_ACCOUNT"]
        : ["RESOLVIA_PROVIDER_PUSH_SERVICE_ACCOUNT"],
    });
  }
});

export type RuntimeConfig = {
  mode: RuntimeMode; projectId?: string; region?: string; topicName?: string; subscriptionName?: string;
  webUrl?: string; engineAudience?: string; firestoreDatabase?: string; pubsubPushServiceAccount?: string;
  providerPushServiceAccount?: string; partnerPushServiceAccount?: string;
};
export class RuntimeConfigurationError extends Error {
  readonly code = "RUNTIME_CONFIGURATION_ERROR";
  constructor() { super("Runtime mode must be explicitly configured."); this.name = "RuntimeConfigurationError"; }
}
export class ConnectedConfigurationError extends Error {
  readonly code = "CONNECTED_CONFIGURATION_ERROR";
  constructor() { super("CONNECTED runtime configuration is incomplete or invalid."); this.name = "ConnectedConfigurationError"; }
}
export function getRuntimeConfig(env: Record<string, string | undefined>): RuntimeConfig {
  if (!env.RESOLVIA_RUNTIME_MODE) throw new RuntimeConfigurationError();
  const mode = RuntimeModeSchema.parse(env.RESOLVIA_RUNTIME_MODE);
  if (mode !== "CONNECTED") return { mode };
  const parsed = ConnectedEnvironmentSchema.safeParse({
    GOOGLE_CLOUD_PROJECT: env.GOOGLE_CLOUD_PROJECT, RESOLVIA_GCP_REGION: env.RESOLVIA_GCP_REGION,
    RESOLVIA_PUBSUB_TOPIC: env.RESOLVIA_PUBSUB_TOPIC, RESOLVIA_PUBSUB_SUBSCRIPTION: env.RESOLVIA_PUBSUB_SUBSCRIPTION,
    RESOLVIA_WEB_URL: env.RESOLVIA_WEB_URL, RESOLVIA_ENGINE_AUDIENCE: env.RESOLVIA_ENGINE_AUDIENCE,
    RESOLVIA_FIRESTORE_DATABASE: env.RESOLVIA_FIRESTORE_DATABASE,
    RESOLVIA_PUBSUB_PUSH_SERVICE_ACCOUNT: env.RESOLVIA_PUBSUB_PUSH_SERVICE_ACCOUNT,
    ...(env.RESOLVIA_PROVIDER_PUSH_SERVICE_ACCOUNT
      ? { RESOLVIA_PROVIDER_PUSH_SERVICE_ACCOUNT: env.RESOLVIA_PROVIDER_PUSH_SERVICE_ACCOUNT }
      : {}),
    ...(env.RESOLVIA_PARTNER_PUSH_SERVICE_ACCOUNT
      ? { RESOLVIA_PARTNER_PUSH_SERVICE_ACCOUNT: env.RESOLVIA_PARTNER_PUSH_SERVICE_ACCOUNT }
      : {}),
  });
  if (!parsed.success) throw new ConnectedConfigurationError();
  return {
    mode,
    projectId: parsed.data.GOOGLE_CLOUD_PROJECT,
    region: parsed.data.RESOLVIA_GCP_REGION,
    topicName: parsed.data.RESOLVIA_PUBSUB_TOPIC,
    subscriptionName: parsed.data.RESOLVIA_PUBSUB_SUBSCRIPTION,
    webUrl: parsed.data.RESOLVIA_WEB_URL,
    engineAudience: parsed.data.RESOLVIA_ENGINE_AUDIENCE,
    firestoreDatabase: parsed.data.RESOLVIA_FIRESTORE_DATABASE,
    pubsubPushServiceAccount: parsed.data.RESOLVIA_PUBSUB_PUSH_SERVICE_ACCOUNT,
    ...(parsed.data.RESOLVIA_PROVIDER_PUSH_SERVICE_ACCOUNT
      ? { providerPushServiceAccount: parsed.data.RESOLVIA_PROVIDER_PUSH_SERVICE_ACCOUNT }
      : {}),
    ...(parsed.data.RESOLVIA_PARTNER_PUSH_SERVICE_ACCOUNT
      ? { partnerPushServiceAccount: parsed.data.RESOLVIA_PARTNER_PUSH_SERVICE_ACCOUNT }
      : {}),
  };
}
