import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ResolutionStore } from "@/src/application/ports/resolution-store";
import { createPartnerRequest } from "@/src/domain/partners/policy";
import { JsonResolutionStore } from "@/src/infrastructure/local/json-resolution-store";
import { InMemoryResolutionStore } from "@/src/infrastructure/memory/in-memory-resolution-store";
import { initialRefundBundle } from "@/tests/fixtures/domain";

const directories: string[] = [];
const rawToken = "partner-token-abcdefghijklmnopqrstuvwxyz0123456789";

async function jsonStore(): Promise<ResolutionStore> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "resolvia-partner-"));
  directories.push(directory);
  const filePath = path.join(directory, "resolvia.json");
  const bundle = initialRefundBundle();
  await writeFile(
    filePath,
    JSON.stringify({
      cases: [bundle.caseRecord],
      events: bundle.events,
      evidence: bundle.evidence,
      claims: bundle.claims,
      auditRecords: bundle.auditRecords,
      providerTransactions: bundle.providerTransactions,
      agentRuns: bundle.agentRuns,
    }),
    "utf8",
  );
  return new JsonResolutionStore(filePath);
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

for (const [label, makeStore] of [
  ["memory", async () => {
    const bundle = initialRefundBundle();
    return new InMemoryResolutionStore({
      cases: [bundle.caseRecord], events: bundle.events, evidence: bundle.evidence,
      claims: bundle.claims, auditRecords: bundle.auditRecords,
      providerTransactions: bundle.providerTransactions, agentRuns: bundle.agentRuns,
    });
  }],
  ["json", jsonStore],
] as const) {
  describe(`${label} partner request persistence`, () => {
    it("atomically persists only the request and token digest without semantic case mutation", async () => {
      const store = await makeStore();
      const bundle = await store.loadCaseBundle("case-rv-1028");
      if (!bundle) throw new Error("Expected RV-1028");
      const created = createPartnerRequest({
        caseRecord: bundle.caseRecord,
        requestId: `partner-request-${label}`,
        rawToken,
        now: "2026-08-12T13:10:00.000Z",
      });

      expect(await store.createPartnerRequest({ ...created, expectedCaseVersion: 4 })).toBe("COMMITTED");
      expect(await store.createPartnerRequest({ ...created, expectedCaseVersion: 4 })).toBe("CASE_INTEGRITY_ERROR");

      const after = await store.loadCaseBundle("case-rv-1028");
      expect(after?.caseRecord.version).toBe(4);
      expect(after?.partnerRequests).toEqual([created.request]);
      expect(after?.partnerTokenReceipts).toEqual([created.tokenReceipt]);
      expect(JSON.stringify(after)).not.toContain(rawToken);
    });
  });
}