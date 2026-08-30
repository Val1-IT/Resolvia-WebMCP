# Local setup

## Prerequisites

- Windows PowerShell or another shell capable of running `npm.cmd`.
- Node.js 24.13.0 or later and npm 11.8.0 or later.
- Chromium installed by Playwright only for E2E verification.
- No cloud, Gemini, Stripe, Firebase, or partner credential is required for the deterministic local workspace.

## Install and run

```powershell
npm.cmd ci
Copy-Item -LiteralPath .env.example -Destination .env.local
npm.cmd run dev
```

Keep `RESOLVIA_RUNTIME_MODE=LOCAL`. Open `http://localhost:3000/cases/RV-1028`. The local JSON snapshot is ignored by Git and is single-process persistence only.

## Deterministic verification

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test:unit
npm.cmd run test:integration
npm.cmd run test:security
npm.cmd run test:e2e
npm.cmd run build
git diff --check
```

Run Firestore parity only against a disposable local emulator. A skipped connected/live test is not a pass. The canonical local integration test proves the signed Demo Provider, scoped Demo Partner, durable automation, stale/fresh AgentRuns, duplicate idempotency, and deterministic v4-to-v7 journey without external calls.

## Local reset

To remove only the ignored local snapshot and allow the deterministic fixture to seed again:

```powershell
Remove-Item -LiteralPath .data\resolvia.json
```

This command is local only. It is not authorization to delete connected Firestore records.
