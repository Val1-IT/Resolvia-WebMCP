import { describe, expect, it } from "vitest";

import { planProviderRefundMutation } from "@/src/domain/events/provider-refund-policy";
import type { ResolutionEvent } from "@/src/domain/events/model";
import {
  FIXED_NOW,
  initialRefundBundle,
  makeEvent,
} from "@/tests/fixtures/domain";

const COMMITTED_AT = "2026-08-11T12:01:00.000Z";

function providerEvent(
  overrides: Partial<ResolutionEvent> = {},
): ResolutionEvent {
  return makeEvent({
    id: "stripe:evt_test_refund",
    kind: "PROVIDER_REFUND_STATUS_UPDATED",
    source: {
      category: "PROVIDER",
      runtimeMode: "TEST",
      provider: "stripe",
    },
    occurredAt: FIXED_NOW,
    receivedAt: FIXED_NOW,
    correlationId: "evt_test_refund",
    payload: {
      providerEventId: "evt_test_refund",
      providerEventType: "refund.updated",
      providerObjectId: "re_test_refund",
      providerObjectType: "refund",
      providerObjectCreatedAt: FIXED_NOW,
      providerStatus: "pending",
    },
    ...overrides,
  });
}

describe("planProviderRefundMutation", () => {
  it("plans one audited v4-to-v5 mutation without forcing a state transition", () => {
    const result = planProviderRefundMutation(
      initialRefundBundle(),
      providerEvent(),
      () => COMMITTED_AT,
    );

    expect(result).toMatchObject({
      ok: true,
      mutation: {
        expectedCaseVersion: 4,
        caseRecord: {
          state: "INVESTIGATING",
          version: 5,
          updatedAt: COMMITTED_AT,
        },
      },
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.mutation.eventsToAppend).toHaveLength(1);
    expect(result.mutation.evidenceToAdd).toHaveLength(1);
    expect(result.mutation.transactionsToAdd).toHaveLength(1);
    expect(result.mutation.claimsToSave).toHaveLength(2);
    expect(result.mutation.auditRecordsToAppend).toHaveLength(1);
    expect(result.mutation.auditRecordsToAppend[0]).toMatchObject({
      previousState: "INVESTIGATING",
      resultingState: "INVESTIGATING",
      triggeringEventId: "stripe:evt_test_refund",
      evidenceIds: ["evidence:stripe:evt_test_refund"],
    });
  });

  it("creates separate supported existence and processor-status propositions", () => {
    const result = planProviderRefundMutation(
      initialRefundBundle(),
      providerEvent(),
      () => COMMITTED_AT,
    );
    if (!result.ok) throw new Error(result.error);

    expect(result.mutation.claimsToSave).toEqual([
      expect.objectContaining({
        statement: "Stripe refund transaction re_test_refund exists.",
        status: "SUPPORTED",
        evidenceRelationships: [
          {
            evidenceId: "evidence:stripe:evt_test_refund",
            kind: "SUPPORTS_PROPOSITION",
          },
        ],
      }),
      expect.objectContaining({
        statement: "Stripe reports refund re_test_refund status as pending.",
        status: "SUPPORTED",
      }),
    ]);
    expect(
      result.mutation.claimsToSave.some((claim) =>
        claim.statement.toLowerCase().includes("customer received"),
      ),
    ).toBe(false);
  });

  it.each([
    ["pending", "PENDING"],
    ["requires_action", "PENDING"],
    ["succeeded", "SUCCEEDED"],
    ["failed", "FAILED"],
    ["canceled", "CANCELED"],
  ] as const)("maps provider status %s to transaction status %s", (providerStatus, expected) => {
    const event = providerEvent({
      payload: {
        ...providerEvent().payload,
        providerStatus,
      },
    });
    const result = planProviderRefundMutation(
      initialRefundBundle(),
      event,
      () => COMMITTED_AT,
    );
    if (!result.ok) throw new Error(result.error);

    expect(result.mutation.transactionsToAdd[0]?.status).toBe(expected);
  });

  it.each([
    ["wrong case", providerEvent({ caseId: "case-other" })],
    [
      "missing refund ID",
      providerEvent({
        payload: {
          ...providerEvent().payload,
          providerObjectId: "",
        },
      }),
    ],
    [
      "untrusted source",
      providerEvent({ source: { category: "USER", runtimeMode: "LOCAL" } }),
    ],
    [
      "inconsistent event ID",
      providerEvent({ id: "stripe:evt_other" }),
    ],
  ])("fails closed for %s", (_label, event) => {
    expect(
      planProviderRefundMutation(
        initialRefundBundle(),
        event,
        () => COMMITTED_AT,
      ),
    ).toEqual({ ok: false, error: "INVALID_PROVIDER_EVENT" });
  });
});
