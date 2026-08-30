import type { ResolutionStore } from "@/src/application/ports/resolution-store";
import {
  ResolutionEventCanonicalizationError,
  resolutionEventDigest,
} from "@/src/domain/events/canonical";
import { ResolutionEventSchema, type ResolutionEvent } from "@/src/domain/events/model";
import { planPartnerEvidenceMutation } from "@/src/domain/partners/partner-evidence-policy";
import { attachAutomationOutbox } from "@/src/domain/automation/outbox-policy";

export type ProcessPartnerEventResult =
  | { kind: "COMMITTED"; caseVersion: number }
  | { kind: "DUPLICATE_EVENT" | "CASE_NOT_FOUND" | "CASE_INTEGRITY_ERROR" | "VERSION_CONFLICT" };

export async function processPartnerEvent(
  store: ResolutionStore,
  input: ResolutionEvent,
  now: () => string,
): Promise<ProcessPartnerEventResult> {
  const parsed = ResolutionEventSchema.safeParse(input);
  if (!parsed.success) return { kind: "CASE_INTEGRITY_ERROR" };
  const event = parsed.data;
  const bundle = await store.loadCaseBundle(event.caseId);
  if (!bundle) return { kind: "CASE_NOT_FOUND" };
  const existing = bundle.events.find((record) => record.id === event.id);
  if (existing) return duplicateOrIntegrity(existing, event);

  const planned = planPartnerEvidenceMutation(bundle, event, now);
  if (!planned.ok) return { kind: "CASE_INTEGRITY_ERROR" };
  const mutation = attachAutomationOutbox(planned.mutation, now());
  const result = await store.commitCaseMutation(mutation);
  if (result === "COMMITTED") return { kind: "COMMITTED", caseVersion: mutation.caseRecord.version };
  if (result === "DUPLICATE_EVENT") return { kind: "DUPLICATE_EVENT" };
  if (result === "VERSION_CONFLICT") {
    const refreshed = await store.loadCaseBundle(event.caseId);
    const concurrent = refreshed?.events.find((record) => record.id === event.id);
    return concurrent ? duplicateOrIntegrity(concurrent, event) : { kind: "VERSION_CONFLICT" };
  }
  return { kind: "CASE_INTEGRITY_ERROR" };
}

function duplicateOrIntegrity(
  existing: ResolutionEvent,
  incoming: ResolutionEvent,
): { kind: "DUPLICATE_EVENT" } | { kind: "CASE_INTEGRITY_ERROR" } {
  try {
    return resolutionEventDigest(existing) === resolutionEventDigest(incoming)
      ? { kind: "DUPLICATE_EVENT" }
      : { kind: "CASE_INTEGRITY_ERROR" };
  } catch (error) {
    if (error instanceof ResolutionEventCanonicalizationError) {
      return { kind: "CASE_INTEGRITY_ERROR" };
    }
    throw error;
  }
}
