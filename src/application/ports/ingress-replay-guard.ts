export type IngressReplayClaim = {
  scope: "DEMO_PROVIDER";
  replayKey: string;
  payloadDigest: string;
  semanticId: string;
  leaseId: string;
  now: string;
  leaseUntil: string;
  expiresAt: string;
};

export type IngressReplayDecision =
  | { kind: "CLAIMED" }
  | { kind: "IN_PROGRESS" }
  | { kind: "DUPLICATE" };

export interface IngressReplayGuard {
  claim(input: IngressReplayClaim): Promise<IngressReplayDecision>;
  markPublished(input: IngressReplayClaim): Promise<void>;
  release(input: IngressReplayClaim): Promise<void>;
}
