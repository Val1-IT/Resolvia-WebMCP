import type { DocumentData } from "@google-cloud/firestore";

import {
  ResolutionEventCanonicalizationError,
  resolutionEventDigest,
} from "@/src/domain/events/canonical";
import type { CaseMutation } from "@/src/domain/store/model";

export function classifyEventReceipts(
  events: CaseMutation["eventsToAppend"],
  receipts: Array<{
    exists: boolean;
    data(): DocumentData | undefined;
  }>,
): "DUPLICATE_EVENT" | "CASE_INTEGRITY_ERROR" | null {
  let duplicate = false;
  for (const [index, receipt] of receipts.entries()) {
    if (!receipt.exists) continue;
    const event = events[index];
    const stored = receipt.data();
    if (!event || stored?.caseId !== event.caseId) {
      return "CASE_INTEGRITY_ERROR";
    }
    let eventDigest: string;
    try {
      eventDigest = resolutionEventDigest(event);
    } catch (error) {
      if (error instanceof ResolutionEventCanonicalizationError) {
        return "CASE_INTEGRITY_ERROR";
      }
      throw error;
    }
    if (stored?.payloadDigest !== eventDigest) {
      return "CASE_INTEGRITY_ERROR";
    }
    duplicate = true;
  }
  return duplicate ? "DUPLICATE_EVENT" : null;
}