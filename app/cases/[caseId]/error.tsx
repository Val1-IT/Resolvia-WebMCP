"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";

export default function CaseError({ reset }: { reset: () => void }) {
  return (
    <main className="state-page">
      <div className="state-card">
        <TriangleAlert aria-hidden="true" size={28} />
        <span className="panel-kicker">Local workspace error</span>
        <h1>The case snapshot could not be read.</h1>
        <p>No case state was changed. Retry after checking the local data file.</p>
        <button type="button" onClick={reset}>
          <RotateCcw aria-hidden="true" size={16} /> Retry
        </button>
      </div>
    </main>
  );
}
