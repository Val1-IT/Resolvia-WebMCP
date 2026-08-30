import { PartnerSubmissionReleaseSchema } from "@/src/domain/partners/model";
import type { CreatePartnerRequestResult, ResolutionSnapshot } from "@/src/domain/store/model";

export function applyPartnerSubmissionRelease(
  stored: ResolutionSnapshot,
  input: unknown,
): { result: CreatePartnerRequestResult; snapshot: ResolutionSnapshot } {
  const parsed = PartnerSubmissionReleaseSchema.safeParse(input);
  if (!parsed.success) return unchanged(stored, "CASE_INTEGRITY_ERROR");
  const mutation = parsed.data;
  const request = (stored.partnerRequests ?? []).find((record) => record.id === mutation.requestId);
  const index = (stored.partnerTokenReceipts ?? []).findIndex((record) => record.digest === mutation.tokenDigest);
  const receipt = index < 0 ? undefined : stored.partnerTokenReceipts?.[index];
  if (!request || !receipt || request.caseId !== receipt.caseId || receipt.requestId !== request.id || (receipt.state !== "RESERVED" && receipt.state !== "PUBLISHED") || receipt.submissionEventId !== mutation.submissionEventId) {
    return unchanged(stored, "CASE_INTEGRITY_ERROR");
  }
  return {
    result: "COMMITTED",
    snapshot: {
      ...stored,
      partnerTokenReceipts: (stored.partnerTokenReceipts ?? []).map((record, receiptIndex) => receiptIndex === index
        ? { ...record, state: "FAILED_RETRYABLE" as const, leaseUntil: undefined }
        : record),
    },
  };
}

function unchanged(snapshot: ResolutionSnapshot, result: Exclude<CreatePartnerRequestResult, "COMMITTED">) {
  return { result, snapshot };
}