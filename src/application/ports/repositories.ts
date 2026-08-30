import type { AuditRecord } from "@/src/domain/audit/model";
import type { ResolutionCase } from "@/src/domain/cases/model";
import type { ClaimRecord } from "@/src/domain/claims/model";
import type { EvidenceRecord } from "@/src/domain/evidence/model";
import type { ResolutionEvent } from "@/src/domain/events/model";

export interface CaseRepository {
  getById(caseId: string): Promise<ResolutionCase | null>;
  list(): Promise<ResolutionCase[]>;
}

export interface EventRepository {
  listByCase(caseId: string): Promise<ResolutionEvent[]>;
}

export interface EvidenceRepository {
  listByCase(caseId: string): Promise<EvidenceRecord[]>;
}

export interface ClaimRepository {
  listByCase(caseId: string): Promise<ClaimRecord[]>;
}

export interface AuditRepository {
  listByCase(caseId: string): Promise<AuditRecord[]>;
}
