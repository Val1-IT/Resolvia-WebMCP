import { describe, expect, it } from "vitest";

import { formatStructuredLog } from "@/src/infrastructure/observability/structured-log";

describe("formatStructuredLog", () => {
  it("emits only bounded operational identifiers and outcome fields", () => {
    const serialized = formatStructuredLog({
      severity: "WARNING",
      component: "resolution-events-route",
      requestId: "pubsub-message-123",
      eventId: "event-provider-123",
      caseId: "case-rv-1028",
      agentRunId: "agent-run-123",
      outcome: "ACK_PERMANENT_REJECTION",
      errorClass: "CASE_INTEGRITY_ERROR",
    });

    expect(JSON.parse(serialized)).toEqual({
      severity: "WARNING",
      component: "resolution-events-route",
      requestId: "pubsub-message-123",
      eventId: "event-provider-123",
      caseId: "case-rv-1028",
      agentRunId: "agent-run-123",
      outcome: "ACK_PERMANENT_REJECTION",
      errorClass: "CASE_INTEGRITY_ERROR",
    });
  });

  it.each(["narrative", "rawBody", "exceptionMessage", "credential"])(
    "rejects non-allowlisted sensitive field %s",
    (field) => {
      expect(() =>
        formatStructuredLog({
          severity: "ERROR",
          component: "security-test",
          errorClass: "SAFE_ERROR",
          [field]: "GEMINI_API_KEY=super-secret customer@example.com",
        }),
      ).toThrow();
    },
  );

  it("rejects control characters and secret-like identifier values", () => {
    expect(() =>
      formatStructuredLog({
        severity: "ERROR",
        component: "security-test\nforged-log-line",
        requestId: "STRIPE_SECRET_KEY=sk_test_secret",
      }),
    ).toThrow();
  });
});