import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

const e2eDataPath = path.join(process.cwd(), ".data", "resolvia-e2e.json");
const e2ePort = process.env.RESOLVIA_E2E_PORT ?? "3000";
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL: e2eBaseUrl,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run build && npm run start",
    url: e2eBaseUrl,
    reuseExistingServer: false,
    env: {
      GEMINI_API_KEY: "",
      RUN_LIVE_GEMINI_SMOKE: "0",
      STRIPE_SECRET_KEY: "sk_test_resolvia_e2e_fixture",
      STRIPE_WEBHOOK_SECRET: "whsec_resolvia_fixture",
      RESOLVIA_RUNTIME_MODE: "LOCAL",
      RESOLVIA_DATA_PATH: e2eDataPath,
      PORT: e2ePort,
      RUN_LIVE_STRIPE_SMOKE: "0",
    },
    timeout: 180_000,
  },
});
