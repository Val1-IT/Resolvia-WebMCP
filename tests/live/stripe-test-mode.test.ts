import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import { evaluateClaimStatus } from "@/src/domain/claims/model";
import { JsonResolutionStore } from "@/src/infrastructure/local/json-resolution-store";
import { buildCaseWorkspaceViewModel } from "@/src/ui/case-workspace/model";

const stripeKey = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
const liveEnabled =
  process.env.RUN_LIVE_STRIPE_SMOKE === "1" &&
  process.env.STRIPE_CLI_FORWARDING_ACTIVE === "1" &&
  stripeKey.startsWith("sk_test_") &&
  webhookSecret.startsWith("whsec_");

describe.skipIf(!liveEnabled)("Stripe Test Mode live gate", () => {
  it("observes one real signed provider event without creating a refund", async () => {
    const store = new JsonResolutionStore(
      path.join(process.cwd(), ".data", "resolvia.json"),
    );
    const before = await store.loadCaseBundle("case-rv-1028");
    if (!before) throw new Error("Seed RV-1028 before starting the live gate.");

    expect(before.caseRecord).toMatchObject({
      state: "INVESTIGATING",
      version: 4,
    });
    const merchantClaim = before.claims.find(
      (claim) => claim.id === "claim-refund-processed",
    );
    expect(merchantClaim && evaluateClaimStatus(merchantClaim)).toBe(
      "UNVERIFIED",
    );
    expect(before.evidence).toContainEqual(
      expect.objectContaining({
        verificationLevel: "AUTHENTICATED_SOURCE",
      }),
    );
    expect(
      before.agentRuns.some((run) => run.basedOnCaseVersion === 4),
    ).toBe(true);

    const after = await waitForCaseVersion(store, 5, 60_000);
    expect(after.caseRecord).toMatchObject({
      state: "INVESTIGATING",
      version: 5,
    });
    expect(after.evidence).toContainEqual(
      expect.objectContaining({
        sourceProvider: "stripe",
        verificationLevel: "PROVIDER_VERIFIED",
      }),
    );
    expect(after.providerTransactions).toHaveLength(1);
    const afterMerchantClaim = after.claims.find(
      (claim) => claim.id === "claim-refund-processed",
    );
    expect(afterMerchantClaim && evaluateClaimStatus(afterMerchantClaim)).toBe(
      "UNVERIFIED",
    );
    expect(buildCaseWorkspaceViewModel(after).agentAnalysis).toMatchObject({
      basedOnCaseVersion: 4,
      freshness: "STALE",
    });
  }, 65_000);
});

async function waitForCaseVersion(
  store: JsonResolutionStore,
  version: number,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const bundle = await store.loadCaseBundle("case-rv-1028");
    if (bundle && bundle.caseRecord.version === version) return bundle;
    await delay(1_000);
  }
  throw new Error(`Timed out waiting for RV-1028 v${version}.`);
}
