# Competition deployment preparation (not executed)

## Intent

Deploy sealed candidate `94460d01e1341bb376c9d66396635e39fba97d3c` (this sanitized tree) to an isolated HTTPS demo for judges.

## Data

- `DATA_CLASSIFICATION = SYNTHETIC_ONLY`
- `REAL_CUSTOMER_DATA = NONE`
- Demo case: RV-1028 only

## Judge access

`JUDGE_ACCESS_MODEL = PUBLIC_SYNTHETIC_DEMO`

Preferred posture for competition:

- Isolated competition host (not the private hardened release topology)
- LOCAL deterministic store with synthetic seed, **or** an isolated Firestore prefix with no customer data
- Bounded WebMCP tools only (the five registered tools)
- No personal/admin credentials
- No Gemini/Stripe secrets required for the core WebMCP demo path

Note: LOCAL mode resolves a demo identity with admin scope for local development. A public internet deploy must not reuse personal credentials and should remain synthetic-only with short-lived or competition-scoped hosting after explicit public-exposure approval.

## Do not deploy yet if

- Public Cloud Run / `allUsers` (or equivalent) on private release services is required
- New broad GCP IAM grants are required
- Production customer Identity Platform is involved

Current private deploy scripts use `--no-allow-unauthenticated`. Reusing that private topology as a public judge URL requires a separate security approval.

## Status

`DEPLOYMENT_STATUS = STOPPED_PENDING_PUBLIC_EXPOSURE_APPROVAL`  
`LIVE_URL = PENDING`
