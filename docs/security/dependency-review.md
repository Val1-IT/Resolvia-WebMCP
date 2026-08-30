# Dependency security review - 2026-08-13

Compatible root overrides pin `tar@7.5.22` and `adm-zip@0.6.0`. A fresh `npm audit --omit=dev --json` reports 0 critical, 0 high, 21 moderate, and 6 low advisories.

The remaining findings are transitive Google Cloud/ADK telemetry, storage, UUID, and optional SQLite chains. Resolvia's agent path uses `LlmAgent` and `InMemoryRunner`, configures no archive/skill loader, and accepts no attacker-provided archive. Application routes do not pass untrusted W3C baggage, UUID buffers, SQLite input, or arbitrary storage requests into those dependency paths.

No forced audit fix or ADK downgrade was applied. The remaining moderate/low findings are accepted only for this private hackathon candidate and must be re-reviewed when compatible Google packages are available. Public or general-production readiness remains false.
