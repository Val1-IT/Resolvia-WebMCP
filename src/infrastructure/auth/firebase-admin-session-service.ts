import { applicationDefault, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";

import type { SessionService, SessionTokenClaims } from "@/src/application/ports/session-service";

export class FirebaseAdminSessionService implements SessionService {
  private readonly auth = getAuth(
    getApps().length > 0
      ? getApp()
      : initializeApp({ credential: applicationDefault() }),
  );

  async verifyIdToken(idToken: string): Promise<SessionTokenClaims> {
    return claims(await this.auth.verifyIdToken(idToken, true));
  }

  createSessionCookie(idToken: string, expiresInMs: number): Promise<string> {
    return this.auth.createSessionCookie(idToken, { expiresIn: expiresInMs });
  }

  async verifySessionCookie(cookie: string): Promise<SessionTokenClaims> {
    return claims(await this.auth.verifySessionCookie(cookie, true));
  }

  revokeUserSessions(userId: string): Promise<void> {
    return this.auth.revokeRefreshTokens(userId);
  }
}

function claims(token: DecodedIdToken): SessionTokenClaims {
  return {
    userId: token.uid,
    email: typeof token.email === "string" ? token.email : null,
    emailVerified: token.email_verified === true,
    authTimeSeconds: token.auth_time,
  };
}