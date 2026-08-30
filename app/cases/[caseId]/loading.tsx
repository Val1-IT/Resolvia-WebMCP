export default function CaseLoading() {
  return (
    <main className="state-page" aria-busy="true">
      <div className="state-card loading-card">
        <span className="loading-pulse" />
        <p>Reconstructing the evidence trail…</p>
      </div>
    </main>
  );
}
