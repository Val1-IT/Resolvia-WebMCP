"use client";

import { Bot, Check, X } from "lucide-react";
import { useState } from "react";

import type { ResolutionReadiness } from "@/src/domain/resolution/resolution-readiness";
import { WebmcpCaseToolsRegistrar } from "@/src/ui/components/webmcp-case-tools-registrar";
import { invokeWebmcpViaSameOrigin } from "@/src/ui/webmcp/register-case-tools";

export type EvidenceRequestDraftView = {
  requiresHumanApproval: true;
  caseId: string;
  caseVersion: number;
  target: string;
  requirementId: string;
  draft: {
    subject: string;
    body: string;
    requestedEvidenceType: string;
  };
  authority: "DRAFT_ONLY";
};

export function WebmcpCollaborationPanel({
  caseId,
  displayId,
  initialReadiness,
}: {
  caseId: string;
  displayId: string;
  initialReadiness: ResolutionReadiness;
}) {
  const [readiness, setReadiness] = useState(initialReadiness);
  const [draft, setDraft] = useState<EvidenceRequestDraftView | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refreshReadiness() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await invokeWebmcpViaSameOrigin(
        "resolvia_check_resolution_readiness",
        { caseId },
      );
      if (!response.ok) {
        setMessage(response.error);
        return;
      }
      setReadiness(response.result as ResolutionReadiness);
    } finally {
      setBusy(false);
    }
  }

  async function prepareMissingDraft() {
    const missing = readiness.requirements.find(
      (requirement) =>
        requirement.status === "MISSING" &&
        requirement.id === "customer_receipt_confirmation",
    );
    if (!missing) {
      setMessage("No actionable customer-receipt gap to draft.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await invokeWebmcpViaSameOrigin(
        "resolvia_prepare_evidence_request",
        {
          caseId,
          target: "CUSTOMER",
          requirementId: missing.id,
        },
      );
      if (!response.ok) {
        setMessage(response.error);
        return;
      }
      setDraft(response.result as EvidenceRequestDraftView);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="panel webmcp-collaboration"
      aria-labelledby="webmcp-collaboration-title"
    >
      <WebmcpCaseToolsRegistrar caseId={displayId} />
      <span className="panel-kicker">WEBMCP / AGENT COLLABORATION</span>
      <h2 id="webmcp-collaboration-title">
        <Bot aria-hidden="true" size={18} /> Resolution Readiness
      </h2>
      <p className="webmcp-readiness-count">
        {readiness.satisfiedRequirements} / {readiness.totalRequirements}{" "}
        requirements satisfied
      </p>
      <ul className="webmcp-requirement-list">
        {readiness.requirements.map((requirement) => (
          <li key={requirement.id} data-status={requirement.status}>
            {requirement.status === "SATISFIED" ? (
              <Check aria-hidden="true" size={16} />
            ) : (
              <X aria-hidden="true" size={16} />
            )}
            <span>{requirement.label}</span>
            <strong>{requirement.status}</strong>
          </li>
        ))}
      </ul>
      <dl className="webmcp-status-grid">
        <div>
          <dt>STATUS</dt>
          <dd>{readiness.ready ? "READY" : "NOT READY"}</dd>
        </div>
        <div>
          <dt>NEXT</dt>
          <dd>{readiness.nextBestAction}</dd>
        </div>
        <div>
          <dt>ACTION CODE</dt>
          <dd>{readiness.nextAllowedAction}</dd>
        </div>
      </dl>
      <div className="webmcp-actions">
        <button
          type="button"
          className="ghost-button"
          disabled={busy}
          onClick={() => void refreshReadiness()}
        >
          Refresh readiness
        </button>
        <button
          type="button"
          className="ghost-button"
          disabled={busy}
          onClick={() => void prepareMissingDraft()}
        >
          Prepare evidence-request draft
        </button>
      </div>
      {message ? <p className="webmcp-message">{message}</p> : null}
      {draft ? (
        <div className="webmcp-draft" aria-label="Evidence request draft">
          <span className="webmcp-draft-banner">
            DRAFT — HUMAN APPROVAL REQUIRED
          </span>
          <p>
            <strong>Target:</strong> {draft.target}
          </p>
          <p>
            <strong>Subject:</strong> {draft.draft.subject}
          </p>
          <pre>{draft.draft.body}</pre>
          <p className="webmcp-draft-footnote">
            requiresHumanApproval = true · authority = DRAFT_ONLY · case version{" "}
            {draft.caseVersion}
          </p>
        </div>
      ) : null}
    </section>
  );
}
