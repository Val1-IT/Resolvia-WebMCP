import {
  BadgeCheck,
  CircleHelp,
  FileSearch,
  Landmark,
  ShieldCheck,
  UserRound,
} from "lucide-react";

export type ProvenanceLevel =
  | "USER_REPORTED"
  | "DOCUMENT_EXTRACTED"
  | "AUTHENTICATED_SOURCE"
  | "PROVIDER_VERIFIED"
  | "DEMO_PROVIDER_VERIFIED"
  | "PARTNER_VERIFIED"
  | "UNKNOWN";

const iconByLevel = {
  USER_REPORTED: UserRound,
  DOCUMENT_EXTRACTED: FileSearch,
  AUTHENTICATED_SOURCE: ShieldCheck,
  PROVIDER_VERIFIED: Landmark,
  DEMO_PROVIDER_VERIFIED: Landmark,
  PARTNER_VERIFIED: BadgeCheck,
  UNKNOWN: CircleHelp,
} as const;

export function ProvenanceBadge({ level }: { level: ProvenanceLevel }) {
  const Icon = iconByLevel[level];
  return (
    <span
      className={`provenance-badge provenance-${level.toLowerCase().replaceAll("_", "-")}`}
      aria-label={`Evidence confidence: ${level}`}
    >
      <Icon aria-hidden="true" size={13} strokeWidth={2.2} />
      {level.replaceAll("_", " ")}
    </span>
  );
}
