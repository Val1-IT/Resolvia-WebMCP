export type SessionTokenClaims = {
  userId: string;
  email: string | null;
  emailVerified: boolean;
  authTimeSeconds: number;
};

export interface SessionService {
  verifyIdToken(idToken: string): Promise<SessionTokenClaims>;
  createSessionCookie(idToken: string, expiresInMs: number): Promise<string>;
  verifySessionCookie(cookie: string): Promise<SessionTokenClaims>;
  revokeUserSessions(userId: string): Promise<void>;
}