import { describe, expect, it, vi } from "vitest";

import type { ResolutionStore } from "@/src/application/ports/resolution-store";
import { getResolutionStoreForRuntime } from "@/src/infrastructure/runtime/get-resolution-store-for-runtime";

const localStore: ResolutionStore = {
  loadCaseBundle: vi.fn(async () => null),
  loadPartnerRequest: vi.fn(async () => null),
  commitCaseMutation: vi.fn(async () => {
    throw new Error("unexpected store mutation");
  }),
  releasePartnerSubmission: vi.fn(async () => { throw new Error("unexpected partner release"); }),
  reservePartnerSubmission: vi.fn(async () => { throw new Error("unexpected partner reservation"); }),
  markPartnerSubmissionPublished: vi.fn(async () => { throw new Error("unexpected partner publication"); }),
  createPartnerRequest: vi.fn(async () => {
    throw new Error("unexpected partner request");
  }),
  appendAgentRun: vi.fn(async () => {
    throw new Error("unexpected agent run append");
  }),
};

describe("getResolutionStoreForRuntime", () => {
  it("uses the local store factory only in LOCAL mode", () => {
    const getLocalStore = vi.fn(() => localStore);

    expect(
      getResolutionStoreForRuntime({ mode: "LOCAL" }, { getLocalStore }),
    ).toBe(localStore);
    expect(getLocalStore).toHaveBeenCalledTimes(1);
  });

  it("fails closed for CONNECTED without invoking local persistence", () => {
    const getLocalStore = vi.fn(() => localStore);

    expect(() =>
      getResolutionStoreForRuntime(
        {
          mode: "CONNECTED",
          projectId: "resolvia-hackathon",
          region: "asia-southeast2",
          topicName: "resolution-events-v1",
          subscriptionName: "resolution-engine-v1",
          webUrl: "https://resolvia.example.test",
          engineAudience: "https://resolution-engine.example.test",
        },
        { getLocalStore },
      ),
    ).toThrow(
      expect.objectContaining({
        name: "ConnectedPersistenceUnavailableError",
        code: "CONNECTED_PERSISTENCE_UNAVAILABLE",
      }),
    );
    expect(getLocalStore).not.toHaveBeenCalled();
  });
});
