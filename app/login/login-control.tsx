"use client";

import { getApps, initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { useState } from "react";

import type { FirebaseClientConfig } from "@/src/infrastructure/auth/firebase-client-config";

export function LoginControl({ config, nextPath }: { config: FirebaseClientConfig | null; nextPath: string }) {
  const [message, setMessage] = useState(config ? "" : "Authentication is not configured yet.");
  const [pending, setPending] = useState(false);

  async function signIn() {
    if (!config) return;
    setPending(true);
    setMessage("");
    try {
      const app = getApps()[0] ?? initializeApp(config);
      const result = await signInWithPopup(getAuth(app), new GoogleAuthProvider());
      const idToken = await result.user.getIdToken(true);
      const csrfResponse = await fetch("/api/auth/csrf", { cache: "no-store" });
      const csrf = (await csrfResponse.json()) as { csrfToken?: string };
      if (!csrfResponse.ok || !csrf.csrfToken) throw new Error("csrf unavailable");
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrf.csrfToken },
        body: JSON.stringify({ idToken }),
      });
      if (!response.ok) throw new Error("session rejected");
      window.location.assign(nextPath);
    } catch {
      setMessage("Sign-in was not accepted. Use an approved Resolvia demo account.");
      setPending(false);
    }
  }

  return <div className="login-card"><p>Sign in with an approved Google account to access owned cases.</p><button type="button" onClick={signIn} disabled={pending || !config}>{pending ? "Signing in…" : "Sign in with Google"}</button><p role="status">{message}</p></div>;
}