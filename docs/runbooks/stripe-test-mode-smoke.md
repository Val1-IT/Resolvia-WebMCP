# Stripe Test Mode provider verification smoke

This runbook proves Resolvia Phase 5 with a real Stripe Test Mode object and a webhook signed by Stripe CLI. It does not create a production refund, move production money, or treat a locally generated test signature as live evidence.

Official references:

- [Receive Stripe events in a webhook endpoint](https://docs.stripe.com/webhooks?lang=node)
- [Verify webhook signatures](https://docs.stripe.com/webhooks/signature)
- [Refund lifecycle events](https://docs.stripe.com/refunds)
- [Stripe CLI trigger and override syntax](https://docs.stripe.com/stripe-cli/triggers)

## Prerequisites

- A Stripe account in Test Mode.
- A restricted `sk_test_...` server key.
- Stripe CLI installed and authenticated against the same Test Mode account.
- An existing Test Mode refund object created deliberately by the human operator. Resolvia never creates the refund.
- RV-1028 reset and seeded at `INVESTIGATING`, version 4, with at least one AgentRun based on v4.

Never use an `sk_live_...` key, the CLI `--live` flag, or a production webhook secret.

## 1. Reset and seed the local case

Stop the local server, remove only the ignored local snapshot, then restart:

```powershell
Remove-Item -LiteralPath .data\resolvia.json -Force -ErrorAction SilentlyContinue
npm.cmd run dev
```

Open `http://127.0.0.1:3000/cases/RV-1028`. Confirm:

- state `INVESTIGATING`;
- version `v4`;
- merchant claim `UNVERIFIED`;
- merchant evidence `AUTHENTICATED SOURCE`;
- no authoritative transaction node.

Click `Analyze case` once. A valid or degraded AgentRun is acceptable, but it must be based on case v4.

## 2. Start Stripe CLI forwarding

In a second terminal:

```powershell
stripe listen --events refund.created,refund.updated,refund.failed --forward-to http://127.0.0.1:3000/api/providers/stripe/webhook
```

Copy the `whsec_...` signing secret printed by `stripe listen`. Put the Test Mode values in ignored `.env.local` and restart the Next.js server so it reads them:

```dotenv
STRIPE_SECRET_KEY=sk_test_replace_with_restricted_test_key
STRIPE_WEBHOOK_SECRET=whsec_replace_with_stripe_listen_secret
RESOLVIA_RUNTIME_MODE=LOCAL
RUN_LIVE_STRIPE_SMOKE=1
STRIPE_CLI_FORWARDING_ACTIVE=1
```

The signing secret from `stripe listen` must match the running listener. A Dashboard endpoint secret is not interchangeable with this local forwarding secret.

## 3. Start the observer gate

In a third terminal, before changing the refund object:

```powershell
$env:RUN_LIVE_STRIPE_SMOKE = "1"
$env:STRIPE_CLI_FORWARDING_ACTIVE = "1"
npm.cmd run test:stripe:smoke
```

The gate first asserts the untouched v4 case, then waits up to 60 seconds for one signed provider mutation. It never calls the Stripe API and never creates a refund.

## 4. Emit a real Test Mode refund event

Use a refund ID that the human operator already created in Test Mode. Updating only its metadata produces a real `refund.updated` event while preserving the existing Test Mode refund:

```powershell
$refundId = "re_replace_with_existing_test_refund"
stripe refunds update $refundId -d "metadata[resolvia_case_id]=case-rv-1028"
```

Do not add `--live`. If the installed CLI exposes different resource syntax, run `stripe refunds update --help`; the equivalent raw Test Mode API form is:

```powershell
stripe post "/v1/refunds/$refundId" -d "metadata[resolvia_case_id]=case-rv-1028"
```

The forwarding terminal must show a `202` response for `refund.updated`. Unsupported related events may show `202` with `IGNORED`; they create no semantic mutation.

## 5. Expected evidence

The live gate passes only when all of these are true:

- RV-1028 advances exactly once from v4 to v5.
- State remains `INVESTIGATING`; no demo-only transition is forced.
- One normalized event with external Stripe event identity is stored.
- One `PROVIDER_VERIFIED` evidence record is stored without the raw Stripe payload, card data, or customer data.
- One authoritative Stripe refund transaction is stored.
- Separate refund-existence and processor-status propositions are `SUPPORTED`.
- The merchant assertion remains `UNVERIFIED` and linked only through `AUTHENTICATES_ASSERTION`.
- Customer receipt remains `UNKNOWN`.
- One same-state audit record explains the atomic semantic mutation.
- The historical v4 AgentRun remains stored and is projected as `STALE` at v5.

A local fixture signed with `generateTestHeaderString` proves deterministic signature handling only. It must never be reported as completion of this live gate.

## Troubleshooting

- `400 INVALID_WEBHOOK`: verify the exact `whsec_...` from the currently running `stripe listen`, restart Next.js, and preserve the raw request body.
- `503 STRIPE_NOT_CONFIGURED`: verify both server-side Test Mode variables and restart Next.js.
- `503 PROVIDER_PROCESSING_FAILED`: confirm RV-1028 is seeded at v4 and the refund metadata is exactly `resolvia_case_id=case-rv-1028`.
- Gate starts at a version other than v4: stop, reset only `.data\resolvia.json`, reseed, and create a v4 AgentRun before retrying.
- Timeout: confirm the forwarding terminal received `refund.updated` and returned `202`.
