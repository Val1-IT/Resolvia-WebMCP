# Private observability runbook

Resolvia emits allowlisted structured diagnostic fields only: severity, component, request ID, provider event ID, case ID, AgentRun ID, outcome, error class, and service revision. Narrative text, request bodies, provider payloads, credentials, raw model output, exception messages, and evidence content are not log fields.

For private connected diagnosis, query Cloud Logging by `jsonPayload.component`, then narrow by an opaque request, event, case, or AgentRun ID. Do not paste credentials or evidence narratives into log queries or annotations. Treat an error class as a diagnostic category, not proof that a provider transaction did or did not occur.

No log export, retention change, alert policy, or public dashboard is authorized by this runbook. Those are G12 operator decisions and require explicit approval. Until connected logging retention and access are reviewed, services remain private.
