# Task 6.7 connected RV-1028 proof

This is the explicit Gate G7 proof for the private Phase 6 topology. It is synthetic Resolvia Demo Provider data only. It does not create, import, or claim Stripe, bank, settlement, wallet, Gmail, or institutional-provider evidence.

## Preconditions

- Task 6.6 private deployment is healthy in `your-gcp-project` / `asia-southeast2`.
- The operator has Cloud Run Invoker on `resolvia-web`, Application Default Credentials for the project, and access to the existing Demo Provider HMAC secret.
- `resolvia-web` and `resolvia-engine` remain private; do not add public access.
- `RUN_PHASE6_CONNECTED_SMOKE=1` is an explicit one-time opt-in.

The test accesses the HMAC only in its server-side Node process through Secret Manager. It never prints, writes, commits, or exposes the secret to the browser. Payloads, signatures, tokens, and full Cloud URLs are not reported by the test.

## What the proof does

1. Deletes and recreates only the synthetic `case-rv-1028` records in the Resolvia Firestore collection prefix.
2. Creates a deterministic connected v4 `INVESTIGATING` baseline with the merchant claim still `UNVERIFIED`, only `AUTHENTICATED_SOURCE` merchant evidence, no provider transaction, and a transparent `FAILED_CONFIGURATION` baseline AgentRun at v4.
3. Generates one fresh canonical `resolvia_demo_provider` Test Mode refund observation, signs it with the existing HMAC, and submits it to the private provider ingress using the operator identity.
4. Waits for real Pub/Sub authenticated push and Firestore commit at v5.
5. Replays the same event ID and checks that the semantic state remains exactly v5 with one event, evidence, transaction, and audit effect.
6. Sends bounded invalid-signature, stale-timestamp, and unknown-case requests and confirms no RV-1028 semantic mutation.

The reset utility has no generic database reset path. It requires the exact RV-1028 case ID, `runtimeMode: "CONNECTED"`, an explicit `confirmed: true` argument, one collection prefix, and a maximum of 100 deletes. It is not an HTTP endpoint.

## Run

Set only non-secret connected configuration from the deployed services, then run the opt-in proof:

```powershell
$gcloud = "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
$env:RUN_PHASE6_CONNECTED_SMOKE = "1"
$env:RESOLVIA_RUNTIME_MODE = "CONNECTED"
$env:GOOGLE_CLOUD_PROJECT = "your-gcp-project"
$env:RESOLVIA_FIRESTORE_DATABASE = "(default)"
$env:RESOLVIA_WEB_URL = (& $gcloud run services describe resolvia-web --project your-gcp-project --region asia-southeast2 --format='value(status.url)').Trim()
npm.cmd run test:phase6:connected
```

Without the opt-in flag, the test is skipped—not passed. Do not loop or load-test this command.

## Expected proof

- Ingress returns `202` for the valid signed event and duplicate delivery; invalid HMAC and stale timestamp return `400` before publish.
- The accepted record retains `source.provider = resolvia_demo_provider`, `source.runtimeMode = TEST`, and results only in `DEMO_PROVIDER_VERIFIED` evidence.
- Pub/Sub delivery is `CONNECTED`; this metadata never promotes Demo Provider evidence to Stripe `PROVIDER_VERIFIED`.
- RV-1028 advances once from v4 to v5. The merchant assertion remains `UNVERIFIED`; two separate Demo Provider propositions support refund existence and processor status; customer receipt remains `UNKNOWN`.
- The authoritative Demo Provider transaction, supporting evidence, triggering event, claims, and audit share `case-rv-1028`.
- The Truth Graph replaces the generic missing-provider-transaction gap with the derived outcome/customer-receipt verification gap. That derived node remains non-authoritative and placeholder-only.
- The immutable v4 AgentRun renders `STALE` at v5.

A Gemini reanalysis is optional. If separately configured, it may append an AgentRun based on v5, but cannot alter any authoritative case, evidence, provenance, transaction, claim, blocker, next-best-action, or graph input.