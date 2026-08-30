# Resolvia WebMCP Challenge — Competition Delta

## Transparency

Resolvia was a **pre-existing** private project before the WebMCP challenge.

This public competition repository is a **sanitized competition snapshot** derived from the private development repository. It begins from a clean import of the challenge candidate and does **not** preserve private git history or imply that the public commit timeline predates the challenge.

```text
PRE_WEBMCP_BASE_HEAD = d98271271662faac34faa77ee5389381e52fdc20
WEBMCP_IMPLEMENTATION_HEAD = 94460d01e1341bb376c9d66396635e39fba97d3c
WEBMCP_BRANCH = feat/webmcp-2026
FROZEN_PRIVATE_RELEASE_BRANCH = recovery/resolvia-final-20260830
WEBMCP_SECURITY_SCAN = 7c19964a-191f-4342-bb30-5e4cf4aa1395
GATE = RESOLVIA_WEBMCP_SECURITY_GATE_CLOSED
LIVE_BROWSER_GATE = RESOLVIA_WEBMCP_LIVE_BROWSER_VERIFIED
```

Implementation period: WebMCP work on `feat/webmcp-2026` after baseline `d982712`, sealed at `94460d0` (2026-08).

## PRE-EXISTING BEFORE WEBMCP CHALLENGE

- Resolvia case model (`ResolutionCase`, state machine, owner/admin auth)
- Evidence / claims separation (`ClaimRecord` vs `EvidenceRecord`, provenance levels)
- Truth Graph derivation (`buildTruthGraph`) with Claim ≠ Evidence
- Gemini proposal layer (`analyzeCase`, AgentRun append-only, policy validation)
- Deterministic resolution policy (`planAutomatedResolutionEvaluation`)
- Optional private Google Cloud connected architecture (Firestore, Pub/Sub, Cloud Run)
- Case workspace UI for synthetic RV-1028 (`/cases/[caseId]`)

## NEW FOR WEBMCP CHALLENGE

- Browser WebMCP registration via `document.modelContext.registerTool(...)`
  with AbortController cleanup and unsupported-browser no-op
- Deterministic Resolution Readiness projection (`projectResolutionReadiness`)
  reusing existing evidence gates — not an ML score
- Same-origin authenticated tool invoke API: `POST /api/webmcp/invoke`
- Structured tools:
  - `resolvia_get_case`
  - `resolvia_get_truth_graph`
  - `resolvia_list_resolution_gaps`
  - `resolvia_check_resolution_readiness`
  - `resolvia_prepare_evidence_request` (draft only; `requiresHumanApproval=true`)
- Human + agent collaboration panel on the case workspace
- Competition documentation (this file)

## Explicitly NOT added / NOT published here

- No high-risk agent actions (`resolve_case`, refund, promote evidence, etc.)
- No Firestore access from browser WebMCP code
- No private git history of the development repository
- No personal operator credentials
- No private release evidence packs or operator incident history
- No merge into the frozen private release branch
