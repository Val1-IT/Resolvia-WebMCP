import { ArrowRight, CircleDashed, Network } from "lucide-react";

import type { TruthGraph as TruthGraphModel } from "@/src/domain/truth-graph/model";

export function TruthGraph({ graph }: { graph: TruthGraphModel }) {
  const visibleNodes = graph.nodes.filter((node) =>
    [
      "PARTY",
      "CLAIM",
      "EVIDENCE",
      "TRANSACTION",
      "VERIFICATION_GAP",
      "EXPECTED_EVIDENCE",
    ].includes(
      node.kind,
    ),
  );
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = graph.edges.filter(
    (edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to),
  );

  return (
    <section className="panel graph-panel" aria-labelledby="truth-graph-title">
      <div className="section-heading">
        <div>
          <span className="panel-kicker">Proposition map</span>
          <h2 id="truth-graph-title">Truth Graph</h2>
        </div>
        <Network aria-hidden="true" size={21} />
      </div>

      <div className="graph-stage">
        <div className="graph-nodes" role="list" aria-label="Truth Graph nodes">
          {visibleNodes.map((node) => (
            <article
              className={`graph-node graph-${node.kind.toLowerCase().replaceAll("_", "-")}`}
              key={node.id}
              role="listitem"
            >
              <div className="graph-node-type">
                {node.placeholder ? <CircleDashed aria-hidden="true" size={13} /> : null}
                {node.kind.replaceAll("_", " ")}
              </div>
              <h3>{node.label}</h3>
              {node.detail ? <p>{node.detail}</p> : null}
              {node.placeholder ? (
                <div className="derived-labels">
                  <span>DERIVED</span>
                  <span>NOT AUTHORITATIVE</span>
                </div>
              ) : (
                <span className="authoritative-label">DOMAIN RECORD</span>
              )}
            </article>
          ))}
        </div>
        <div className="graph-edges" aria-label="Truth Graph relationships">
          {visibleEdges.map((edge) => (
            <div className="graph-edge" key={edge.id}>
              <code>{edge.from}</code>
              <span>
                {edge.kind.replaceAll("_", " ")} <ArrowRight aria-hidden="true" size={13} />
              </span>
              <code>{edge.to}</code>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
