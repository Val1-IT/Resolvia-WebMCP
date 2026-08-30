import { AlertTriangle, ArrowRight, Radar } from "lucide-react";

import type { CaseWorkspaceViewModel } from "@/src/ui/case-workspace/model";

export function ResolutionStatus({
  viewModel,
}: {
  viewModel: CaseWorkspaceViewModel;
}) {
  return (
    <section className="status-stack" aria-labelledby="resolution-status-title">
      <div className="panel status-panel">
        <span className="panel-kicker">DETERMINISTIC CASE STATUS</span>
        <h2 id="resolution-status-title">
          <Radar aria-hidden="true" size={19} />
          {viewModel.currentState}
        </h2>
        <span className="deterministic-label">DETERMINISTIC FACT</span>
        <div className="signal-line" aria-hidden="true">
          <span />
        </div>
        <p>Resolvia is actively assessing what can be proven from available records.</p>
      </div>

      <div className="panel blocker-panel">
        <span className="panel-kicker">Current blocker</span>
        <span className="deterministic-label">DETERMINISTIC FACT</span>
        <h3>
          <AlertTriangle aria-hidden="true" size={17} /> Verification needed
        </h3>
        <p>{viewModel.currentBlocker}</p>
      </div>

      <div className="panel next-action-panel">
        <span className="panel-kicker">Next best action</span>
        <span className="deterministic-label">DETERMINISTIC FACT</span>
        <p>{viewModel.nextBestAction}</p>
        <div className="action-footnote">
          <span>Safe local recommendation</span>
          <ArrowRight aria-hidden="true" size={16} />
        </div>
      </div>
    </section>
  );
}
