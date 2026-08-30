import path from "node:path";

import { JsonResolutionStore } from "@/src/infrastructure/local/json-resolution-store";

const resolviaGlobal = globalThis as typeof globalThis & {
  __resolviaLocalStore?: JsonResolutionStore;
};

export function getLocalResolutionStore(): JsonResolutionStore {
  const configuredPath = process.env.RESOLVIA_DATA_PATH?.trim();
  resolviaGlobal.__resolviaLocalStore ??= new JsonResolutionStore(
    configuredPath || path.join(process.cwd(), ".data", "resolvia.json"),
  );

  return resolviaGlobal.__resolviaLocalStore;
}
