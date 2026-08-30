import { Check, CircleHelp, LockKeyhole, Search } from "lucide-react";

import type { CaseWorkspaceViewModel } from "@/src/ui/case-workspace/model";

const iconByStatus = {
  AUTHENTICATED_CLAIM: LockKeyhole,
  VERIFIED: Check,
  UNVERIFIED: Search,
  UNKNOWN: CircleHelp,
} as const;

export function CaseJourney({
  journey,
}: {
  journey: CaseWorkspaceViewModel["journey"];
}) {
  return (
    <section className="panel journey-panel" aria-labelledby="journey-title">
      <div className="section-heading">
        <div>
          <span className="panel-kicker">Evidence progression</span>
          <h2 id="journey-title">Case journey</h2>
        </div>
        <span className="live-marker">LIVE CASE</span>
      </div>
      <ol className="journey-list">
        {journey.map((step, index) => {
          const Icon = iconByStatus[step.status];
          return (
            <li key={step.id} className={`journey-step status-${step.status.toLowerCase()}`}>
              <div className="step-rail" aria-hidden="true">
                <span className="step-number">{String(index + 1).padStart(2, "0")}</span>
                <span className="step-icon"><Icon size={17} /></span>
              </div>
              <div className="step-content">
                <div className="step-title-row">
                  <h3>{step.label}</h3>
                  <span className="step-status">{step.status.replaceAll("_", " ")}</span>
                </div>
                <p>{step.detail}</p>
                {step.projectionOnly ? (
                  <span className="projection-label">PROJECTION ONLY</span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
