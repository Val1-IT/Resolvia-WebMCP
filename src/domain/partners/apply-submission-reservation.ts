import {
  PartnerSubmissionReservationSchema,
} from "@/src/domain/partners/model";
import type {
  CreatePartnerRequestResult,
  ResolutionSnapshot,
} from "@/src/domain/store/model";

const RESERVATION_MS = 5 * 60 * 1000;

export type ApplyPartnerSubmissionReservationResult = {
  result: CreatePartnerRequestResult;
  snapshot: ResolutionSnapshot;
};

export function applyPartnerSubmissionReservation(
  stored: ResolutionSnapshot,
  input: unknown,
): ApplyPartnerSubmissionReservationResult {
  const parsed = PartnerSubmissionReservationSchema.safeParse(input);
  if (!parsed.success) return unchanged(stored, "CASE_INTEGRITY_ERROR");
  const mutation = parsed.data;
  const request = (stored.partnerRequests ?? []).find(
    (record) => record.id === mutation.requestId,
  );
  const receiptIndex = (stored.partnerTokenReceipts ?? []).findIndex(
    (record) => record.digest === mutation.tokenDigest,
  );
  const receipt = receiptIndex < 0 ? undefined : stored.partnerTokenReceipts?.[receiptIndex];
  const storedCase = request
    ? stored.cases.find((record) => record.id === request.caseId)
    : undefined;
  const now = new Date(mutation.now);
  if (
    !request ||
    !receipt ||
    !storedCase ||
    storedCase.version !== mutation.expectedCaseVersion ||
    request.caseId !== receipt.caseId ||
    receipt.requestId !== request.id ||
    !Number.isFinite(now.valueOf()) ||
    now.valueOf() >= new Date(receipt.expiresAt).valueOf()
  ) {
    return unchanged(stored, "CASE_INTEGRITY_ERROR");
  }
  if (
    (receipt.state === "RESERVED" || receipt.state === "PUBLISHED") &&
    receipt.submissionEventId === mutation.submissionEventId
  ) {
    return { result: "COMMITTED", snapshot: stored };
  }
  if (receipt.state !== "OPEN" && receipt.state !== "FAILED_RETRYABLE") return unchanged(stored, "CASE_INTEGRITY_ERROR");

  const reserved = {
    ...receipt,
    state: "RESERVED" as const,
    submissionEventId: mutation.submissionEventId,
    leaseUntil: new Date(now.valueOf() + RESERVATION_MS).toISOString(),
  };
  return {
    result: "COMMITTED",
    snapshot: {
      ...stored,
      partnerTokenReceipts: (stored.partnerTokenReceipts ?? []).map(
        (record, index) => (index === receiptIndex ? reserved : record),
      ),
    },
  };
}

function unchanged(
  snapshot: ResolutionSnapshot,
  result: Exclude<CreatePartnerRequestResult, "COMMITTED">,
): ApplyPartnerSubmissionReservationResult {
  return { result, snapshot };
}