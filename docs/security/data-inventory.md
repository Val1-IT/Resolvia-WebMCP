# Data and control inventory

| Data | Authority/sensitivity | Stored form | Retention control |
|---|---|---|---|
| Cases, claims, events, evidence, transactions | Authoritative; case confidential | Firestore/local validated records | No automatic deletion before approved tombstone design; deletion needs G13 |
| Audit/provenance | Authoritative explanation | Append-only records | Preserve until approved 180-day policy can be implemented without rewriting truth |
| AgentRuns | Non-authoritative; may contain narrative | Strict structured fields, redacted; raw output digest only | 30-day bounded dry-run planner |
| Partner access token | Secret | Never stored raw; SHA-256 digest only | Terminal receipt eligible after expiry plus 7-day grace |
| Provider/partner raw body | Sensitive/untrusted | Not persisted | Request lifetime only |
| Operational logs | Metadata only | Structured identifiers/error classes; no narratives | Configure Cloud Logging to 14 days under G12 |
| Gemini API key/provider secrets | Secret | Environment/Secret Manager only | Provider-managed rotation; never rendered or logged |
| Rate-limit subjects/source chains | Sensitive anti-abuse metadata | HMAC-derived document ID only; raw token, user ID, and source are not stored | Fixed-window documents carry bounded expiry metadata; cleanup activation waits for G12/G13 |
| Demo Provider replay receipt | Operational integrity metadata | HMAC-derived nonce document ID plus payload digest, semantic event ID, lease owner/state, and bounded timestamps; raw nonce/body/signature absent | Ten-minute logical expiry; physical cleanup activation waits for G12/G13 |

Every case has immutable `ownerUserId`. The application authorization port permits only that owner or an explicit admin. Existing connected demo records need an approved owner migration before the new schema can be deployed.

`planRetentionBatch` is intentionally a dry-run selector capped at 500 items. It selects expired AgentRuns and terminal token receipts only. It does not delete evidence, claims, transactions, or audit records and cannot change Truth Graph results. Actual deletion and a `PrivacyActionRecord` remain blocked on retention approval and G13.

Workspace timeline and audit history render latest-first pages of at most 50 items while Truth Graph, claim evaluation, and evidence projection still use the complete validated case bundle. Firestore case collection reads are capped at 500 records per collection and fail closed with `CASE_COLLECTION_LIMIT_EXCEEDED`; no authoritative history is silently truncated. This is a hackathon MVP bound, not a long-term storage design.
