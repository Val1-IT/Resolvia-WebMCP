import { describe, expect, it } from "vitest";

import { ProviderTransactionRecordSchema } from "@/src/domain/transactions/model";
import { FIXED_NOW } from "@/tests/fixtures/domain";

const validTransaction = () => ({
  id: "transaction-stripe-refund-re-test",
  caseId: "case-rv-1028",
  provider: "stripe" as const,
  providerObjectId: "re_test_refund",
  kind: "REFUND" as const,
  status: "PENDING" as const,
  evidenceId: "evidence-stripe-refund-re-test",
  observedAt: FIXED_NOW,
  createdAt: FIXED_NOW,
});

describe("ProviderTransactionRecordSchema", () => {
  it("accepts a bounded authoritative Stripe refund record", () => {
    expect(ProviderTransactionRecordSchema.parse(validTransaction())).toEqual(
      validTransaction(),
    );
  });

  it.each([
    ["missing provider object ID", { providerObjectId: "" }],
    ["unsupported provider", { provider: "merchant" }],
    ["unsupported kind", { kind: "CHARGE" }],
    ["unsupported status", { status: "UNKNOWN" }],
  ])("rejects %s", (_label, override) => {
    expect(() =>
      ProviderTransactionRecordSchema.parse({
        ...validTransaction(),
        ...override,
      }),
    ).toThrow();
  });

  it("rejects unknown authoritative fields", () => {
    expect(() =>
      ProviderTransactionRecordSchema.parse({
        ...validTransaction(),
        rawProviderPayload: { unsafe: true },
      }),
    ).toThrow();
  });
});
