import type { ResolutionSnapshot } from "@/src/domain/store/model";

const DAY_MS = 24 * 60 * 60 * 1_000;
const AGENT_RUN_RETENTION_MS = 30 * DAY_MS;
const TERMINAL_TOKEN_GRACE_MS = 7 * DAY_MS;
const TERMINAL_TOKEN_STATES = new Set(["PUBLISHED", "USED", "EXPIRED", "REVOKED"]);

export const RETENTION_POLICY = Object.freeze({
  operationalLogsDays: 14,
  agentRunsDays: 30,
  terminalPartnerTokenGraceDays: 7,
  rawModelOutput: "DIGEST_ONLY",
  authoritativeRecords: "LEGAL_PRODUCT_REVIEW_REQUIRED",
});

export type RetentionCandidate = {
  kind: "AGENT_RUN" | "PARTNER_TOKEN_RECEIPT";
  id: string;
};

export function planRetentionBatch(
  snapshot: ResolutionSnapshot,
  asOf: string,
  limit: number,
): RetentionCandidate[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("Retention batch limit must be between 1 and 500");
  }
  const now = Date.parse(asOf);
  if (!Number.isFinite(now)) throw new Error("Retention asOf must be an ISO date-time");

  const candidates: Array<RetentionCandidate & { expiredAt: number }> = [];
  for (const run of snapshot.agentRuns) {
    const expiredAt = Date.parse(run.completedAt) + AGENT_RUN_RETENTION_MS;
    if (expiredAt <= now) candidates.push({ kind: "AGENT_RUN", id: run.id, expiredAt });
  }
  for (const receipt of snapshot.partnerTokenReceipts ?? []) {
    if (!TERMINAL_TOKEN_STATES.has(receipt.state)) continue;
    const expiredAt = Date.parse(receipt.expiresAt) + TERMINAL_TOKEN_GRACE_MS;
    if (expiredAt <= now) {
      candidates.push({ kind: "PARTNER_TOKEN_RECEIPT", id: receipt.digest, expiredAt });
    }
  }

  return candidates
    .sort((left, right) => left.expiredAt - right.expiredAt || left.id.localeCompare(right.id))
    .slice(0, limit)
    .map(({ kind, id }) => ({ kind, id }));
}
