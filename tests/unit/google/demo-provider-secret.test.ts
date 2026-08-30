import { describe, expect, it } from "vitest";

import {
  DemoProviderSecretError,
  loadDemoProviderSecret,
} from "@/src/infrastructure/google/demo-provider-secret";

const encodedSecret = Buffer.alloc(32, 7).toString("base64");

describe("Demo Provider Secret Manager reader", () => {
  it("decodes a 256-bit secret returned by the enabled latest version", async () => {
    const accessSecretVersion = async (input: { name: string }) => {
      expect(input.name).toBe(
        "projects/resolvia-project/secrets/resolvia-demo-provider-hmac/versions/latest",
      );
      return [{ payload: { data: Buffer.from(encodedSecret, "utf8") } }] as const;
    };

    await expect(
      loadDemoProviderSecret({ projectId: "resolvia-project", accessSecretVersion }),
    ).resolves.toEqual(Buffer.alloc(32, 7));
  });

  it("fails closed for unavailable or malformed secret material", async () => {
    await expect(
      loadDemoProviderSecret({
        projectId: "resolvia-project",
        accessSecretVersion: async () => {
          throw new Error("permission denied");
        },
      }),
    ).rejects.toMatchObject({ code: "DEMO_PROVIDER_SECRET_UNAVAILABLE" });
    await expect(
      loadDemoProviderSecret({
        projectId: "resolvia-project",
        accessSecretVersion: async () => [{ payload: { data: Buffer.from("bad", "utf8") } }],
      }),
    ).rejects.toBeInstanceOf(DemoProviderSecretError);
  });
});