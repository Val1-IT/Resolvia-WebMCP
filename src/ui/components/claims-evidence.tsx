import { Quote, ShieldCheck } from "lucide-react";

import type { CaseWorkspaceViewModel } from "@/src/ui/case-workspace/model";
import { ProvenanceBadge } from "@/src/ui/components/provenance-badge";

export function ClaimsEvidence({
  claims,
  evidence,
}: {
  claims: CaseWorkspaceViewModel["claims"];
  evidence: CaseWorkspaceViewModel["evidence"];
}) {
  return (
    <section className="panel claims-panel" aria-labelledby="claims-title">
      <div className="section-heading compact-heading">
        <div>
          <span className="panel-kicker">Claims ≠ facts</span>
          <h2 id="claims-title">Claims &amp; evidence</h2>
        </div>
        <Quote aria-hidden="true" size={20} />
      </div>

      {claims.map((claim) => (
        <article className="claim-card" key={claim.id}>
          <div className="claim-quote">“{claim.statement}”</div>
          <div className="claim-meta">
            <span>Asserted by {claim.claimant}</span>
            <strong>{claim.status.replaceAll("_", " ")}</strong>
          </div>
          <ul className="relationship-list">
            {claim.relationships.map((relationship) => (
              <li key={`${relationship.evidenceId}-${relationship.kind}`}>
                <ShieldCheck aria-hidden="true" size={14} />
                {relationship.kind.replaceAll("_", " ")}
              </li>
            ))}
          </ul>
        </article>
      ))}

      <div className="evidence-list">
        {evidence.map((record) => (
          <article className="evidence-card" key={record.id}>
            <div className="evidence-card-topline">
              <span>{record.type.replaceAll("_", " ")}</span>
              <ProvenanceBadge
                level={
                  record.verificationLevel as Parameters<
                    typeof ProvenanceBadge
                  >[0]["level"]
                }
              />
            </div>
            <h3>{record.source}</h3>
            <p>{record.contentSummary}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
