"use client";

import { useState } from "react";

type PartnerPortalContext = {
  requestId: string;
  caseDisplayId: string;
  requestedEvidenceType: string;
  expiresAt: string;
};

type PartnerPortalProps = {
  requestId: string;
  requestAccess?: (requestId: string, token: string) => Promise<{
    ok: boolean;
    json: () => Promise<PartnerPortalContext | { error: string }>;
  }>;
};

export function PartnerPortal({
  requestId,
  requestAccess = defaultRequestAccess,
}: PartnerPortalProps) {
  const [token, setToken] = useState("");
  const [context, setContext] = useState<PartnerPortalContext | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function openRequest(): Promise<void> {
    setMessage(null);
    setContext(null);
    const response = await requestAccess(requestId, token);
    if (!response.ok) {
      setMessage("This request is unavailable or the access token is invalid.");
      return;
    }
    setContext((await response.json()) as PartnerPortalContext);
    setToken("");
  }

  return (
    <main className="partner-portal-shell">
      <section className="partner-portal-card" aria-labelledby="partner-portal-title">
        <p className="panel-kicker">Resolvia Partner Portal</p>
        <h1 id="partner-portal-title">Respond to a scoped evidence request</h1>
        <p>Enter the one-time partner token. Resolvia will disclose only the minimum request context.</p>
        <label htmlFor="partner-access-token">Partner access token</label>
        <input
          id="partner-access-token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
        <button type="button" onClick={openRequest} disabled={token.length === 0}>
          Open request
        </button>
        {message ? <p role="alert">{message}</p> : null}
        {context ? (
          <dl className="partner-request-context">
            <div><dt>Case</dt><dd>{context.caseDisplayId}</dd></div>
            <div><dt>Requested evidence</dt><dd>{context.requestedEvidenceType.replaceAll("_", " ")}</dd></div>
            <div><dt>Expires</dt><dd>{context.expiresAt}</dd></div>
          </dl>
        ) : null}
      </section>
    </main>
  );
}

async function defaultRequestAccess(requestId: string, token: string) {
  return fetch(`/api/partner/requests/${encodeURIComponent(requestId)}/access`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
}