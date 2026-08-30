import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { makeAgentRun, snapshotForAgentRuns } from "@/tests/fixtures/agent";

import { JsonResolutionStore } from "@/src/infrastructure/local/json-resolution-store";
import {
  createCaseMutation,
  makeCase,
  makeEvidence,
  makeMutation,
  makeProviderTransaction,
  nextMutation,
  snapshotWithCase,
  snapshotWithTwoCases,
} from "@/tests/fixtures/domain";

const temporaryDirectories: string[] = [];

async function makeStorePath(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "resolvia-store-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "resolvia.json");
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("JsonResolutionStore", () => {
  it("persists one complete committed snapshot", async () => {
    const filePath = await makeStorePath();
    const store = new JsonResolutionStore(filePath);

    expect(await store.commitCaseMutation(createCaseMutation())).toBe(
      "COMMITTED",
    );

    const reopened = new JsonResolutionStore(filePath);
    expect(
      (await reopened.loadCaseBundle("case-rv-1028"))?.caseRecord.version,
    ).toBe(1);
  });

  it("keeps the active file unchanged when replacement fails", async () => {
    const filePath = await makeStorePath();
    const store = new JsonResolutionStore(filePath);
    await store.commitCaseMutation(createCaseMutation());
    const before = await readFile(filePath, "utf8");

    const failingStore = new JsonResolutionStore(filePath, {
      replace: async () => {
        throw new Error("forced replace failure");
      },
    });

    await expect(
      failingStore.commitCaseMutation(nextMutation()),
    ).rejects.toThrow("forced replace failure");
    expect(await readFile(filePath, "utf8")).toBe(before);
  });

  it("rejects a malformed stored snapshot", async () => {
    const filePath = await makeStorePath();
    await writeFile(filePath, JSON.stringify({ cases: "not-an-array" }), "utf8");

    const store = new JsonResolutionStore(filePath);
    await expect(store.loadCaseBundle("case-rv-1028")).rejects.toThrow();
  });

  it("serializes commits made through one store instance", async () => {
    const filePath = await makeStorePath();
    const store = new JsonResolutionStore(filePath);
    await store.commitCaseMutation(createCaseMutation());

    const first = makeMutation();
    const second = makeMutation({
      caseRecord: makeCase({ version: 2, nextBestAction: "Second writer" }),
    });

    const results = await Promise.all([
      store.commitCaseMutation(first),
      store.commitCaseMutation(second),
    ]);

    expect(results).toEqual(["COMMITTED", "VERSION_CONFLICT"]);
    expect(
      (await store.loadCaseBundle("case-rv-1028"))?.caseRecord.version,
    ).toBe(2);
  });

  it.each([
    [
      "missing evidence",
      snapshotWithCase(1),
      makeMutation({ transactionsToAdd: [makeProviderTransaction()] }),
    ],
    [
      "cross-case evidence",
      {
        ...snapshotWithTwoCases(),
        evidence: [
          makeEvidence({
            id: "evidence-other",
            caseId: "case-other",
            type: "PROVIDER_TRANSACTION",
            sourceProvider: "stripe",
            verificationLevel: "PROVIDER_VERIFIED",
            relatedClaimIds: [],
          }),
        ],
      },
      makeMutation({
        transactionsToAdd: [
          makeProviderTransaction({ evidenceId: "evidence-other" }),
        ],
      }),
    ],
    [
      "non-provider-verified evidence",
      snapshotWithCase(1),
      makeMutation({
        evidenceToAdd: [
          makeEvidence({
            id: "evidence-stripe-refund-re-test",
            relatedClaimIds: [],
            verificationLevel: "AUTHENTICATED_SOURCE",
          }),
        ],
        transactionsToAdd: [makeProviderTransaction()],
      }),
    ],
    [
      "duplicate provider object",
      {
        ...snapshotWithCase(1),
        evidence: [
          makeEvidence({
            id: "evidence-stripe-refund-re-test",
            type: "PROVIDER_TRANSACTION",
            sourceProvider: "stripe",
            verificationLevel: "PROVIDER_VERIFIED",
            relatedClaimIds: [],
          }),
        ],
        providerTransactions: [makeProviderTransaction()],
      },
      makeMutation({
        transactionsToAdd: [
          makeProviderTransaction({ id: "transaction-stripe-refund-other" }),
        ],
      }),
    ],
  ] as const)(
    "keeps the JSON snapshot byte-for-byte unchanged for %s",
    async (_label, original, mutation) => {
    const filePath = await makeStorePath();
    await writeFile(filePath, JSON.stringify(original), "utf8");
    const before = await readFile(filePath, "utf8");
    const store = new JsonResolutionStore(filePath);

    expect(await store.commitCaseMutation(mutation)).toBe(
      "CASE_INTEGRITY_ERROR",
    );
    expect(await readFile(filePath, "utf8")).toBe(before);
    },
  );
});

describe("JsonResolutionStore AgentRun append", () => {
  it("serializes repeated AgentRun appends without advancing case version", async () => {
    const filePath = await makeStorePath();
    await writeFile(filePath, JSON.stringify(snapshotForAgentRuns()), "utf8");
    const store = new JsonResolutionStore(filePath);

    const results = await Promise.all([
      store.appendAgentRun({
        agentRun: makeAgentRun(),
        expectedCaseVersion: 4,
      }),
      store.appendAgentRun({
        agentRun: makeAgentRun({ id: "agent-run-2" }),
        expectedCaseVersion: 4,
      }),
    ]);

    expect(results).toEqual(["COMMITTED", "COMMITTED"]);
    const bundle = await store.loadCaseBundle("case-rv-1028");
    expect(bundle?.caseRecord.version).toBe(4);
    expect(bundle?.agentRuns).toHaveLength(2);
  });

  it("rejects an append queued after a semantic version advance", async () => {
    const filePath = await makeStorePath();
    await writeFile(filePath, JSON.stringify(snapshotForAgentRuns()), "utf8");
    const store = new JsonResolutionStore(filePath);

    const semanticMutation = store.commitCaseMutation(
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
    );
    const staleAppend = store.appendAgentRun({
      agentRun: makeAgentRun(),
      expectedCaseVersion: 4,
    });

    expect(await semanticMutation).toBe("COMMITTED");
    expect(await staleAppend).toBe("VERSION_CONFLICT");
    const bundle = await store.loadCaseBundle("case-rv-1028");
    expect(bundle?.caseRecord.version).toBe(5);
    expect(bundle?.agentRuns).toEqual([]);
  });

  it("keeps the active file byte-for-byte unchanged when append replacement fails", async () => {
    const filePath = await makeStorePath();
    await writeFile(filePath, JSON.stringify(snapshotForAgentRuns()), "utf8");
    const before = await readFile(filePath, "utf8");
    const store = new JsonResolutionStore(filePath, {
      replace: async () => {
        throw new Error("forced AgentRun replace failure");
      },
    });

    await expect(
      store.appendAgentRun({
        agentRun: makeAgentRun(),
        expectedCaseVersion: 4,
      }),
    ).rejects.toThrow("forced AgentRun replace failure");
    expect(await readFile(filePath, "utf8")).toBe(before);
  });
});