import { describe, expect, it } from "vitest";

import type { ResolutionStore } from "@/src/application/ports/resolution-store";
import type { AgentRunMutation } from "@/src/domain/agent/model";
import type { PartnerRequestAccess, PartnerRequestMutation, PartnerSubmissionPublication, PartnerSubmissionRelease, PartnerSubmissionReservation } from "@/src/domain/partners/model";
import { seedDemoCase } from "@/src/application/cases/seed-demo-case";
import type {
  AppendAgentRunResult,
  CaseMutation,
  CommitResult,
  ResolutionCaseBundle,
} from "@/src/domain/store/model";
import { InMemoryResolutionStore } from "@/src/infrastructure/memory/in-memory-resolution-store";
import { emptySnapshot } from "@/tests/fixtures/domain";

describe("seedDemoCase", () => {
  it("creates RV-1028 through audited deterministic domain transitions", async () => {
    const store = new InMemoryResolutionStore(emptySnapshot());

    await seedDemoCase(store);
    const bundle = await store.loadCaseBundle("case-rv-1028");

    expect(bundle?.caseRecord).toMatchObject({
      displayId: "RV-1028",
      state: "INVESTIGATING",
      version: 4,
      currentBlocker:
        "Refund transaction has not yet been independently verified.",
      nextBestAction: "Obtain traceable provider evidence.",
      createdAt: "2026-08-09T10:00:00.000Z",
      updatedAt: "2026-08-09T10:03:00.000Z",
    });
    expect(
      bundle?.auditRecords.map((record) => [
        record.previousState,
        record.resultingState,
      ]),
    ).toEqual([
      ["NEW", "EVIDENCE_COLLECTION"],
      ["EVIDENCE_COLLECTION", "INVESTIGATING"],
    ]);
    expect(bundle?.claims).toHaveLength(1);
    expect(bundle?.claims[0]).toMatchObject({
      id: "claim-refund-processed",
      status: "UNVERIFIED",
      evidenceRelationships: [
        {
          evidenceId: "evidence-merchant-message",
          kind: "AUTHENTICATES_ASSERTION",
        },
      ],
    });
    expect(bundle?.evidence[0]).toMatchObject({
      id: "evidence-merchant-message",
      verificationLevel: "AUTHENTICATED_SOURCE",
    });
    expect(bundle).not.toHaveProperty("transactions");
    expect(bundle).not.toHaveProperty("actions");
  });

  it("is idempotent when RV-1028 already exists", async () => {
    const store = new InMemoryResolutionStore(emptySnapshot());
    await seedDemoCase(store);
    const before = await store.loadCaseBundle("case-rv-1028");

    await seedDemoCase(store);

    expect(await store.loadCaseBundle("case-rv-1028")).toEqual(before);
  });

  it("does not partially apply a rejected seed mutation", async () => {
    const inner = new InMemoryResolutionStore(emptySnapshot());
    const rejectingStore = new RejectingStore(inner, 4);

    await expect(seedDemoCase(rejectingStore)).rejects.toMatchObject({
      code: "CASE_INTEGRITY_ERROR",
    });

    const bundle = await inner.loadCaseBundle("case-rv-1028");
    expect(bundle?.caseRecord.version).toBe(3);
    expect(bundle?.caseRecord.state).toBe("EVIDENCE_COLLECTION");
    expect(bundle?.auditRecords).toHaveLength(1);
  });
});

class RejectingStore implements ResolutionStore {
  private commitCount = 0;

  constructor(
    private readonly inner: ResolutionStore,
    private readonly rejectCommitNumber: number,
  ) {}

  loadPartnerRequest(requestId: string): Promise<PartnerRequestAccess | null> {
    return this.inner.loadPartnerRequest(requestId);
  }

  loadCaseBundle(caseId: string): Promise<ResolutionCaseBundle | null> {
    return this.inner.loadCaseBundle(caseId);
  }

  releasePartnerSubmission(mutation: PartnerSubmissionRelease) {
    return this.inner.releasePartnerSubmission(mutation);
  }

  reservePartnerSubmission(mutation: PartnerSubmissionReservation) {
    return this.inner.reservePartnerSubmission(mutation);
  }

  markPartnerSubmissionPublished(mutation: PartnerSubmissionPublication) {
    return this.inner.markPartnerSubmissionPublished(mutation);
  }

  createPartnerRequest(mutation: PartnerRequestMutation) {
    return this.inner.createPartnerRequest(mutation);
  }

  appendAgentRun(mutation: AgentRunMutation): Promise<AppendAgentRunResult> {
    return this.inner.appendAgentRun(mutation);
  }

  commitCaseMutation(mutation: CaseMutation): Promise<CommitResult> {
    this.commitCount += 1;
    if (this.commitCount === this.rejectCommitNumber) {
      return Promise.resolve("CASE_INTEGRITY_ERROR");
    }
    return this.inner.commitCaseMutation(mutation);
  }
}
