import type { ResolutionStore } from "@/src/application/ports/resolution-store";
import { ConnectedPersistenceUnavailableError, getConnectedResolutionStore } from "@/src/infrastructure/google/get-connected-store";
import type { RuntimeConfig } from "@/src/infrastructure/google/runtime-config";
import { getLocalResolutionStore } from "@/src/infrastructure/local/get-local-store";

export { ConnectedPersistenceUnavailableError } from "@/src/infrastructure/google/get-connected-store";

type RuntimeStoreDependencies = {
  getLocalStore: () => ResolutionStore;
  getConnectedStore?: (runtime: RuntimeConfig) => ResolutionStore;
};

const defaultDependencies: RuntimeStoreDependencies = {
  getLocalStore: getLocalResolutionStore,
  getConnectedStore: getConnectedResolutionStore,
};

export function getResolutionStoreForRuntime(runtime: RuntimeConfig, dependencies: RuntimeStoreDependencies = defaultDependencies): ResolutionStore {
  if (runtime.mode === "LOCAL") return dependencies.getLocalStore();
  if (runtime.mode === "CONNECTED") {
    if (!dependencies.getConnectedStore) throw new ConnectedPersistenceUnavailableError();
    return dependencies.getConnectedStore(runtime);
  }
  throw new ConnectedPersistenceUnavailableError();
}