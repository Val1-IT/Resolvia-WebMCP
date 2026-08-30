import { describe, expect, it } from "vitest";

import { applyCaseMutation } from "@/src/domain/store/apply-mutation";
import type { CaseMutation, ResolutionSnapshot } from "@/src/domain/store/model";
import {
  crossCaseClaimMutation,
  createCaseMutation,
  emptySnapshot,
  makeAudit,
  makeCase,
  makeClaim,
  makeEvidence,
  makeEvent,
  makeMutation,
  makeProviderTransaction,
  snapshotWithCase,
  snapshotWithTwoCases,
} from "@/tests/fixtures/domain";

function validMixedMutation(): CaseMutation {
  return makeMutation({
    caseRecord: makeCase({ state: "EVIDENCE_COLLECTION", version: 2 }),
    eventsToAppend: [
      makeEvent({
        id: "event-initial-evidence",
        kind: "INITIAL_EVIDENCE_RECORDED",
      }),
    ],
    evidenceToAdd: [makeEvidence()],
    claimsToSave: [makeClaim()],
    auditRecordsToAppend: [
      makeAudit({
        triggeringEventId: "event-initial-evidence",
        resultingState: "EVIDENCE_COLLECTION",
        evidenceIds: ["evidence-merchant-message"],
      }),
    ],
  });
}

function committedClaimSnapshot(): ResolutionSnapshot {
  const result = applyCaseMutation(snapshotWithCase(1), validMixedMutation());
  if (result.result !== "COMMITTED") {
    throw new Error(`Fixture mutation failed: ${result.result}`);
  }
  return result.snapshot;
}

function expectUnchanged(
  original: ResolutionSnapshot,
  mutation: CaseMutation,
  expected: "DUPLICATE_EVENT" | "VERSION_CONFLICT" | "CASE_INTEGRITY_ERROR",
) {
  const result = applyCaseMutation(original, mutation);
  expect(result.result).toBe(expected);
  expect(result.snapshot).toBe(original);
  expect(result.snapshot).toEqual(original);
}

describe("applyCaseMutation", () => {
  it("creates an initial case only at version one", () => {
    const result = applyCaseMutation(emptySnapshot(), createCaseMutation());

    expect(result.result).toBe("COMMITTED");
    expect(result.snapshot.cases[0]?.version).toBe(1);
  });

  it.each([
    [createCaseMutation(), makeCase({ version: 2 })],
    [createCaseMutation(), makeCase({ version: 7 })],
  ])("rejects an arbitrary initial version", (base, caseRecord) => {
    const original = emptySnapshot();
    expectUnchanged(
      original,
      { ...base, caseRecord },
      "VERSION_CONFLICT",
    );
  });

  it("commits an existing case at exactly stored version plus one", () => {
    const result = applyCaseMutation(snapshotWithCase(3),
      makeMutation({
        expectedCaseVersion: 3,
        caseRecord: makeCase({ version: 4 }),
      }),
    );

    expect(result.result).toBe("COMMITTED");
    expect(result.snapshot.cases[0]?.version).toBe(4);
  });

  it.each([
    [2, 4],
    [3, 8],
  ])(
    "rejects expected version %s with proposed version %s",
    (expectedCaseVersion, nextVersion) => {
      const original = snapshotWithCase(3);
      expectUnchanged(
        original,
        makeMutation({
          expectedCaseVersion,
          caseRecord: makeCase({ version: nextVersion }),
        }),
        "VERSION_CONFLICT",
      );
    },
  );

  it("commits case, event, evidence, claim, and audit together", () => {
    const result = applyCaseMutation(snapshotWithCase(1), validMixedMutation());

    expect(result.result).toBe("COMMITTED");
    expect(result.snapshot).toMatchObject({
      cases: [expect.objectContaining({ version: 2 })],
      events: [expect.objectContaining({ id: "event-initial-evidence" })],
      evidence: [expect.objectContaining({ id: "evidence-merchant-message" })],
      claims: [expect.objectContaining({ id: "claim-refund-processed" })],
      auditRecords: [expect.objectContaining({ id: "audit-transition-1" })],
    });
  });

  it("commits a transaction when provider-verified evidence is added atomically", () => {
    const providerEvidence = makeEvidence({
      id: "evidence-stripe-refund-re-test",
      type: "PROVIDER_TRANSACTION",
      source: "Stripe signed Test Mode event",
      sourceProvider: "stripe",
      externalReference: "re_test_refund",
      verificationLevel: "PROVIDER_VERIFIED",
      relatedClaimIds: [],
    });
    const result = applyCaseMutation(
      snapshotWithCase(1),
      makeMutation({
        evidenceToAdd: [providerEvidence],
        transactionsToAdd: [makeProviderTransaction()],
      }),
    );

    expect(result.result).toBe("COMMITTED");
    expect(result.snapshot.providerTransactions).toEqual([
      makeProviderTransaction(),
    ]);
  });

  it("commits a Demo Provider transaction only with matching demo-verified evidence", () => {
    const demoEvidence = makeEvidence({
      id: "evidence-demo-refund-demo-test",
      type: "PROVIDER_TRANSACTION",
      source: "Resolvia Demo Provider signed event",
      sourceProvider: "resolvia_demo_provider",
      externalReference: "demo_refund_test",
      verificationLevel: "DEMO_PROVIDER_VERIFIED",
      relatedClaimIds: [],
    });
    const demoTransaction = makeProviderTransaction({
      id: "transaction-demo-refund-demo-test",
      provider: "resolvia_demo_provider",
      providerObjectId: "demo_refund_test",
      evidenceId: demoEvidence.id,
    });

    const result = applyCaseMutation(
      snapshotWithCase(1),
      makeMutation({
        evidenceToAdd: [demoEvidence],
        transactionsToAdd: [demoTransaction],
      }),
    );

    expect(result.result).toBe("COMMITTED");
    expect(result.snapshot.providerTransactions).toEqual([demoTransaction]);
  });

  it("rejects more than 100 authoritative writes in one mutation", () => {
    const original = snapshotWithCase(1);
    const evidenceToAdd = Array.from({ length: 100 }, (_, index) =>
      makeEvidence({
        id: `evidence-bounded-${index}`,
        relatedClaimIds: [],
      }),
    );

    expectUnchanged(
      original,
      makeMutation({ evidenceToAdd }),
      "CASE_INTEGRITY_ERROR",
    );
  });

  it.each([
    ["missing", "evidence-missing"],
    ["cross-case", "evidence-other"],
  ])(
    "rejects a transaction whose evidence is %s",
    (_label, evidenceId) => {
      const original = snapshotWithTwoCases();
      expectUnchanged(
        original,
        makeMutation({
          transactionsToAdd: [makeProviderTransaction({ evidenceId })],
        }),
        "CASE_INTEGRITY_ERROR",
      );
    },
  );

  it("rejects a transaction whose evidence is not provider verified", () => {
    const original: ResolutionSnapshot = {
      ...snapshotWithCase(1),
      evidence: [
        makeEvidence({
          id: "evidence-stripe-refund-re-test",
          relatedClaimIds: [],
        }),
      ],
    };
    expectUnchanged(
      original,
      makeMutation({ transactionsToAdd: [makeProviderTransaction()] }),
      "CASE_INTEGRITY_ERROR",
    );
  });

  it("rejects a duplicate transaction ID", () => {
    const existing = makeProviderTransaction();
    const original: ResolutionSnapshot = {
      ...snapshotWithCase(1),
      providerTransactions: [existing],
    };
    expectUnchanged(
      original,
      makeMutation({
        transactionsToAdd: [
          makeProviderTransaction({ providerObjectId: "re_other" }),
        ],
      }),
      "CASE_INTEGRITY_ERROR",
    );
  });

  it("rejects a duplicate provider object ID in the same provider and case", () => {
    const existing = makeProviderTransaction();
    const original: ResolutionSnapshot = {
      ...snapshotWithCase(1),
      providerTransactions: [existing],
    };
    expectUnchanged(
      original,
      makeMutation({
        transactionsToAdd: [
          makeProviderTransaction({ id: "transaction-stripe-refund-second" }),
        ],
      }),
      "CASE_INTEGRITY_ERROR",
    );
  });

  it("rejects a state change without an audit", () => {
    const original = snapshotWithCase(1);
    expectUnchanged(
      original,
      makeMutation({
        caseRecord: makeCase({ state: "EVIDENCE_COLLECTION", version: 2 }),
        eventsToAppend: [makeEvent()],
      }),
      "CASE_INTEGRITY_ERROR",
    );
  });

  it.each([
    ["event", { eventsToAppend: [makeEvent({ caseId: "case-other" })] }],
    ["evidence", { evidenceToAdd: [makeEvidence({ caseId: "case-other" })] }],
    ["claim", { claimsToSave: [makeClaim({ caseId: "case-other" })] }],
    ["audit", { auditRecordsToAppend: [makeAudit({ caseId: "case-other" })] }],
  ] satisfies Array<[string, Partial<CaseMutation>]>)("rejects a %s owned by another case", (_label, override) => {
    const original = snapshotWithCase(1);
    expectUnchanged(
      original,
      makeMutation(override),
      "CASE_INTEGRITY_ERROR",
    );
  });

  it("rejects an embedded party owned by another case", () => {
    const original = snapshotWithCase(1);
    expectUnchanged(
      original,
      makeMutation({
        caseRecord: makeCase({
          version: 2,
          parties: [
            {
              id: "party-merchant",
              caseId: "case-other",
              kind: "MERCHANT",
              name: "Other merchant",
            },
          ],
        }),
      }),
      "CASE_INTEGRITY_ERROR",
    );
  });

  it("rejects a claim whose claimant party does not exist", () => {
    const original = snapshotWithCase(1);
    expectUnchanged(
      original,
      validMixedMutationWith({
        claimsToSave: [makeClaim({ claimantPartyId: "party-missing" })],
      }),
      "CASE_INTEGRITY_ERROR",
    );
  });

  it("rejects a claim whose source event does not exist", () => {
    const original = snapshotWithCase(1);
    expectUnchanged(
      original,
      validMixedMutationWith({
        claimsToSave: [makeClaim({ sourceEventId: "event-missing" })],
      }),
      "CASE_INTEGRITY_ERROR",
    );
  });

  it("rejects a claim referencing evidence from another case", () => {
    const original = snapshotWithTwoCases();
    expectUnchanged(
      original,
      crossCaseClaimMutation(),
      "CASE_INTEGRITY_ERROR",
    );
  });

  it("rejects evidence that references a missing claim", () => {
    const original = snapshotWithCase(1);
    expectUnchanged(
      original,
      validMixedMutationWith({
        evidenceToAdd: [makeEvidence({ relatedClaimIds: ["claim-missing"] })],
      }),
      "CASE_INTEGRITY_ERROR",
    );
  });

  it("rejects an audit whose triggering event does not exist", () => {
    const original = snapshotWithCase(1);
    expectUnchanged(
      original,
      validMixedMutationWith({
        auditRecordsToAppend: [
          makeAudit({
            triggeringEventId: "event-missing",
            evidenceIds: ["evidence-merchant-message"],
          }),
        ],
      }),
      "CASE_INTEGRITY_ERROR",
    );
  });

  it("rejects an audit that references missing evidence", () => {
    const original = snapshotWithCase(1);
    expectUnchanged(
      original,
      validMixedMutationWith({
        auditRecordsToAppend: [
          makeAudit({
            triggeringEventId: "event-initial-evidence",
            evidenceIds: ["evidence-missing"],
          }),
        ],
      }),
      "CASE_INTEGRITY_ERROR",
    );
  });

  it("rejects an event whose causation event does not exist", () => {
    const original = snapshotWithCase(1);
    expectUnchanged(
      original,
      makeMutation({
        eventsToAppend: [makeEvent({ causationId: "event-missing" })],
      }),
      "CASE_INTEGRITY_ERROR",
    );
  });

  it("rejects an event that names itself as its cause", () => {
    const original = snapshotWithCase(1);
    expectUnchanged(
      original,
      makeMutation({
        eventsToAppend: [makeEvent({ causationId: "event-intake" })],
      }),
      "CASE_INTEGRITY_ERROR",
    );
  });

  it("rejects a duplicate event ID without changing the snapshot", () => {
    const original: ResolutionSnapshot = {
      ...snapshotWithCase(1),
      events: [makeEvent()],
    };
    expectUnchanged(
      original,
      makeMutation({ eventsToAppend: [makeEvent()] }),
      "DUPLICATE_EVENT",
    );
  });

  it("rejects a duplicate evidence ID without changing the snapshot", () => {
    const original = committedClaimSnapshot();
    expectUnchanged(
      original,
      makeMutation({
        caseRecord: makeCase({ state: "EVIDENCE_COLLECTION", version: 3 }),
        expectedCaseVersion: 2,
        evidenceToAdd: [makeEvidence({ relatedClaimIds: [] })],
      }),
      "CASE_INTEGRITY_ERROR",
    );
  });

  it("rejects a duplicate audit ID without changing the snapshot", () => {
    const original = committedClaimSnapshot();
    expectUnchanged(
      original,
      makeMutation({
        caseRecord: makeCase({ state: "EVIDENCE_COLLECTION", version: 3 }),
        expectedCaseVersion: 2,
        auditRecordsToAppend: [makeAudit()],
      }),
      "CASE_INTEGRITY_ERROR",
    );
  });

  it("upserts a same-case claim while preserving its identity", () => {
    const original = committedClaimSnapshot();
    const result = applyCaseMutation(
      original,
      makeMutation({
        caseRecord: makeCase({ state: "EVIDENCE_COLLECTION", version: 3 }),
        expectedCaseVersion: 2,
        claimsToSave: [
          makeClaim({ updatedAt: "2026-08-09T10:05:00.000Z" }),
        ],
      }),
    );

    expect(result.result).toBe("COMMITTED");
    expect(result.snapshot.claims).toHaveLength(1);
    expect(result.snapshot.claims[0]).toMatchObject({
      id: "claim-refund-processed",
      caseId: "case-rv-1028",
      status: "UNVERIFIED",
    });
  });
});

function validMixedMutationWith(
  overrides: Partial<CaseMutation>,
): CaseMutation {
  return {
    ...validMixedMutation(),
    ...overrides,
  };
}
