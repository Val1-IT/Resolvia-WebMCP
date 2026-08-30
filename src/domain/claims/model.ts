import { z } from "zod";

const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const ClaimStatusSchema = z.enum([
  "SUPPORTED",
  "CONTRADICTED",
  "UNVERIFIED",
  "PARTIALLY_VERIFIED",
]);

export const EvidenceRelationshipKindSchema = z.enum([
  "AUTHENTICATES_ASSERTION",
  "SUPPORTS_PROPOSITION",
  "CONTRADICTS_PROPOSITION",
]);

export const ClaimEvidenceRelationshipSchema = z.object({
  evidenceId: z.string().min(1),
  kind: EvidenceRelationshipKindSchema,
});

export const ClaimRecordSchema = z.object({
  id: z.string().min(1),
  caseId: z.string().min(1),
  statement: z.string().min(1),
  claimantPartyId: z.string().min(1),
  sourceEventId: z.string().min(1),
  status: ClaimStatusSchema,
  evidenceRelationships: z.array(ClaimEvidenceRelationshipSchema),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;
export type EvidenceRelationshipKind = z.infer<
  typeof EvidenceRelationshipKindSchema
>;
export type ClaimEvidenceRelationship = z.infer<
  typeof ClaimEvidenceRelationshipSchema
>;
export type ClaimRecord = z.infer<typeof ClaimRecordSchema>;

export function evaluateClaimStatus(claim: ClaimRecord): ClaimStatus {
  const hasSupport = claim.evidenceRelationships.some(
    ({ kind }) => kind === "SUPPORTS_PROPOSITION",
  );
  const hasContradiction = claim.evidenceRelationships.some(
    ({ kind }) => kind === "CONTRADICTS_PROPOSITION",
  );

  if (hasSupport && hasContradiction) return "PARTIALLY_VERIFIED";
  if (hasSupport) return "SUPPORTED";
  if (hasContradiction) return "CONTRADICTED";
  return "UNVERIFIED";
}
