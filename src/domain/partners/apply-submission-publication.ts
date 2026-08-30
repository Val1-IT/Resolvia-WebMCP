import {
  PartnerSubmissionPublicationSchema,
} from "@/src/domain/partners/model";
import type {
  CreatePartnerRequestResult,
  ResolutionSnapshot,
} from "@/src/domain/store/model";

export function applyPartnerSubmissionPublication(
  stored: ResolutionSnapshot,
  input: unknown,
): { result: CreatePartnerRequestResult; snapshot: ResolutionSnapshot } {
  const parsed = PartnerSubmissionPublicationSchema.safeParse(input);
  if (!parsed.success) return unchanged(stored, "CASE_INTEGRITY_ERROR");
  const mutation = parsed.data;
  const request = (stored.partnerRequests ?? []).find(
    (record) => record.id === mutation.requestId,
  );
  const receiptIndex = (stored.partnerTokenReceipts ?? []).findIndex(
    (record) => record.digest === mutation.tokenDigest,
  );
  const receipt = receiptIndex < 0 ? undefined : stored.partnerTokenReceipts?.[receiptIndex];
  if (
    !request ||
    !receipt ||
    request.caseId !== receipt.caseId ||
    receipt.requestId !== request.id ||
    (receipt.state !== "RESERVED" && receipt.state !== "PUBLISHED") ||
    receipt.submissionEventId !== mutation.submissionEventId
  ) {
    return unchanged(stored, "CASE_INTEGRITY_ERROR");
  }
  return {
    result: "COMMITTED",
    snapshot: {
      ...stored,
      partnerTokenReceipts: (stored.partnerTokenReceipts ?? []).map(
        (record, index) => index === receiptIndex
          ? { ...record, state: "PUBLISHED" as const, publishedAt: mutation.now, leaseUntil: undefined }
          : record,
      ),
    },
  };
}

function unchanged(snapshot: ResolutionSnapshot, result: Exclude<CreatePartnerRequestResult, "COMMITTED">) {
  return { result, snapshot };
}