import { createHash } from "node:crypto";

import type { ResolutionEventPublisher } from "@/src/application/ports/external-services";
import type { ResolutionStore } from "@/src/application/ports/resolution-store";
import { validatePartnerTokenAccess } from "@/src/domain/partners/policy";

export type PartnerResponse = {
  requestedEvidenceType: "SETTLEMENT_OCCURRED" | "CUSTOMER_RECEIPT";
  responseStatus: "CONFIRMED" | "NOT_CONFIRMED";
  responseReference: string;
  responseSummary: string;
};

type PreparePartnerResponseResult =
  | { kind: "PREPARED"; event: import("@/src/domain/events/model").ResolutionEvent; tokenDigest: string }
  | { kind: "ACCESS_UNAVAILABLE" | "STORE_REJECTED" };

export type SubmitPartnerResponseResult =
  | { kind: "PUBLISHED"; eventId: string }
  | { kind: "ACCESS_UNAVAILABLE" | "PUBLISH_UNCERTAIN" | "STORE_REJECTED" };

export async function preparePartnerResponse(input: {
  store: ResolutionStore;
  now: () => string;
  requestId: string;
  rawToken: string;
  response: PartnerResponse;
}): Promise<PreparePartnerResponseResult> {
  const access = await input.store.loadPartnerRequest(input.requestId);
  if (!access) return { kind: "ACCESS_UNAVAILABLE" };
  const accessResult = validatePartnerTokenAccess({
    ...access,
    rawToken: input.rawToken,
    caseId: access.request.caseId,
    now: input.now(),
    purpose: "IDEMPOTENT_SUBMISSION",
  });
  if (!accessResult.ok || access.request.requestedEvidenceType !== input.response.requestedEvidenceType) {
    return { kind: "ACCESS_UNAVAILABLE" };
  }

  const responseDigest = createHash("sha256")
    .update(JSON.stringify(input.response), "utf8")
    .digest("base64url");
  const eventId = `partner:${access.request.id}:${responseDigest}`;
  const caseBundle = await input.store.loadCaseBundle(access.request.caseId);
  if (!caseBundle) return { kind: "STORE_REJECTED" };
  const timestamp = input.now();
  const reserved = await input.store.reservePartnerSubmission({
    requestId: access.request.id,
    tokenDigest: access.tokenReceipt.digest,
    submissionEventId: eventId,
    expectedCaseVersion: caseBundle.caseRecord.version,
    now: timestamp,
  });
  if (reserved !== "COMMITTED") return { kind: "STORE_REJECTED" };

  const event = {
    id: eventId,
    caseId: access.request.caseId,
    kind: "PARTNER_EVIDENCE_SUBMITTED" as const,
    source: {
      category: "PARTNER" as const,
      runtimeMode: "CONNECTED" as const,
      provider: "resolvia_demo_partner",
      actorId: "resolvia-demo-partner",
    },
    occurredAt: timestamp,
    receivedAt: timestamp,
    correlationId: access.request.id,
    payload: {
      partnerRequestId: access.request.id,
      ...input.response,
    },
  };
  const published = await input.store.markPartnerSubmissionPublished({
    requestId: access.request.id,
    tokenDigest: access.tokenReceipt.digest,
    submissionEventId: eventId,
    now: timestamp,
  });
  if (published !== "COMMITTED") return { kind: "STORE_REJECTED" };
  return { kind: "PREPARED", event, tokenDigest: access.tokenReceipt.digest };
}

export async function submitPartnerResponse(input: {
  store: ResolutionStore;
  publisher: ResolutionEventPublisher;
  now: () => string;
  requestId: string;
  rawToken: string;
  response: PartnerResponse;
}): Promise<SubmitPartnerResponseResult> {
  const prepared = await preparePartnerResponse(input);
  if (prepared.kind !== "PREPARED") return prepared;
  try {
    await input.publisher.publish(prepared.event);
  } catch {
    // A publish rejection does not prove that the broker rejected the message.
    // Keep the receipt PUBLISHED so an accepted delivery remains consumable.
    // A caller retry derives the same event ID and is semantically deduplicated.
    return { kind: "PUBLISH_UNCERTAIN" };
  }
  return { kind: "PUBLISHED", eventId: prepared.event.id };
}
