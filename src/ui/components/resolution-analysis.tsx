import { Bot, CircleAlert, RefreshCw, ShieldCheck } from "lucide-react";

import type {
  AgentAnalysisViewModel,
  CaseWorkspaceViewModel,
} from "@/src/ui/case-workspace/model";
import { AnalyzeCaseControl } from "@/src/ui/components/analyze-case-control";

export function ResolutionAnalysis({
  viewModel,
}: {
  viewModel: CaseWorkspaceViewModel;
}) {
  const analysis = viewModel.agentAnalysis;

  return (
    <section className="panel analysis-panel" aria-labelledby="analysis-title">
      <div className="analysis-heading">
        <span className="panel-kicker">Resolution analysis</span>
        <h2 id="analysis-title">
          <Bot aria-hidden="true" size={18} /> AI RESOLUTION ANALYSIS
        </h2>
      </div>

      {analysis ? (
        <AnalysisResult analysis={analysis} />
      ) : (
        <div className="analysis-empty">
          <p>No agent analysis has been recorded for this case.</p>
          <span>Deterministic case status remains authoritative.</span>
        </div>
      )}

      <AnalyzeCaseControl caseId={viewModel.caseId} hasRun={Boolean(analysis)} />
    </section>
  );
}

function AnalysisResult({ analysis }: { analysis: AgentAnalysisViewModel }) {
  const failureMessage = safeFailureMessage(analysis.outcome);

  return (
    <div className="analysis-result">
      <div className="analysis-badges">
        <span className="analysis-outcome">
          {displayOutcome(analysis.outcome)}
        </span>
        <span
          className={`analysis-freshness freshness-${analysis.freshness.toLowerCase()}`}
        >
          {analysis.freshness}
        </span>
        {analysis.validationPassed ? (
          <span className="validation-passed">
            <ShieldCheck aria-hidden="true" size={13} /> Validation PASSED
          </span>
        ) : analysis.outcome === "REJECTED_VALIDATION" ? (
          <span className="validation-rejected">
            <CircleAlert aria-hidden="true" size={13} /> Validation REJECTED
          </span>
        ) : null}
      </div>

      <dl className="analysis-meta">
        <div>
          <dt>MODEL</dt>
          <dd>{analysis.modelId}</dd>
        </div>
        {analysis.modelVersion ? (
          <div>
            <dt>MODEL VERSION</dt>
            <dd>{analysis.modelVersion}</dd>
          </div>
        ) : null}
        <div>
          <dt>BASED ON</dt>
          <dd>Case v{analysis.basedOnCaseVersion}</dd>
        </div>
        <div>
          <dt>ANALYZED</dt>
          <dd>{formatTimestamp(analysis.analyzedAt)}</dd>
        </div>
      </dl>

      {analysis.validationPassed ? (
        <p className="analysis-helper">
          Gemini did not verify facts. Schema and deterministic Resolvia policy
          checks passed.
        </p>
      ) : null}

      {failureMessage ? (
        <div className="analysis-failure">
          <RefreshCw aria-hidden="true" size={16} />
          <div>
            <strong>{failureMessage.title}</strong>
            <p>{failureMessage.detail}</p>
          </div>
        </div>
      ) : null}

      {analysis.summary ? (
        <AssessmentBlock title="Summary">
          <p>{analysis.summary}</p>
        </AssessmentBlock>
      ) : null}

      {analysis.assessment ? (
        <AssessmentBlock title="Current assessment">
          <ReferenceLine
            label="Authenticated assertions"
            ids={analysis.assessment.authenticatedAssertionClaimIds}
          />
          <ReferenceLine
            label="Supported propositions"
            ids={analysis.assessment.supportedPropositionClaimIds}
          />
          <ReferenceLine
            label="Contradicted propositions"
            ids={analysis.assessment.contradictedPropositionClaimIds}
          />
          <ReferenceLine
            label="Unknown claims"
            ids={analysis.assessment.unknownClaimIds}
          />
          <ReferenceLine
            label="Provider-verified evidence"
            ids={analysis.assessment.providerVerifiedEvidenceIds}
          />
          <ReferenceLine
            label="Demo Provider-verified evidence"
            ids={analysis.assessment.demoProviderVerifiedEvidenceIds}
          />
        </AssessmentBlock>
      ) : null}

      {analysis.blocker ? (
        <AssessmentBlock title="Proposed blocker">
          <strong>{displayCode(analysis.blocker.code)}</strong>
          <p>{analysis.blocker.explanation}</p>
          <ReferenceLine label="Claims" ids={analysis.blocker.claimIds} />
          <ReferenceLine label="Evidence" ids={analysis.blocker.evidenceIds} />
          <ReferenceLine
            label="Verification gaps"
            ids={analysis.blocker.verificationGapIds}
          />
        </AssessmentBlock>
      ) : null}

      {analysis.recommendedAction ? (
        <AssessmentBlock title="Recommended action">
          <strong>{displayCode(analysis.recommendedAction.type)}</strong>
          <p>{analysis.recommendedAction.description}</p>
          <p>Rationale: {analysis.recommendedAction.rationale}</p>
          <ReferenceLine
            label="Claims"
            ids={analysis.recommendedAction.claimIds}
          />
          <ReferenceLine
            label="Evidence"
            ids={analysis.recommendedAction.evidenceIds}
          />
          <ReferenceLine
            label="Verification gaps"
            ids={analysis.recommendedAction.verificationGapIds}
          />
          <small>
            Recommendation classification: {displayCode(analysis.recommendedAction.approvalLevel)}
            {" — not executed"}
          </small>
        </AssessmentBlock>
      ) : null}

      {analysis.uncertainty?.map((uncertainty) => (
        <AssessmentBlock
          key={`${uncertainty.code}:${uncertainty.explanation}`}
          title="Uncertainty"
        >
          <strong>{displayCode(uncertainty.code)}</strong>
          <p>{uncertainty.explanation}</p>
          <ReferenceLine
            label="Claims"
            ids={uncertainty.relatedClaimIds}
          />
          <ReferenceLine label="Evidence" ids={uncertainty.evidenceIds} />
          <ReferenceLine
            label="Verification gaps"
            ids={uncertainty.verificationGapIds}
          />
        </AssessmentBlock>
      ))}

      {analysis.openQuestions?.map((question) => (
        <AssessmentBlock key={question.question} title="Open question">
          <p>{question.question}</p>
          <ReferenceLine label="Claims" ids={question.relatedClaimIds} />
          <ReferenceLine label="Evidence" ids={question.evidenceIds} />
          <ReferenceLine
            label="Verification gaps"
            ids={question.verificationGapIds}
          />
        </AssessmentBlock>
      ))}

      {analysis.observedVerificationGapIds ? (
        <AssessmentBlock title="Observed verification gaps">
          <ReferenceLine
            label="Verification gaps"
            ids={analysis.observedVerificationGapIds}
          />
        </AssessmentBlock>
      ) : null}

      {analysis.validationErrors.length > 0 ? (
        <div className="analysis-errors">
          <span>DETERMINISTIC VALIDATION</span>
          <ul>
            {analysis.validationErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {analysis.rawOutputDigest && analysis.outcome === "REJECTED_VALIDATION" ? (
        <p className="analysis-digest">
          Proposal digest: <code>{analysis.rawOutputDigest}</code>
        </p>
      ) : null}

      <div className="analysis-versions">
        <span>{analysis.promptVersion}</span>
        <span>{analysis.schemaVersion}</span>
        <span>{analysis.validatorVersion}</span>
      </div>

      {analysis.validationPassed ? (
        <p className="analysis-no-effect">
          No case status changed and no action was performed
        </p>
      ) : null}
    </div>
  );
}

function AssessmentBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="agent-assessment">
      <span>AGENT ASSESSMENT</span>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function ReferenceLine({ label, ids }: { label: string; ids: string[] }) {
  return (
    <p className="analysis-reference">
      <b>{label}:</b> {ids.length > 0 ? ids.join(", ") : "None"}
    </p>
  );
}

function displayOutcome(outcome: AgentAnalysisViewModel["outcome"]): string {
  switch (outcome) {
    case "SUCCEEDED_VALID":
      return "VALID";
    case "REJECTED_VALIDATION":
      return "REJECTED";
    case "FAILED_CONFIGURATION":
    case "FAILED_TIMEOUT":
    case "FAILED_NETWORK":
    case "FAILED_QUOTA":
      return "UNAVAILABLE";
    case "FAILED_MALFORMED_OUTPUT":
      return "MALFORMED";
    case "FAILED_SCHEMA":
      return "SCHEMA FAILURE";
  }
}

function displayCode(value: string): string {
  return value.replaceAll("_", " ");
}

function safeFailureMessage(outcome: AgentAnalysisViewModel["outcome"]) {
  switch (outcome) {
    case "FAILED_CONFIGURATION":
      return {
        title: "Agent analysis unavailable",
        detail:
          "Gemini is not configured. Deterministic case data remains available.",
      };
    case "FAILED_TIMEOUT":
      return { title: "Analysis timed out", detail: "Retry is available." };
    case "FAILED_NETWORK":
      return { title: "Provider unavailable", detail: "Retry is available." };
    case "FAILED_QUOTA":
      return {
        title: "Analysis quota unavailable",
        detail: "Try again later.",
      };
    case "FAILED_MALFORMED_OUTPUT":
      return {
        title: "Malformed analysis output",
        detail: "No analysis was retained.",
      };
    case "FAILED_SCHEMA":
      return {
        title: "Analysis schema failure",
        detail: "No analysis was retained.",
      };
    default:
      return null;
  }
}

function formatTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}
