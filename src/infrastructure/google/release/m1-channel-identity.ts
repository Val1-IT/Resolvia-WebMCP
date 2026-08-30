export type PushChannel = "PROVIDER" | "PARTNER";

export type M1ChannelIdentityConfig = {
  providerPushSa: string;
  partnerPushSa: string;
  legacyPushSa?: string;
};

/**
 * Channel provenance is selected only from the verified push principal.
 * Request body / envelope category hints must never override the mapping.
 */
export function resolveChannelFromVerifiedPrincipal(
  verifiedEmail: string,
  config: M1ChannelIdentityConfig,
  bodyHint?: unknown,
): PushChannel | null {
  void bodyHint; // request body must never select channel/provenance
  if (verifiedEmail === config.providerPushSa) return "PROVIDER";
  if (verifiedEmail === config.partnerPushSa) return "PARTNER";
  return null;
}

export function assertEventCategoryMatchesChannel(
  category: string,
  channel: PushChannel,
): boolean {
  return category === channel;
}

export function buildAllowedPushServiceAccounts(
  config: M1ChannelIdentityConfig,
): string[] {
  const accounts = [config.providerPushSa, config.partnerPushSa];
  if (config.legacyPushSa && !accounts.includes(config.legacyPushSa)) {
    accounts.push(config.legacyPushSa);
  }
  return accounts;
}
