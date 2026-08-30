import type { SessionService } from "@/src/application/ports/session-service";
import { FirebaseAdminSessionService } from "@/src/infrastructure/auth/firebase-admin-session-service";

let service: SessionService | undefined;

export function getSessionService(): SessionService {
  service ??= new FirebaseAdminSessionService();
  return service;
}