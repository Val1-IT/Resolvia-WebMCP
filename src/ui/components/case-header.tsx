import { ArrowUpRight, CircleDotDashed } from "lucide-react";

import type { CaseWorkspaceViewModel } from "@/src/ui/case-workspace/model";

export function CaseHeader({ viewModel, runtimeMode = "LOCAL" }: { viewModel: CaseWorkspaceViewModel; runtimeMode?: "LOCAL" | "CONNECTED" }) {
  return (
    <header className="case-header">
      <div>
        <div className="eyebrow-row">
          <span className="eyebrow">Resolution workspace</span>
          <span className="local-mode">
            <CircleDotDashed aria-hidden="true" size={13} /> {runtimeMode === "CONNECTED" ? "Connected cloud" : "Local demo"}
          </span>
        </div>
        <h1>
          {viewModel.displayId} <span>{viewModel.title}</span>
        </h1>
        <p>{viewModel.summary}</p>
      </div>
      <div className="case-header-meta">
        <span>CASE VERSION</span>
        <strong>v{viewModel.version}</strong>
        <ArrowUpRight aria-hidden="true" size={18} />
      </div>
    </header>
  );
}
