# Private connected deployment

This is an operator guide, not deployment authorization. G4-G6 are required for a private deployment; G8-G12 cover later connected partner, Scheduler/Gemini, identity, and exposure work. Public exposure is forbidden until G12.

## Configuration

| Variable | Service | Purpose | Secret |
|---|---|---|---|
| `RESOLVIA_RUNTIME_MODE=CONNECTED` | web + engine | Select Firestore/Pub/Sub; never falls back to LOCAL | no |
| `GOOGLE_CLOUD_PROJECT` | web + engine | Exact project | no |
| `RESOLVIA_GCP_REGION` | web + engine | Exact region | no |
| `RESOLVIA_PUBSUB_TOPIC` | web + engine | Normalized event topic | no |
| `RESOLVIA_PUBSUB_SUBSCRIPTION` | engine | Expected authenticated push subscription | no |
| `RESOLVIA_PUBSUB_PUSH_SERVICE_ACCOUNT` | engine | Expected push identity | no |
| `RESOLVIA_WEB_URL` | web + engine | Exact private/public web origin as approved | no |
| `RESOLVIA_ENGINE_AUDIENCE` | web + engine | Exact private engine OIDC audience | no |
| `RESOLVIA_FIRESTORE_DATABASE` | web + engine | Firestore database, normally `(default)` | no |
| `RESOLVIA_RATE_LIMIT_HMAC_SECRET` | web | HMAC key for rate and replay receipt IDs | yes; G12 |
| Demo Provider HMAC | web | Secret Manager value for signed synthetic provider ingress | yes; G3 |
| Gemini API key | engine | Optional version-pinned analysis only | yes; G10 |
| Firebase client metadata | browser/web | Google sign-in client configuration | public metadata; G11 |
| user/admin allowlists | web | Server-side session authorization | sensitive configuration; G11 |

Never put server secrets in a `NEXT_PUBLIC_*` variable, command output, repository file, or browser-visible response.

## Read-only preflight

```powershell
.\infra\google\preflight.ps1 -ProjectId your-gcp-project -Region asia-southeast2
.\infra\google\deploy.ps1 -ProjectId your-gcp-project -Region asia-southeast2 -WhatIf
```

Review the planned resource/IAM delta. Stop on an exact missing permission; do not compensate with Owner, Editor, public invocation, a service-account key, or a LOCAL fallback.

## Approved private deployment command

Only after the relevant gate is approved:

```powershell
.\infra\google\deploy.ps1 -ProjectId your-gcp-project -Region asia-southeast2
```

The deployment must retain min instances 0, max instances 2, 1 vCPU/512 MiB, concurrency 20, timeout 60 seconds, CPU throttling, and `--no-allow-unauthenticated`. The engine remains private even if the web service is later approved for G12 exposure.

## Verification and rollback

Verify anonymous health returns 403 and an approved operator identity receives a bounded health response with `CONNECTED`, exact revision, and readiness booleans. Verify the image tag matches the intended Git checkpoint and the expected service account/IAM bindings are present.

Rollback shifts traffic only and requires an approved known-good revision:

```powershell
.\infra\google\rollback.ps1 -Service resolvia-web -Revision <known-good-revision> -ProjectId your-gcp-project -Region asia-southeast2
.\infra\google\rollback.ps1 -Service resolvia-engine -Revision <known-good-revision> -ProjectId your-gcp-project -Region asia-southeast2
```

Do not delete services, revisions, images, secrets, topics, subscriptions, jobs, or Firestore data without G13.
