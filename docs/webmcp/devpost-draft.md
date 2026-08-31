# Devpost draft — DO NOT SUBMIT YET

## Title
Resolvia WebMCP — Evidence-Governed Dispute Investigation

## Tagline
AI investigates. Evidence decides.

## Description
Resolvia is an evidence-driven dispute resolution workspace. WebMCP exposes five structured case tools so an external agent can inspect the same authoritative case state a human sees—Truth Graph, resolution gaps, deterministic readiness—and prepare a draft evidence request without resolving cases, issuing refunds, or rewriting truth.

## Why WebMCP
Scraping UI text is brittle and authority-blind. WebMCP registers same-origin tools so ChatGPT/supported Chrome can call Resolvia’s authenticated case projections directly.

## Technical implementation
- document.modelContext.registerTool in the case workspace
- POST /api/webmcp/invoke with session identity + authorizeCaseAccess
- Deterministic projectResolutionReadiness from shared evidence gates
- Draft-only resolvia_prepare_evidence_request (requiresHumanApproval=true)

## Prior work vs challenge work
Pre-existing: case model, evidence/claims, Truth Graph, Gemini AgentRuns, deterministic policy.
New: WebMCP registration, readiness projection, invoke API, five tools, collaboration panel.
Baselines: PRE_WEBMCP d982712… → WEBMCP 94460d0… (sanitized public snapshot; private history omitted).

## Testing
1. Open https://resolvia-webmcp-competition-3pzbr52hla-et.a.run.app/cases/RV-1028 in WebMCP-capable Chrome
2. Confirm five tools discovered
3. Ask readiness → NOT READY; gaps; Truth Graph; prepare request with requirementId+target → draft + human approval
4. Confirm case version unchanged (no authoritative mutation)
