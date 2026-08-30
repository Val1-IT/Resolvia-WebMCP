import { createHash } from "node:crypto";

import type { ResolutionCase } from "@/src/domain/cases/model";
import {
  PartnerRequestRecordSchema,
  PartnerTokenReceiptSchema,
  type PartnerRequestRecord,
  type PartnerTokenReceipt,
} from "@/src/domain/partners/model";

const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,256}$/u;

export function createPartnerRequest(input: {
  caseRecord: ResolutionCase;
  requestId: string;
  rawToken: string;
  now: string;
}): { request: PartnerRequestRecord; tokenReceipt: PartnerTokenReceipt } {
  if (!TOKEN_PATTERN.test(input.rawToken)) {
    throw new Error("Partner token must be an opaque 256-bit value.");
  }
  const now = new Date(input.now);
  if (!Number.isFinite(now.valueOf())) {
    throw new Error("Partner request timestamp is invalid.");
  }
  const expiresAt = new Date(now.valueOf() + THIRTY_MINUTES_MS).toISOString();
  const request = PartnerRequestRecordSchema.parse({
    id: input.requestId,
    caseId: input.caseRecord.id,
    requestedEvidenceType: "CUSTOMER_RECEIPT",
    targetPartner: "RESOLVIA DEMO PARTNER",
    minimumContext: { caseDisplayId: input.caseRecord.displayId },
    createdAt: input.now,
    expiresAt,
    state: "OPEN",
  });
  const tokenReceipt = PartnerTokenReceiptSchema.parse({
    digest: `sha256:${createHash("sha256").update(input.rawToken, "utf8").digest("hex")}`,
    requestId: request.id,
    caseId: request.caseId,
    expiresAt,
    state: "OPEN",
  });
  return { request, tokenReceipt };
}
export function validatePartnerTokenAccess(input: {
  request: PartnerRequestRecord;
  tokenReceipt: PartnerTokenReceipt;
  rawToken: string;
  caseId: string;
  now: string;
  purpose?: "PORTAL_ACCESS" | "IDEMPOTENT_SUBMISSION";
}):
  | { ok: true }
  | {
      ok: false;
      reason: "INVALID_TOKEN" | "CASE_SCOPE_REJECTED" | "TOKEN_UNAVAILABLE" | "TOKEN_EXPIRED";
    } {
  const digest = `sha256:${createHash("sha256").update(input.rawToken, "utf8").digest("hex")}`;
  if (digest !== input.tokenReceipt.digest) return { ok: false, reason: "INVALID_TOKEN" };
  if (input.request.id !== input.tokenReceipt.requestId || input.request.caseId !== input.tokenReceipt.caseId || input.caseId !== input.request.caseId) {
    return { ok: false, reason: "CASE_SCOPE_REJECTED" };
  }
  const publishedRetry = input.purpose === "IDEMPOTENT_SUBMISSION" && input.tokenReceipt.state === "PUBLISHED";
  if (input.tokenReceipt.state !== "OPEN" && input.tokenReceipt.state !== "FAILED_RETRYABLE" && !publishedRetry) return { ok: false, reason: "TOKEN_UNAVAILABLE" };
  const now = new Date(input.now);
  if (!Number.isFinite(now.valueOf()) || now.valueOf() >= new Date(input.tokenReceipt.expiresAt).valueOf()) {
    return { ok: false, reason: "TOKEN_EXPIRED" };
  }
  return { ok: true };
}
export function portalContext(request: PartnerRequestRecord): {
  requestId: string;
  caseDisplayId: string;
  requestedEvidenceType: PartnerRequestRecord["requestedEvidenceType"];
  expiresAt: string;
} {
  return {
    requestId: request.id,
    caseDisplayId: request.minimumContext.caseDisplayId,
    requestedEvidenceType: request.requestedEvidenceType,
    expiresAt: request.expiresAt,
  };
}