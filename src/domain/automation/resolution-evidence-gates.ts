import type { EvidenceRecord } from "@/src/domain/evidence/model";
import type { ResolutionCaseBundle } from "@/src/domain/store/model";
import type { ProviderTransactionRecord } from "@/src/domain/transactions/model";

/**
 * Shared deterministic evidence gates used by automated resolution policy
 * and the Resolution Readiness projection. Do not invent a second policy.
 */

export function hasContradictionBlockingResolution(
  bundle: ResolutionCaseBundle,
): boolean {
  return bundle.claims.some(
    (claim) =>
      claim.status === "CONTRADICTED" || claim.status === "PARTIALLY_VERIFIED",
  );
}

export function findSucceededProviderOutcome(
  bundle: ResolutionCaseBundle,
):
  | {
      transaction: ProviderTransactionRecord;
      evidence: EvidenceRecord;
    }
  | undefined {
  const transaction = bundle.providerTransactions.find((candidate) => {
    if (
      candidate.caseId !== bundle.caseRecord.id ||
      candidate.status !== "SUCCEEDED"
    ) {
      return false;
    }
    const evidence = bundle.evidence.find(
      (row) => row.id === candidate.evidenceId,
    );
    return (
      evidence?.caseId === bundle.caseRecord.id &&
      evidence.sourceProvider === candidate.provider &&
      (evidence.verificationLevel === "PROVIDER_VERIFIED" ||
        evidence.verificationLevel === "DEMO_PROVIDER_VERIFIED")
    );
  });
  if (!transaction) return undefined;
  const evidence = bundle.evidence.find(
    (row) => row.id === transaction.evidenceId,
  );
  if (!evidence) return undefined;
  return { transaction, evidence };
}

export function findConfirmedCustomerReceipt(
  bundle: ResolutionCaseBundle,
): EvidenceRecord | undefined {
  return bundle.evidence.find(
    (evidence) =>
      evidence.caseId === bundle.caseRecord.id &&
      evidence.type === "PARTNER_RESPONSE" &&
      evidence.verificationLevel === "PARTNER_VERIFIED" &&
      evidence.metadata.requestedEvidenceType === "CUSTOMER_RECEIPT" &&
      evidence.metadata.responseStatus === "CONFIRMED",
  );
}
