# Prompt-injection boundary verification

Resolvia treats every party name, claim, evidence summary, event summary, and existing case narrative sent to Gemini as untrusted data. The model is a proposal generator only: it has no tools, cannot call `ResolutionStore`, cannot assign provenance, and cannot transition a case.

The Phase 9.5 deterministic corpus covers:

- the former closing-sentinel string embedded inside evidence;
- instructions to ignore system rules;
- fabricated same-case and cross-case record IDs;
- requests to close or resolve a case;
- invented provider-verification and transaction fields;
- malicious URLs and action requests.

The v2 request frame contains a UTF-8 byte length and SHA-256 digest followed by one JSON payload and no attacker-injectable closing delimiter. Input is capped at 256 KiB. Final model output is capped at 64 KiB before parsing, must contain exactly one final response, and must pass the strict proposal schema plus deterministic same-case/provenance/action validation. Provider iteration has an application-enforced hard timeout; raw output is never retained, only a digest.

`npm.cmd run test:security` passes 26 deterministic tests. Live Gemini is optional and is not a source of authority or provider truth.
