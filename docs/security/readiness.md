# Phase 9 security readiness

Verdict: `BLOCKED_ON_MANUAL_SETUP` / `HOLD_FOR_PUBLIC_EXPOSURE`.

Completed locally:

- immutable case ownership, Firebase Admin session verification, allowlisted owner/admin authorization, recent-auth, origin/CSRF checks, refresh-token revocation on logout, and deny-all browser Firestore rules;
- explicit runtime mode with no missing-mode fallback to LOCAL;
- bounded provider and internal partner request bodies;
- fixed-window authenticated rate limiting whose raw keys are HMAC-only and whose store outage fails closed;
- transactional Demo Provider replay receipts with HMAC-only nonce identity, bounded leases, payload/semantic conflict detection, retry release, and published duplicate recognition across instances;
- partner portal access closes after publication while the identical structured submission remains retryable until expiry;
- bounded/redacted Gemini input, unambiguous v2 framing, application-enforced hard timeout and output cap, strict structured output, deterministic authority validation, and digest-only raw output retention;
- structured logging with an explicit metadata allowlist and no narrative/payload/credential fields;
- bounded retention planning and case collection safety caps without truth mutation;
- deterministic security corpus and canonical local v4-to-v7 Taskmaster proof;
- dependency audit: 0 critical, 0 high, 21 moderate, 6 low.

Unresolved and not claimed:

- G8 partner proof is blocked because the private web service account lacks `roles/datastore.user`;
- G9 Scheduler, G10 live Gemini automation, G11 Identity Platform/user isolation, and G12 public exposure/connected limiter/logging review are unproven or unapproved;
- pre-auth partner tokens and untrusted forwarding metadata can create fresh limiter buckets until a trusted-edge/keying policy and final thresholds are approved;
- Pub/Sub publisher identity is not cryptographically bound to the event provenance asserted inside an envelope. Closing this requires approved service-identity/topic separation or signed ingress attestation, not an in-process label check.

Services must remain private. `HACKATHON_DEPLOYMENT_READY` and general-production readiness are false until the connected gates and unresolved controls are closed.
