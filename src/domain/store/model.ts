import { z } from "zod";

import { AutomationRequestRecordSchema, DeadlineRecordSchema, type AutomationRequestRecord, type DeadlineRecord } from "@/src/domain/automation/model";
import { AgentRunRecordSchema, type AgentRunRecord } from "@/src/domain/agent/model";
import { AuditRecordSchema, type AuditRecord } from "@/src/domain/audit/model";
import { ResolutionCaseSchema, type ResolutionCase } from "@/src/domain/cases/model";
import { ClaimRecordSchema, type ClaimRecord } from "@/src/domain/claims/model";
import { EvidenceRecordSchema, type EvidenceRecord } from "@/src/domain/evidence/model";
import { ResolutionEventSchema, type ResolutionEvent } from "@/src/domain/events/model";
import { ProviderTransactionRecordSchema, type ProviderTransactionRecord } from "@/src/domain/transactions/model";
import {
  PartnerRequestRecordSchema,
  PartnerTokenReceiptSchema,
  type PartnerRequestRecord,
  type PartnerTokenReceipt,
} from "@/src/domain/partners/model";

export const ResolutionSnapshotSchema = z.object({
  cases: z.array(ResolutionCaseSchema),
  events: z.array(ResolutionEventSchema),
  evidence: z.array(EvidenceRecordSchema),
  claims: z.array(ClaimRecordSchema),
  auditRecords: z.array(AuditRecordSchema),
  providerTransactions: z.array(ProviderTransactionRecordSchema).default([]),
  agentRuns: z.array(AgentRunRecordSchema).default([]),
  partnerRequests: z.array(PartnerRequestRecordSchema).optional(),
  partnerTokenReceipts: z.array(PartnerTokenReceiptSchema).optional(),
  automationRequests: z.array(AutomationRequestRecordSchema).optional(),
  deadlines: z.array(DeadlineRecordSchema).optional(),
});

export const CaseMutationSchema = z.object({
  caseRecord: ResolutionCaseSchema,
  expectedCaseVersion: z.number().int().min(1).nullable(),
  eventsToAppend: z.array(ResolutionEventSchema),
  evidenceToAdd: z.array(EvidenceRecordSchema),
  claimsToSave: z.array(ClaimRecordSchema),
  auditRecordsToAppend: z.array(AuditRecordSchema),
  transactionsToAdd: z.array(ProviderTransactionRecordSchema),
  automationRequestsToCreate: z.array(AutomationRequestRecordSchema).optional(),
  deadlinesToSave: z.array(DeadlineRecordSchema).optional(),
});

export type ResolutionSnapshot = {
  cases: ResolutionCase[];
  events: ResolutionEvent[];
  evidence: EvidenceRecord[];
  claims: ClaimRecord[];
  auditRecords: AuditRecord[];
  providerTransactions: ProviderTransactionRecord[];
  agentRuns: AgentRunRecord[];
  partnerRequests?: PartnerRequestRecord[] | undefined;
  partnerTokenReceipts?: PartnerTokenReceipt[] | undefined;
  automationRequests?: AutomationRequestRecord[] | undefined;
  deadlines?: DeadlineRecord[] | undefined;
};
export type CaseMutation = z.infer<typeof CaseMutationSchema>;

export type ResolutionCaseBundle = {
  caseRecord: ResolutionSnapshot["cases"][number];
  events: ResolutionSnapshot["events"];
  evidence: ResolutionSnapshot["evidence"];
  claims: ResolutionSnapshot["claims"];
  auditRecords: ResolutionSnapshot["auditRecords"];
  providerTransactions: ResolutionSnapshot["providerTransactions"];
  agentRuns: ResolutionSnapshot["agentRuns"];
  partnerRequests?: ResolutionSnapshot["partnerRequests"];
  partnerTokenReceipts?: ResolutionSnapshot["partnerTokenReceipts"];
  automationRequests?: ResolutionSnapshot["automationRequests"];
  deadlines?: ResolutionSnapshot["deadlines"];
};

export type CommitResult =
  | "COMMITTED"
  | "DUPLICATE_EVENT"
  | "VERSION_CONFLICT"
  | "CASE_INTEGRITY_ERROR";

export type AppendAgentRunResult =
  | "COMMITTED"
  | "VERSION_CONFLICT"
  | "CASE_INTEGRITY_ERROR";

export type CreatePartnerRequestResult =
  | "COMMITTED"
  | "VERSION_CONFLICT"
  | "CASE_INTEGRITY_ERROR";

export const emptyResolutionSnapshot = (): ResolutionSnapshot => ({
  cases: [],
  events: [],
  evidence: [],
  claims: [],
  auditRecords: [],
  providerTransactions: [],
  agentRuns: [],
  partnerRequests: [],
  partnerTokenReceipts: [],
  automationRequests: [],
  deadlines: [],
});
