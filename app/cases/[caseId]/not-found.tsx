import { SearchX } from "lucide-react";
import Link from "next/link";

export default function CaseNotFound() {
  return (
    <main className="state-page">
      <div className="state-card">
        <SearchX aria-hidden="true" size={28} />
        <span className="panel-kicker">Case not found</span>
        <h1>No matching resolution case exists.</h1>
        <p>Try the deterministic demo workspace at RV-1028.</p>
        <Link href="/cases/RV-1028">Open RV-1028</Link>
      </div>
    </main>
  );
}
