"use client";

import { useState } from "react";

export function SignOutControl() {
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      const csrfResponse = await fetch("/api/auth/csrf", { cache: "no-store" });
      const csrf = (await csrfResponse.json()) as { csrfToken?: string };
      if (!csrfResponse.ok || !csrf.csrfToken) throw new Error("csrf unavailable");
      const response = await fetch("/api/auth/logout", { method: "POST", headers: { "x-csrf-token": csrf.csrfToken } });
      if (!response.ok) throw new Error("sign out rejected");
      window.location.assign(new URL("/login", window.location.href).toString());
    } catch {
      setPending(false);
    }
  }

  return <button className="sign-out-control" type="button" onClick={signOut} disabled={pending}>{pending ? "Signing out..." : "Sign out"}</button>;
}