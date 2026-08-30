import { describe, expect, it } from "vitest";

import {
  evaluateHmacProvisionOrder,
  type HmacProvisionStep,
} from "@/src/infrastructure/google/release/m4-hmac-provision";

describe("m4-hmac-provision", () => {
  it("accepts accessor proof before secret version create", () => {
    const steps: HmacProvisionStep[] = [
      "VERIFY_ACCESSOR_BINDING",
      "CREATE_SECRET_VERSION",
    ];
    expect(evaluateHmacProvisionOrder(steps)).toEqual({ ok: true });
  });

  it("rejects creating a secret version before accessor proof", () => {
    expect(
      evaluateHmacProvisionOrder([
        "CREATE_SECRET_VERSION",
        "VERIFY_ACCESSOR_BINDING",
      ]),
    ).toEqual({ ok: false, reason: "ACCESSOR_PROOF_REQUIRED_BEFORE_VERSION" });
  });

  it("rejects missing accessor proof entirely", () => {
    expect(evaluateHmacProvisionOrder(["CREATE_SECRET_VERSION"])).toEqual({
      ok: false,
      reason: "ACCESSOR_PROOF_REQUIRED_BEFORE_VERSION",
    });
  });

  it("rejects duplicate or unknown ordering", () => {
    expect(
      evaluateHmacProvisionOrder([
        "VERIFY_ACCESSOR_BINDING",
        "VERIFY_ACCESSOR_BINDING",
        "CREATE_SECRET_VERSION",
      ]),
    ).toEqual({ ok: false, reason: "INVALID_HMAC_PROVISION_SEQUENCE" });
  });
});
