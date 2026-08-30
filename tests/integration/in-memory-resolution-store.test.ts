import { describe, expect, it } from "vitest";
import { makeAgentRun, snapshotForAgentRuns } from "@/tests/fixtures/agent";

import { InMemoryResolutionStore } from "@/src/infrastructure/memory/in-memory-resolution-store";
import {
  makeAudit,
  makeCase,
  makeEvent,
  makeMutation,
  snapshotWithCase,
} from "@/tests/fixtures/domain";

describe("InMemoryResolutionStore", () => {
  it("does not expose a transitioned case without its audit", async () => {
    const store = new InMemoryResolutionStore(snapshotWithCase(1));
    const result = await store.commitCaseMutation(
      makeMutation({
        caseRecord: makeCase({ state: "EVIDENCE_COLLECTION", version: 2 }),
        eventsToAppend: [makeEvent()],
        auditRecordsToAppend: [makeAudit()],
      }),
    );
    const bundle = await store.loadCaseBundle("case-rv-1028");

    expect(result).toBe("COMMITTED");
    expect(bundle?.caseRecord.version).toBe(2);
    expect(bundle?.auditRecords).toHaveLength(1);
  });

  it("returns detached reads that cannot mutate stored state", async () => {
    const store = new InMemoryResolutionStore(snapshotWithCase(1));
    const first = await store.loadCaseBundle("case-rv-1028");
    if (!first) throw new Error("Expected case bundle");
    first.caseRecord.title = "Mutated outside store";

    const second = await store.loadCaseBundle("case-rv-1028");
    expect(second?.caseRecord.title).toBe("SaaS subscription refund");
  });
});

describe("InMemoryResolutionStore AgentRun append", () => {
  it("appends repeated runs without advancing the case version", async () => {
    const store = new InMemoryResolutionStore(snapshotForAgentRuns());

    expect(
      await store.appendAgentRun({
        agentRun: makeAgentRun(),
        expectedCaseVersion: 4,
      }),
    ).toBe("COMMITTED");
    expect(
      await store.appendAgentRun({
        agentRun: makeAgentRun({ id: "agent-run-2" }),
        expectedCaseVersion: 4,
      }),
    ).toBe("COMMITTED");

    const bundle = await store.loadCaseBundle("case-rv-1028");
    expect(bundle?.caseRecord.version).toBe(4);
    expect(bundle?.agentRuns.map((run) => run.id)).toEqual([
      "agent-run-1",
      "agent-run-2",
    ]);
  });

  it("keeps historical runs when a later domain mutation advances the case", async () => {
    const store = new InMemoryResolutionStore(snapshotForAgentRuns());
    await store.appendAgentRun({
      agentRun: makeAgentRun(),
      expectedCaseVersion: 4,
    });

    expect(
      await store.commitCaseMutation(
        makeMutation({
          caseRecord: makeCase({
            state: "INVESTIGATING",
            version: 5,
            currentBlocker:
              "Refund transaction has not yet been independently verified.",
            nextBestAction: "Obtain traceable provider evidence.",
          }),
          expectedCaseVersion: 4,
        }),
      ),
    ).toBe("COMMITTED");

    const bundle = await store.loadCaseBundle("case-rv-1028");
    expect(bundle?.caseRecord.version).toBe(5);
    expect(bundle?.agentRuns[0]?.basedOnCaseVersion).toBe(4);
  });
});
