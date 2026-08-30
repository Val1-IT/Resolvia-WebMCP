# Sanitized competition snapshot

This directory is a sanitized competition export for Resolvia-WebMCP.

- Source private development HEAD: 94460d01e1341bb376c9d66396635e39fba97d3c
- Pre-WebMCP baseline: d98271271662faac34faa77ee5389381e52fdc20
- Private git history is NOT included
- Personal operator identity was replaced with placeholders
- Private release evidence / planning trees were excluded

Do not treat this as a historical reconstruction of private development.

## Remaining non-secret identifiers

Unit/integration tests may still use the deterministic fixture string `resolvia-project` and
synthetic service-account emails under that project id. These are **test fixtures**, not live
credentials, and are required for functional parity of the security/release unit suites.

Operator email defaults in `infra/google/*.ps1` are `competition-operator@example.com`
(placeholder only).
