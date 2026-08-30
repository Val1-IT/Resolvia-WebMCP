import type { CaseMutation } from "@/src/domain/store/model";
import { AutomationRequestRecordSchema, type AutomationKind } from "@/src/domain/automation/model";

const SAFE_INTERNAL_KINDS: readonly AutomationKind[] = [
  "RUN_AGENT_ANALYSIS",
  "RECALCULATE_GUIDANCE",
  "EVALUATE_RESOLUTION",
];

export function attachAutomationOutbox(
  mutation: CaseMutation,
  now: string,
): CaseMutation {
  const previousVersion = mutation.expectedCaseVersion;
  if (previousVersion === null || mutation.caseRecord.version !== previousVersion + 1) {
    return { ...mutation, automationRequestsToCreate: [], deadlinesToSave: [] };
  }

  const version = mutation.caseRecord.version;
  const requests = SAFE_INTERNAL_KINDS.map((kind) => {
    const automationKey = `${mutation.caseRecord.id}:v${version}:${kind}`;
    return AutomationRequestRecordSchema.parse({
      id: `automation:${automationKey}`,
      automationKey,
      caseId: mutation.caseRecord.id,
      basedOnCaseVersion: version,
      kind,
      state: "PENDING",
      retryCount: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    });
  });
  const dueAt = new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString();
  return {
    ...mutation,
    automationRequestsToCreate: requests,
    deadlinesToSave: [{
      id: `deadline:${mutation.caseRecord.id}:v${version}:PROVIDER_FOLLOW_UP`,
      caseId: mutation.caseRecord.id,
      basedOnCaseVersion: version,
      kind: "PROVIDER_FOLLOW_UP",
      dueAt,
      state: "OPEN",
      createdAt: now,
      updatedAt: now,
    }],
  };
}
