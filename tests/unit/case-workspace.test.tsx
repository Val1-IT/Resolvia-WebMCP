// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { buildCaseWorkspaceViewModel } from "@/src/ui/case-workspace/model";
import { CaseWorkspace } from "@/src/ui/components/case-workspace";
import { ProvenanceBadge } from "@/src/ui/components/provenance-badge";
import { makeAgentRun } from "@/tests/fixtures/agent";
import { initialRefundBundle, makeEvent } from "@/tests/fixtures/domain";
import { planProviderRefundMutation } from "@/src/domain/events/provider-refund-policy";
import { applyCaseMutation } from "@/src/domain/store/apply-mutation";

describe("CaseWorkspace", () => {
  it("separates authenticated assertion from transaction verification", () => {
    render(
      <CaseWorkspace
        viewModel={buildCaseWorkspaceViewModel(initialRefundBundle())}
      />,
    );

    expect(screen.getByText("AUTHENTICATED CLAIM")).toBeInTheDocument();
    expect(screen.getByText("AUTHENTICATED SOURCE")).toBeInTheDocument();
    expect(
      screen.getAllByText(
        "Refund transaction has not yet been independently verified.",
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("VERIFICATION GAP").length).toBeGreaterThan(0);
    expect(screen.getAllByText("UNKNOWN").length).toBeGreaterThan(0);
    expect(screen.queryByText("PROVIDER VERIFIED")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "AI RESOLUTION ANALYSIS" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No agent analysis has been recorded for this case."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analyze case" })).toBeInTheDocument();
  });

  it("visibly separates deterministic status from AI analysis", () => {
    const bundle = initialRefundBundle();
    bundle.agentRuns = [makeAgentRun({ modelVersion: "2026-08-09" })];

    render(
      <CaseWorkspace viewModel={buildCaseWorkspaceViewModel(bundle)} />,
    );

    expect(
      screen.getByRole("heading", { name: "AI RESOLUTION ANALYSIS" }),
    ).toBeInTheDocument();
    expect(screen.getByText("DETERMINISTIC CASE STATUS")).toBeInTheDocument();
    expect(screen.getAllByText("DETERMINISTIC FACT").length).toBeGreaterThan(0);
    expect(screen.getAllByText("AGENT ASSESSMENT").length).toBeGreaterThan(0);
    expect(screen.getByText("Validation PASSED")).toBeInTheDocument();
    expect(screen.getByText("VALID")).toBeInTheDocument();
    expect(screen.getByText("gemini-2.5-flash")).toBeInTheDocument();
    expect(screen.getByText("2026-08-09")).toBeInTheDocument();
    expect(screen.getByText("Case v4")).toBeInTheDocument();
    expect(screen.getByText(/Aug 9, 2026/)).toBeInTheDocument();
    expect(screen.getByText("resolution-agent-v1")).toBeInTheDocument();
    expect(screen.getByText("agent-resolution-proposal-v1")).toBeInTheDocument();
    expect(screen.getByText("agent-proposal-validator-v1")).toBeInTheDocument();
    expect(screen.getByText(/Rationale: The proposition is still unsupported/)).toBeInTheDocument();
    expect(screen.getByText("EXTERNAL STATUS UNKNOWN")).toBeInTheDocument();
    expect(screen.getByText("Does the provider have a refund transaction?")).toBeInTheDocument();
    expect(screen.getAllByText(/verification-gap:claim-refund-processed/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/evidence-merchant-message/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Recommendation classification: SAFE INTERNAL/)).toBeInTheDocument();
    expect(
      screen.getByText(/Gemini did not verify facts/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No case status changed and no action was performed"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh analysis" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it.each([
    ["FAILED_CONFIGURATION", "Agent analysis unavailable", "UNAVAILABLE"],
    ["FAILED_TIMEOUT", "Analysis timed out", "UNAVAILABLE"],
    ["FAILED_NETWORK", "Provider unavailable", "UNAVAILABLE"],
    ["FAILED_QUOTA", "Analysis quota unavailable", "UNAVAILABLE"],
    ["FAILED_MALFORMED_OUTPUT", "Malformed analysis output", "MALFORMED"],
    ["FAILED_SCHEMA", "Analysis schema failure", "SCHEMA FAILURE"],
  ] as const)("renders safe degraded UI for %s", (outcome, title, label) => {
    const bundle = initialRefundBundle();
    bundle.agentRuns = [
      makeAgentRun({
        outcome,
        summary: undefined,
        assessment: undefined,
        blocker: undefined,
        recommendedAction: undefined,
        uncertainty: undefined,
        openQuestions: undefined,
        observedVerificationGapIds: undefined,
        rawOutputDigest: undefined,
        validationErrors: [],
      }),
    ];

    render(
      <CaseWorkspace viewModel={buildCaseWorkspaceViewModel(bundle)} />,
    );

    expect(screen.getByText(title, { exact: true })).toBeInTheDocument();
    expect(screen.getByText(label, { exact: true })).toBeInTheDocument();
    expect(screen.getByText("INVESTIGATING", { exact: true })).toBeInTheDocument();
    expect(
      screen.getAllByText(
        "Refund transaction has not yet been independently verified.",
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("PROVIDER VERIFIED")).not.toBeInTheDocument();
  });

  it("renders an immutable prior run as stale", () => {
    const bundle = initialRefundBundle();
    bundle.agentRuns = [makeAgentRun({ basedOnCaseVersion: 4 })];
    bundle.caseRecord.version = 5;

    render(
      <CaseWorkspace viewModel={buildCaseWorkspaceViewModel(bundle)} />,
    );

    expect(screen.getByText("STALE", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Case v4", { exact: true })).toBeInTheDocument();
  });

  it("keeps deterministic workspace visible when agent configuration fails", () => {
    const bundle = initialRefundBundle();
    bundle.agentRuns = [
      makeAgentRun({
        outcome: "FAILED_CONFIGURATION",
        summary: undefined,
        assessment: undefined,
        blocker: undefined,
        recommendedAction: undefined,
        uncertainty: undefined,
        openQuestions: undefined,
        observedVerificationGapIds: undefined,
        rawOutputDigest: undefined,
        validationErrors: [],
      }),
    ];

    render(
      <CaseWorkspace viewModel={buildCaseWorkspaceViewModel(bundle)} />,
    );

    expect(screen.getByText("Agent analysis unavailable")).toBeInTheDocument();
    expect(
      screen.getAllByText(
        "Refund transaction has not yet been independently verified.",
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("INVESTIGATING")).toBeInTheDocument();
  });

  it("shows safe metadata for a proposal-free cross-case rejection", () => {
    const bundle = initialRefundBundle();
    bundle.agentRuns = [
      makeAgentRun({
        outcome: "REJECTED_VALIDATION",
        summary: undefined,
        assessment: undefined,
        blocker: undefined,
        recommendedAction: undefined,
        uncertainty: undefined,
        openQuestions: undefined,
        observedVerificationGapIds: undefined,
        validationErrors: ["CROSS_CASE_EVIDENCE_REFERENCE"],
      }),
    ];

    render(
      <CaseWorkspace viewModel={buildCaseWorkspaceViewModel(bundle)} />,
    );

    expect(screen.getByText("Validation REJECTED")).toBeInTheDocument();
    expect(screen.getByText("CROSS_CASE_EVIDENCE_REFERENCE")).toBeInTheDocument();
    expect(screen.queryByText("Unsafe retained narrative")).not.toBeInTheDocument();
  });

  it("exposes distinct accessible provenance and uncertainty labels", () => {
    const labels = [
      "USER_REPORTED",
      "DOCUMENT_EXTRACTED",
      "AUTHENTICATED_SOURCE",
      "PROVIDER_VERIFIED",
      "DEMO_PROVIDER_VERIFIED",
      "PARTNER_VERIFIED",
      "UNKNOWN",
    ] as const;

    render(
      <div>
        {labels.map((label) => (
          <ProvenanceBadge key={label} level={label} />
        ))}
      </div>,
    );

    for (const label of labels) {
      expect(
        screen.getByLabelText(`Evidence confidence: ${label}`),
      ).toBeInTheDocument();
    }
  });

  it("shows the trigger event and rule behind an audited transition", () => {
    render(
      <CaseWorkspace
        viewModel={buildCaseWorkspaceViewModel(initialRefundBundle())}
      />,
    );

    expect(
      screen.getByText(
        "Triggered by event-intake · Rule NEW_TO_EVIDENCE_COLLECTION",
      ),
    ).toBeInTheDocument();
  });
  it("labels a Demo Provider transaction as simulated rather than Stripe", () => {
    const bundle = initialRefundBundle();
    const event = makeEvent({
      id: "resolvia_demo_provider:event-demo-workspace",
      kind: "PROVIDER_REFUND_OBSERVED",
      source: { category: "PROVIDER", provider: "resolvia_demo_provider", runtimeMode: "TEST" },
      occurredAt: "2026-08-12T12:00:00.000Z",
      receivedAt: "2026-08-12T12:00:00.000Z",
      correlationId: "event-demo-workspace",
      payload: { providerEventId: "event-demo-workspace", providerEventType: "refund.observed", providerObjectId: "demo_refund_workspace", providerObjectType: "refund", providerObjectCreatedAt: "2026-08-12T12:00:00.000Z", providerStatus: "pending" },
    });
    const planned = planProviderRefundMutation(bundle, event, () => "2026-08-12T12:00:01.000Z");
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const applied = applyCaseMutation({ cases: [bundle.caseRecord], events: bundle.events, evidence: bundle.evidence, claims: bundle.claims, auditRecords: bundle.auditRecords, providerTransactions: bundle.providerTransactions, agentRuns: bundle.agentRuns }, planned.mutation);
    expect(applied.result).toBe("COMMITTED");
    const updated = { caseRecord: applied.snapshot.cases[0]!, events: applied.snapshot.events, evidence: applied.snapshot.evidence, claims: applied.snapshot.claims, auditRecords: applied.snapshot.auditRecords, providerTransactions: applied.snapshot.providerTransactions, agentRuns: applied.snapshot.agentRuns };
    render(<CaseWorkspace viewModel={buildCaseWorkspaceViewModel(updated)} />);
    expect(screen.getByText(/Demo Provider \(simulated\) Test Mode reports processor status PENDING/)).toBeInTheDocument();
    expect(screen.queryByText(/Stripe Test Mode reports processor status pending/)).not.toBeInTheDocument();
  });
  it("labels the connected workspace separately from local provider environment", () => {
    render(
      <CaseWorkspace
        viewModel={buildCaseWorkspaceViewModel(initialRefundBundle())}
        runtimeMode="CONNECTED"
      />,
    );
    expect(screen.getByText("CONNECTED PHASE 6 - PRIVATE EVENT BACKBONE")).toBeInTheDocument();
    expect(screen.queryByText("LOCAL PHASE 5 - STRIPE TEST MODE")).not.toBeInTheDocument();
  });
});
