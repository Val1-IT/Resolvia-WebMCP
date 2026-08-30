import { describe, expect, it, vi } from "vitest";

import { EnginePartnerGateway } from "@/src/infrastructure/google/engine-partner-gateway";

const token = "partner-token-abcdefghijklmnopqrstuvwxyz0123456789";

describe("EnginePartnerGateway", () => {
  it("uses a service identity token to call only the private engine partner endpoint", async () => {
    const request = vi.fn(async () => ({
      data: {
        requestId: "partner-request-engine",
        caseDisplayId: "RV-1028",
        requestedEvidenceType: "CUSTOMER_RECEIPT" as const,
        expiresAt: "2026-08-12T13:40:00.000Z",
      },
    }));
    const gateway = new EnginePartnerGateway(
      "https://engine.resolvia.test",
      async () => ({ request }),
    );

    await expect(gateway.access("partner-request-engine", token)).resolves.toMatchObject({
      requestId: "partner-request-engine",
      caseDisplayId: "RV-1028",
    });
    expect(request).toHaveBeenCalledWith({
      url: "https://engine.resolvia.test/api/internal/partner",
      method: "POST",
      data: { operation: "access", requestId: "partner-request-engine", token },
    });
  });

  it("fails closed when the private engine cannot be reached", async () => {
    const gateway = new EnginePartnerGateway(
      "https://engine.resolvia.test",
      async () => { throw new Error("unreachable"); },
    );

    await expect(gateway.access("partner-request-engine", token)).resolves.toBeNull();
  });
});