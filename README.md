# Resolvia

**AI investigates. Evidence decides.**

## 1. What Resolvia is

Resolvia is an evidence-driven dispute resolution workspace. It keeps claims, evidence, provenance, Truth Graph projections, deterministic policy, and AI proposals as distinct concepts so agents investigate without inventing truth.

## 2. Why WebMCP matters

WebMCP lets an external agent inspect the **same authoritative case state** the human sees through structured tools—not by scraping the UI.

## 3. The demo scenario — RV-1028

Open `/cases/RV-1028`. The seeded synthetic case is deliberately incomplete: provider confirmation and customer receipt evidence are still missing, so deterministic readiness is **NOT READY**.

## 4. WebMCP tools

| Tool | Role |
|---|---|
| `resolvia_get_case` | Case inspection |
| `resolvia_get_truth_graph` | Truth Graph projection |
| `resolvia_list_resolution_gaps` | Missing verification gaps |
| `resolvia_check_resolution_readiness` | Deterministic readiness |
| `resolvia_prepare_evidence_request` | Draft evidence request only |

## 5. What agents CAN do

- Inspect case state
- Reason over Truth Graph and gaps
- Identify missing evidence
- Check deterministic readiness
- Prepare a human-reviewable evidence request (draft)

## 6. What agents CANNOT do

- Resolve cases
- Issue refunds
- Promote evidence
- Modify the Truth Graph
- Bypass deterministic policy

## 7. Architecture

```text
Browser (WebMCP tools)
  → same-origin POST /api/webmcp/invoke
  → session identity + authorizeCaseAccess
  → read-only case / Truth Graph / readiness projections
  → draft-only evidence request (requiresHumanApproval=true)

Authoritative writes stay outside WebMCP:
evidence ingestion · deterministic policy · human approval
```

Gemini (when configured) may propose analysis as an append-only AgentRun. It cannot assign provenance, transition the case, or execute external actions.

## 8. Run locally

Requirements: Node.js 24.13+ and npm 11.8+.

```powershell
npm.cmd ci
npm.cmd run dev
```

Open [http://localhost:3000/cases/RV-1028](http://localhost:3000/cases/RV-1028). Prefer `localhost` over `127.0.0.1` under Next.js 16.

Optional: copy `.env.example` → `.env.local` and set placeholders only. No credentials are required for the deterministic demo.

## 9. WebMCP testing

1. Use supported Chrome / ChatGPT in-app browser with WebMCP enabled.
2. Open RV-1028 and confirm the five tools are discovered.
3. Replay:
   - “Can RV-1028 be resolved yet?” → readiness **NOT READY**
   - “What is missing?” → gaps
   - “Show me why.” → Truth Graph
   - “Prepare the request.” → draft; **human approval required**

Local Chrome example flags: `--enable-features=WebMCPTesting` / `--enable-blink-features=WebMCP`.

## 10. Prior work vs WebMCP challenge work

See [docs/webmcp/competition-delta.md](docs/webmcp/competition-delta.md).

| | Commit |
|---|---|
| Pre-WebMCP baseline | `d98271271662faac34faa77ee5389381e52fdc20` |
| WebMCP implementation | `94460d01e1341bb376c9d66396635e39fba97d3c` |

This public repository is a **sanitized competition snapshot** derived from a private development repository. It does **not** include private git history.

## 11. Security / human-control model

- Agent tools are read/draft only
- Same-origin invoke + case authorization
- No browser Firestore authority
- Consequential actions require human approval
- Demo data is synthetic RV-1028 only

## 12. Demo URL

`LIVE_URL = PENDING_COMPETITION_DEPLOY_APPROVAL`

## License

No project LICENSE file is included yet. `LICENSE_APPROVAL_REQUIRED = YES`. Do not assume MIT/Apache/GPL until the owner adds an explicit license.
