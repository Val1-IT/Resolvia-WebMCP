# Resolvia hackathon threat model

## Scope and verdict

This model covers the private `resolvia-web` and `resolvia-engine` topology. It is hackathon scope, not a general-production security claim. Public exposure remains blocked until G11 Identity Platform setup, approved owner mapping, distributed rate limits, and G12 are complete.

| Boundary | Untrusted input | Required control | Current status |
|---|---|---|---|
| Browser → web | case IDs, forms, cookies | verified server session; owner/admin authorization before reads | Server session/owner guards implemented locally; G11 provider/accounts and connected isolation proof blocked |
| Provider → web | raw body, signature, timestamp | pre-parse byte cap; strict signature/time policy; replay-safe event ID | Implemented locally |
| Partner → web → engine | token and structured response | minimal disclosure; digest-only token; private ID-token call; scoped reservation | Implemented; connected G8 proof blocked |
| Pub/Sub → engine | OIDC and envelope | exact audience/identity; byte/schema/digest checks; durable event receipt | Implemented; connected proof unavailable |
| Gemini → application | arbitrary model output | no tools; strict schema; case/version/reference validation; redaction | Implemented and injection-tested |
| Engine → Firestore | authoritative mutation | case-scoped transaction, expected version, immutable owner, receipts/outbox | Implemented; local emulator verified, connected proof incomplete |

## Security objectives

- Authentication never establishes proposition truth.
- Only ResolutionStore commits authoritative semantic changes.
- Replays and uncertain broker outcomes may repeat delivery but produce one semantic effect.
- Cross-case references, stale AI output, invalid provenance, and limiter/auth outages fail closed.
- Provider bodies and raw model output are never persisted; partner tokens persist only as SHA-256 digests.

## Abuse cases

- Oversized or malformed bodies are rejected before parsing, signature work, publishing, or mutation.
- A guessed case ID must not reveal data; public case access therefore remains disabled until server sessions are connected.
- Prompt-injected instructions, fake provider truth, URLs, or action requests remain non-authoritative and non-executable.
- An ambiguous Pub/Sub publish keeps the partner receipt `PUBLISHED`; retry derives the identical event ID instead of reopening authority.
- High-risk actions—money movement, refunds, legal filings, impersonation, and irreversible external actions—remain out of scope.

The standard security scan of Phase 8 found three medium issues: missing per-user route authorization, unbounded provider/partner bodies, and the partner publish-uncertainty state downgrade. Local session/owner guards, bounded ingress, and publish-uncertainty handling are implemented. Connected G11 isolation and G12 limiter/public-exposure proof remain blocked, so the service stays private.
