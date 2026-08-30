import { describe, expect, it } from "vitest";

import { seedDemoCase } from "@/src/application/cases/seed-demo-case";
import {
  assertNoSecretFields,
  prepareEvidenceRequestDraft,
  projectWebmcpCaseSummary,
  projectWebmcpGaps,
  projectWebmcpTruthGraph,
} from "@/src/application/webmcp/case-tool-service";
import {
  HIGH_RISK_TOOL_NAMES_FORBIDDEN,
  invokeWebmcpTool,
  WEBMCP_TOOL_NAMES,
} from "@/src/application/webmcp/invoke-tool";
import {
  normalizeWebmcpCaseId,
  WebmcpInputError,
} from "@/src/application/webmcp/schemas";
import { RV_1028_CASE_ID } from "@/src/demo/rv-1028";
import type { ResolutionCaseBundle } from "@/src/domain/store/model";
import { InMemoryResolutionStore } from "@/src/infrastructure/memory/in-memory-resolution-store";
import {
  initialRefundBundle,
  makeAudit,
  makeEvent,
  makeMutation,
  snapshotWithCase,
} from "@/tests/fixtures/domain";

const now = "2026-08-12T17:10:00.000Z";
const identity = { userId: "resolvia-demo-user", isAdmin: true };
const otherIdentity = { userId: "other-user", isAdmin: false };

function receiptGapBundle(): ResolutionCaseBundle {
  const bundle = initialRefundBundle();
  bundle.caseRecord = {
    ...bundle.caseRecord,
    state: "RESOLUTION_PENDING",
    version: 6,
    ownerUserId: "resolvia-demo-user",
  };
  bundle.evidence.push({
    id: "evidence-provider-success",
    caseId: bundle.caseRecord.id,
    type: "PROVIDER_TRANSACTION",
    source: "demo",
    sourceProvider: "resolvia_demo_provider",
    externalReference: "refund-demo-1028",
    contentSummary: "succeeded",
    verificationLevel: "DEMO_PROVIDER_VERIFIED",
    retrievedAt: now,
    createdAt: now,
    metadata: { providerStatus: "succeeded" },
    relatedClaimIds: [],
  });
  bundle.providerTransactions.push({
    id: "transaction-demo-1028",
    caseId: bundle.caseRecord.id,
    provider: "resolvia_demo_provider",
    providerObjectId: "refund-demo-1028",
    kind: "REFUND",
    status: "SUCCEEDED",
    evidenceId: "evidence-provider-success",
    observedAt: now,
    createdAt: now,
  });
  return bundle;
}

describe("WebMCP case tools", () => {
  it("rejects malformed case IDs", () => {
    expect(() => normalizeWebmcpCaseId("../etc/passwd")).toThrow(WebmcpInputError);
    expect(() => normalizeWebmcpCaseId("")).toThrow(WebmcpInputError);
    expect(normalizeWebmcpCaseId("RV-1028")).toBe(RV_1028_CASE_ID);
  });

  it("exposes only the approved tool names and never high-risk mutation tools", () => {
    expect([...WEBMCP_TOOL_NAMES].sort()).toEqual(
      [
        "resolvia_check_resolution_readiness",
        "resolvia_get_case",
        "resolvia_get_truth_graph",
        "resolvia_list_resolution_gaps",
        "resolvia_prepare_evidence_request",
      ].sort(),
    );
    for (const name of HIGH_RISK_TOOL_NAMES_FORBIDDEN) {
      expect(WEBMCP_TOOL_NAMES).not.toContain(name);
    }
  });

  it("preserves Claim != Evidence in truth graph projection", () => {
    const bundle = receiptGapBundle();
    const graph = projectWebmcpTruthGraph(bundle);
    expect(graph.note).toContain("Claim records are not evidence");
    expect(graph.claims[0]).toHaveProperty("claimStatus");
    expect(graph.claims[0]).not.toHaveProperty("verificationLevel");
    expect(graph.evidence[0]).toHaveProperty("verificationLevel");
    expect(graph.evidence[0]).not.toHaveProperty("claimStatus");
  });

  it("prepare_evidence_request requires human approval and is draft-only", () => {
    const before = structuredClone(receiptGapBundle());
    const draft = prepareEvidenceRequestDraft({
      bundle: before,
      requirementId: "customer_receipt_confirmation",
      target: "CUSTOMER",
    });
    expect(draft.requiresHumanApproval).toBe(true);
    expect(draft.authority).toBe("DRAFT_ONLY");
    expect(before.caseRecord.version).toBe(receiptGapBundle().caseRecord.version);
    expect(before.evidence.length).toBe(receiptGapBundle().evidence.length);
  });

  it("prepare_evidence_request rejects already satisfied requirements", () => {
    const bundle = receiptGapBundle();
    bundle.evidence.push({
      id: "evidence-partner-receipt",
      caseId: bundle.caseRecord.id,
      type: "PARTNER_RESPONSE",
      source: "partner",
      sourceProvider: "resolvia_demo_partner",
      externalReference: "receipt",
      contentSummary: "confirmed",
      verificationLevel: "PARTNER_VERIFIED",
      retrievedAt: now,
      createdAt: now,
      metadata: {
        requestedEvidenceType: "CUSTOMER_RECEIPT",
        responseStatus: "CONFIRMED",
      },
      relatedClaimIds: [],
    });
    expect(() =>
      prepareEvidenceRequestDraft({
        bundle,
        requirementId: "customer_receipt_confirmation",
        target: "CUSTOMER",
      }),
    ).toThrow(/REQUIREMENT_ALREADY_SATISFIED/);
  });

  it("get_case cannot access another unauthorized case", async () => {
    const store = new InMemoryResolutionStore(snapshotWithCase(4));
    await seedDemoCase(store);
    const result = await invokeWebmcpTool({
      store,
      identity: otherIdentity,
      body: {
        tool: "resolvia_get_case",
        arguments: { caseId: "RV-1028" },
      },
    });
    expect(result).toEqual({
      ok: false,
      status: 404,
      error: "Case not found.",
      code: "NOT_FOUND",
    });
  });

  it("reads current case version at invocation time, not a stale snapshot", async () => {
    const store = new InMemoryResolutionStore({
      cases: [],
      events: [],
      evidence: [],
      claims: [],
      auditRecords: [],
      providerTransactions: [],
      agentRuns: [],
      partnerRequests: [],
      partnerTokenReceipts: [],
    });
    await seedDemoCase(store);

    const first = await invokeWebmcpTool({
      store,
      identity,
      body: {
        tool: "resolvia_get_case",
        arguments: { caseId: "RV-1028" },
      },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const summary = first.result as ReturnType<typeof projectWebmcpCaseSummary>;
    const versionAtRegister = summary.caseVersion;
    const bundle = (await store.loadCaseBundle(RV_1028_CASE_ID))!;

    const bumpEvent = makeEvent({
      id: `event-webmcp-bump-${bundle.caseRecord.version}`,
      kind: "USER_ACTION_REQUIRED",
      payload: { note: "version bump for webmcp freshness" },
    });
    const commit = await store.commitCaseMutation(
      makeMutation({
        caseRecord: {
          ...bundle.caseRecord,
          version: bundle.caseRecord.version + 1,
          currentBlocker: "Updated blocker after registration.",
          updatedAt: now,
        },
        expectedCaseVersion: bundle.caseRecord.version,
        eventsToAppend: [bumpEvent],
        auditRecordsToAppend: [
          makeAudit({
            id: `audit-webmcp-bump-${bundle.caseRecord.version}`,
            triggeringEventId: bumpEvent.id,
            ruleId: "WEBMCP_TEST_VERSION_BUMP",
            previousState: bundle.caseRecord.state,
            resultingState: bundle.caseRecord.state,
            reason: "Test-only version bump proving WebMCP reads current state.",
            changedFields: ["version", "currentBlocker", "updatedAt"],
            timestamp: now,
          }),
        ],
      }),
    );
    expect(commit).toBe("COMMITTED");

    const second = await invokeWebmcpTool({
      store,
      identity,
      body: {
        tool: "resolvia_get_case",
        arguments: { caseId: "RV-1028" },
      },
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const fresh = second.result as ReturnType<typeof projectWebmcpCaseSummary>;
    expect(fresh.caseVersion).toBe(versionAtRegister + 1);
    expect(fresh.currentBlocker).toBe("Updated blocker after registration.");
  });

  it("bounds outputs and rejects secret fields", () => {
    const summary = projectWebmcpCaseSummary(receiptGapBundle());
    expect(summary).not.toHaveProperty("ownerUserId");
    assertNoSecretFields(summary);
    assertNoSecretFields(projectWebmcpGaps(receiptGapBundle()));
  });

  it("does not leak cross-case evidence", () => {
    const bundle = receiptGapBundle();
    bundle.evidence.push({
      id: "evidence-other-case",
      caseId: "case-other",
      type: "PROVIDER_TRANSACTION",
      source: "other",
      sourceProvider: "stripe",
      externalReference: "x",
      contentSummary: "should not appear",
      verificationLevel: "PROVIDER_VERIFIED",
      retrievedAt: now,
      createdAt: now,
      metadata: {},
      relatedClaimIds: [],
    });
    const graph = projectWebmcpTruthGraph(bundle);
    expect(graph.evidence.map((row) => row.id)).not.toContain(
      "evidence-other-case",
    );
  });
});
