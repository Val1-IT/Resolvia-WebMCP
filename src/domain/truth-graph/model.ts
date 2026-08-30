export type TruthGraphNodeKind =
  | "PARTY"
  | "CLAIM"
  | "EVIDENCE"
  | "EVENT"
  | "AUDIT"
  | "TRANSACTION"
  | "ACTION"
  | "VERIFICATION_GAP"
  | "EXPECTED_EVIDENCE";

export type TruthGraphEdgeKind =
  | "ASSERTED"
  | "AUTHENTICATES_ASSERTION"
  | "SUPPORTS_PROPOSITION"
  | "CONTRADICTS_PROPOSITION"
  | "EXPECTED_TO_VERIFY"
  | "CAUSED"
  | "RESULTED_IN";

export type TruthGraphNode = {
  id: string;
  kind: TruthGraphNodeKind;
  label: string;
  source: "DOMAIN" | "DERIVED";
  authoritative: boolean;
  placeholder: boolean;
  detail?: string;
};

export type TruthGraphEdge = {
  id: string;
  kind: TruthGraphEdgeKind;
  from: string;
  to: string;
};

export type TruthGraph = {
  nodes: TruthGraphNode[];
  edges: TruthGraphEdge[];
};
