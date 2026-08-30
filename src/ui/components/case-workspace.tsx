import { Braces, ShieldAlert } from "lucide-react";
import Link from "next/link";

import type { CaseWorkspaceViewModel } from "@/src/ui/case-workspace/model";
import { CaseHeader } from "@/src/ui/components/case-header";
import { CaseJourney } from "@/src/ui/components/case-journey";
import { ClaimsEvidence } from "@/src/ui/components/claims-evidence";
import { ResolutionAnalysis } from "@/src/ui/components/resolution-analysis";
import { ResolutionStatus } from "@/src/ui/components/resolution-status";
import { Timeline } from "@/src/ui/components/timeline";
import { TruthGraph } from "@/src/ui/components/truth-graph";
import { SignOutControl } from "@/src/ui/components/sign-out-control";
import { WebmcpCollaborationPanel } from "@/src/ui/components/webmcp-collaboration-panel";

export function CaseWorkspace({
  viewModel,
  runtimeMode = "LOCAL",
}: {
  viewModel: CaseWorkspaceViewModel;
  runtimeMode?: "LOCAL" | "CONNECTED";
}) {
  return (
    <main className="workspace-shell">
      <nav className="topbar" aria-label="Resolvia workspace">
        <Link className="brand" href="/cases/RV-1028" aria-label="Resolvia home">
          <span className="brand-mark"><Braces aria-hidden="true" size={18} /></span>
          <span>RESOLVIA</span>
        </Link>
        <div className="topbar-context">
          <span>THE TASKMASTER</span>
          <span className="topbar-divider" />
          <span>{runtimeMode === "CONNECTED" ? "CONNECTED PHASE 6 - PRIVATE EVENT BACKBONE" : "LOCAL PHASE 5 - STRIPE TEST MODE"}</span>
          {runtimeMode === "CONNECTED" ? <SignOutControl /> : null}
        </div>
      </nav>

      <div className="workspace-content">
        <CaseHeader viewModel={viewModel} runtimeMode={runtimeMode} />

        <div className="workspace-grid">
          <aside className="left-rail">
            <section className="panel case-facts" aria-labelledby="case-facts-title">
              <span className="panel-kicker">Case context</span>
              <h2 id="case-facts-title">Parties</h2>
              <dl>
                {viewModel.parties.map((party) => (
                  <div key={party.id}>
                    <dt>{party.kind}</dt>
                    <dd>{party.name}</dd>
                  </div>
                ))}
                <div>
                  <dt>ISSUE</dt>
                  <dd>{viewModel.issueType.replaceAll("_", " ")}</dd>
                </div>
              </dl>
            </section>

            <ClaimsEvidence claims={viewModel.claims} evidence={viewModel.evidence} />
          </aside>

          <div className="center-column">
            <CaseJourney journey={viewModel.journey} />
            {viewModel.verificationGap ? (
              <section className="verification-gap" aria-label="Verification gap">
                <div className="gap-icon"><ShieldAlert aria-hidden="true" size={20} /></div>
                <div>
                  <span>VERIFICATION GAP</span>
                  <h2>{viewModel.verificationGap.title}</h2>
                  <p>{viewModel.verificationGap.explanation}</p>
                  <strong>Expected: {viewModel.verificationGap.expectedEvidence}</strong>
                </div>
              </section>
            ) : null}
            <TruthGraph graph={viewModel.truthGraph} />
            <WebmcpCollaborationPanel
              caseId={viewModel.caseId}
              displayId={viewModel.displayId}
              initialReadiness={viewModel.resolutionReadiness}
            />
          </div>

          <aside className="right-rail">
            <ResolutionAnalysis viewModel={viewModel} />
            <ResolutionStatus viewModel={viewModel} />
            <Timeline viewModel={viewModel} />
          </aside>
        </div>
      </div>
    </main>
  );
}
