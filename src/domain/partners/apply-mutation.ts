import {
  PartnerRequestMutationSchema,
  type PartnerRequestMutation,
} from "@/src/domain/partners/model";
import type {
  CreatePartnerRequestResult,
  ResolutionSnapshot,
} from "@/src/domain/store/model";

export type ApplyPartnerRequestMutationResult = {
  result: CreatePartnerRequestResult;
  snapshot: ResolutionSnapshot;
};

export function applyPartnerRequestMutation(
  stored: ResolutionSnapshot,
  input: unknown,
): ApplyPartnerRequestMutationResult {
  const parsed = PartnerRequestMutationSchema.safeParse(input);
  if (!parsed.success) return unchanged(stored, "CASE_INTEGRITY_ERROR");

  const mutation = parsed.data;
  const storedCase = stored.cases.find(
    (candidate) => candidate.id === mutation.request.caseId,
  );
  if (!storedCase) return unchanged(stored, "CASE_INTEGRITY_ERROR");
  if (mutation.expectedCaseVersion !== storedCase.version) {
    return unchanged(stored, "VERSION_CONFLICT");
  }
  if (!requestAndReceiptAreConsistent(mutation, storedCase.displayId)) {
    return unchanged(stored, "CASE_INTEGRITY_ERROR");
  }
  if (
    (stored.partnerRequests ?? []).some((record) => record.id === mutation.request.id) ||
    (stored.partnerTokenReceipts ?? []).some(
      (record) =>
        record.digest === mutation.tokenReceipt.digest ||
        record.requestId === mutation.tokenReceipt.requestId,
    )
  ) {
    return unchanged(stored, "CASE_INTEGRITY_ERROR");
  }

  return {
    result: "COMMITTED",
    snapshot: {
      ...stored,
      partnerRequests: [...(stored.partnerRequests ?? []), mutation.request],
      partnerTokenReceipts: [
        ...(stored.partnerTokenReceipts ?? []),
        mutation.tokenReceipt,
      ],
    },
  };
}

function requestAndReceiptAreConsistent(
  mutation: PartnerRequestMutation,
  caseDisplayId: string,
): boolean {
  const { request, tokenReceipt } = mutation;
  return (
    request.caseId === tokenReceipt.caseId &&
    request.id === tokenReceipt.requestId &&
    request.minimumContext.caseDisplayId === caseDisplayId &&
    request.expiresAt === tokenReceipt.expiresAt &&
    request.state === "OPEN" &&
    tokenReceipt.state === "OPEN" &&
    tokenReceipt.leaseUntil === undefined &&
    new Date(request.expiresAt).valueOf() > new Date(request.createdAt).valueOf()
  );
}

function unchanged(
  snapshot: ResolutionSnapshot,
  result: Exclude<CreatePartnerRequestResult, "COMMITTED">,
): ApplyPartnerRequestMutationResult {
  return { result, snapshot };
}