import { Clock3, Fingerprint } from "lucide-react";

import type { CaseWorkspaceViewModel } from "@/src/ui/case-workspace/model";

export function Timeline({ viewModel }: { viewModel: CaseWorkspaceViewModel }) {
  return (
    <section className="panel timeline-panel" aria-labelledby="timeline-title">
      <div className="section-heading compact-heading">
        <div>
          <span className="panel-kicker">Immutable history</span>
          <h2 id="timeline-title">Timeline &amp; audit</h2>
        </div>
        <Clock3 aria-hidden="true" size={20} />
      </div>

      <ol className="timeline-list">
        {viewModel.timeline.map((entry) => (
          <li key={entry.id}>
            <time dateTime={entry.timestamp}>{formatUtc(entry.timestamp)}</time>
            <strong>{entry.kind.replaceAll("_", " ")}</strong>
            <span>{entry.source}</span>
          </li>
        ))}
      </ol>

      <div className="audit-list">
        {viewModel.auditTrail.map((audit) => (
          <article key={audit.id} className="audit-entry">
            <Fingerprint aria-hidden="true" size={16} />
            <div>
              <p>{audit.explanation}</p>
              <span>
                Triggered by {audit.triggeringEventId} · Rule {audit.ruleId}
              </span>
            </div>
          </article>
        ))}
      {viewModel.historyPagination.totalPages > 1 ? (
        <nav className="history-pagination" aria-label="History pages">
          {viewModel.historyPagination.hasPrevious ? (
            <a href={`?historyPage=${viewModel.historyPagination.page - 1}`}>Newer history</a>
          ) : (
            <span />
          )}
          <span>Page {viewModel.historyPagination.page} of {viewModel.historyPagination.totalPages}</span>
          {viewModel.historyPagination.hasNext ? (
            <a href={`?historyPage=${viewModel.historyPagination.page + 1}`}>Older history</a>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
      </div>
    </section>
  );
}

function formatUtc(timestamp: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hour12: false,
  }).format(new Date(timestamp));
}
