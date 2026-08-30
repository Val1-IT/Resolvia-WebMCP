import { Firestore } from "@google-cloud/firestore";

import type { ResolutionStore } from "@/src/application/ports/resolution-store";
import { FirestoreResolutionStore } from "@/src/infrastructure/google/firestore-resolution-store";
import type { RuntimeConfig } from "@/src/infrastructure/google/runtime-config";

let store: ResolutionStore | undefined;

export function getConnectedResolutionStore(runtime: RuntimeConfig): ResolutionStore {
  if (runtime.mode !== "CONNECTED" || !runtime.projectId || !runtime.firestoreDatabase) {
    throw new ConnectedPersistenceUnavailableError();
  }
  store ??= new FirestoreResolutionStore(
    new Firestore({ projectId: runtime.projectId, databaseId: runtime.firestoreDatabase }),
    "resolvia",
  );
  return store;
}

export class ConnectedPersistenceUnavailableError extends Error {
  readonly code = "CONNECTED_PERSISTENCE_UNAVAILABLE";
  constructor() {
    super("Connected persistence is not available yet.");
    this.name = "ConnectedPersistenceUnavailableError";
  }
}