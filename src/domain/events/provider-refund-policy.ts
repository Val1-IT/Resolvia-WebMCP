import { z } from "zod";

import { AuditRecordSchema } from "@/src/domain/audit/model";
import { ClaimRecordSchema } from "@/src/domain/claims/model";
import { EvidenceRecordSchema } from "@/src/domain/evidence/model";
import type { ResolutionEvent } from "@/src/domain/events/model";
import {
  CaseMutationSchema,
  type CaseMutation,
  type ResolutionCaseBundle,
} from "@/src/domain/store/model";
import { ProviderTransactionRecordSchema } from "@/src/domain/transactions/model";

const ProviderRefundPayloadSchema = z
  .object({
    providerEventId: z.string().min(1).max(255),
    providerEventType: z.enum([
      "refund.created",
      "refund.updated",
      "refund.failed",
      "refund.observed",
    ]),
    providerObjectId: z.string().min(1).max(255),
    providerObjectType: z.literal("refund"),
    providerObjectCreatedAt: z.string().datetime({ offset: true }),
    providerStatus: z.enum([
      "pending",
      "requires_action",
      "succeeded",
      "failed",
      "canceled",
    ]),
  })
  .strict();

export type ProviderRefundPolicyResult =
  | { ok: true; mutation: CaseMutation }
  | { ok: false; error: "INVALID_PROVIDER_EVENT" };

export function planProviderRefundMutation(
  bundle: ResolutionCaseBundle,
  event: ResolutionEvent,
  now: () => string,
): ProviderRefundPolicyResult {
  const payload = ProviderRefundPayloadSchema.safeParse(event.payload);
  const provider = event.source.provider;
  if (
    !payload.success ||
    event.caseId !== bundle.caseRecord.id ||
    event.source.category !== "PROVIDER" ||
    event.source.runtimeMode !== "TEST" ||
    !["stripe", "resolvia_demo_provider"].includes(provider ?? "") ||
    !providerSupportsEventType(provider, payload.data.providerEventType) ||
    event.id !== `${event.source.provider}:${payload.data.providerEventId}` ||
    event.correlationId !== payload.data.providerEventId ||
    !eventKindMatchesType(event, payload.data.providerEventType) ||
    (payload.data.providerEventType === "refund.failed" &&
      payload.data.providerStatus !== "failed")
  ) {
    return { ok: false, error: "INVALID_PROVIDER_EVENT" };
  }

  const committedAt = now();
  const isDemoProvider = provider === "resolvia_demo_provider";
  const providerName = isDemoProvider ? "RESOLVIA DEMO PROVIDER" : "Stripe";
  const providerPartyId = `party:${provider}:${event.caseId}`;
  const existingProviderParty = bundle.caseRecord.parties.find(
    (party) => party.id === providerPartyId,
  );
  if (
    existingProviderParty &&
    (existingProviderParty.caseId !== event.caseId ||
      existingProviderParty.kind !== "PROVIDER")
  ) {
    return { ok: false, error: "INVALID_PROVIDER_EVENT" };
  }

  const evidenceId = `evidence:${event.id}`;
  const transactionId = `transaction:${provider}:${payload.data.providerObjectId}`;
  const existenceClaimId = `claim:${provider}-refund-exists:${payload.data.providerObjectId}`;
  const statusClaimId = `claim:${provider}-refund-status:${payload.data.providerObjectId}`;
  const relationship = {
    evidenceId,
    kind: "SUPPORTS_PROPOSITION" as const,
  };

  const existenceClaim = ClaimRecordSchema.parse({
    id: existenceClaimId,
    caseId: event.caseId,
    statement: `${providerName} refund transaction ${payload.data.providerObjectId} exists.`,
    claimantPartyId: providerPartyId,
    sourceEventId: event.id,
    status: "SUPPORTED",
    evidenceRelationships: [relationship],
    createdAt: committedAt,
    updatedAt: committedAt,
  });
  const statusClaim = ClaimRecordSchema.parse({
    id: statusClaimId,
    caseId: event.caseId,
    statement: `${providerName} reports refund ${payload.data.providerObjectId} status as ${payload.data.providerStatus}.`,
    claimantPartyId: providerPartyId,
    sourceEventId: event.id,
    status: "SUPPORTED",
    evidenceRelationships: [relationship],
    createdAt: committedAt,
    updatedAt: committedAt,
  });
  const evidence = EvidenceRecordSchema.parse({
    id: evidenceId,
    caseId: event.caseId,
    type: "PROVIDER_TRANSACTION",
    source: `${providerName} signed Test Mode provider event`,
    sourceProvider: provider,
    externalReference: payload.data.providerObjectId,
    contentSummary: `${providerName} Test Mode reports refund ${payload.data.providerObjectId} exists with processor status ${payload.data.providerStatus}.`,
    verificationLevel: isDemoProvider ? "DEMO_PROVIDER_VERIFIED" : "PROVIDER_VERIFIED",
    retrievedAt: committedAt,
    createdAt: committedAt,
    metadata: {
      providerEventId: payload.data.providerEventId,
      providerEventType: payload.data.providerEventType,
      providerStatus: payload.data.providerStatus,
    },
    relatedClaimIds: [existenceClaimId, statusClaimId],
  });
  const transaction = ProviderTransactionRecordSchema.parse({
    id: transactionId,
    caseId: event.caseId,
    provider,
    providerObjectId: payload.data.providerObjectId,
    kind: "REFUND",
    status: mapTransactionStatus(payload.data.providerStatus),
    evidenceId,
    observedAt: event.occurredAt,
    createdAt: committedAt,
  });

  const guidance = guidanceFor(payload.data.providerStatus, providerName);
  const caseRecord = {
    ...bundle.caseRecord,
    version: bundle.caseRecord.version + 1,
    parties: existingProviderParty
      ? bundle.caseRecord.parties
      : [
          ...bundle.caseRecord.parties,
          {
            id: providerPartyId,
            caseId: event.caseId,
            kind: "PROVIDER" as const,
            name: `${providerName} (Test Mode)`,
          },
        ],
    currentBlocker: guidance.currentBlocker,
    nextBestAction: guidance.nextBestAction,
    updatedAt: committedAt,
  };
  const audit = AuditRecordSchema.parse({
    id: `audit:${event.id}`,
    caseId: event.caseId,
    timestamp: committedAt,
    triggeringEventId: event.id,
    ruleId: "PROVIDER_REFUND_EVIDENCE_APPLIED",
    actor: { category: "PROVIDER", id: provider },
    previousState: bundle.caseRecord.state,
    resultingState: bundle.caseRecord.state,
    reason:
      `${providerName} authenticated Test Mode evidence established refund existence and processor status without establishing customer receipt.`,
    evidenceIds: [evidenceId],
    changedFields: [
      "version",
      "parties",
      "currentBlocker",
      "nextBestAction",
      "updatedAt",
      "events",
      "evidence",
      "claims",
      "providerTransactions",
    ],
  });

  const mutation = CaseMutationSchema.safeParse({
    caseRecord,
    expectedCaseVersion: bundle.caseRecord.version,
    eventsToAppend: [event],
    evidenceToAdd: [evidence],
    claimsToSave: [existenceClaim, statusClaim],
    auditRecordsToAppend: [audit],
    transactionsToAdd: [transaction],
  });
  return mutation.success
    ? { ok: true, mutation: mutation.data }
    : { ok: false, error: "INVALID_PROVIDER_EVENT" };
}

function providerSupportsEventType(
  provider: string | undefined,
  eventType: z.infer<typeof ProviderRefundPayloadSchema>["providerEventType"],
): boolean {
  return provider === "resolvia_demo_provider"
    ? eventType === "refund.observed" || eventType === "refund.updated"
    : eventType !== "refund.observed";
}

function eventKindMatchesType(
  event: ResolutionEvent,
  eventType: z.infer<typeof ProviderRefundPayloadSchema>["providerEventType"],
): boolean {
  return eventType === "refund.created" || eventType === "refund.observed"
    ? event.kind === "PROVIDER_REFUND_OBSERVED"
    : event.kind === "PROVIDER_REFUND_STATUS_UPDATED";
}

function mapTransactionStatus(
  providerStatus: z.infer<typeof ProviderRefundPayloadSchema>["providerStatus"],
) {
  switch (providerStatus) {
    case "pending":
    case "requires_action":
      return "PENDING" as const;
    case "succeeded":
      return "SUCCEEDED" as const;
    case "failed":
      return "FAILED" as const;
    case "canceled":
      return "CANCELED" as const;
  }
}

function guidanceFor(
  providerStatus: z.infer<typeof ProviderRefundPayloadSchema>["providerStatus"],
  providerName: string,
): { currentBlocker: string; nextBestAction: string } {
  if (providerStatus === "succeeded") {
    return {
      currentBlocker:
        `${providerName} reports the refund succeeded, but customer receipt remains unverified.`,
      nextBestAction:
        "Obtain independent settlement or customer receipt evidence.",
    };
  }
  if (providerStatus === "failed" || providerStatus === "canceled") {
    return {
      currentBlocker: `${providerName} reports the refund ${providerStatus}; customer receipt remains unverified.`,
      nextBestAction:
        "Review the processor outcome and prepare a safe merchant follow-up.",
    };
  }
  return {
    currentBlocker:
      `${providerName} verifies the refund exists, but settlement and customer receipt remain unverified.`,
    nextBestAction:
      "Monitor processor status and obtain independent customer receipt evidence.",
  };
}
