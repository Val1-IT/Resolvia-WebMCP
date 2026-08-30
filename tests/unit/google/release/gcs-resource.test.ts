import { describe, expect, it } from "vitest";

import {
  canonicalizeGcsAssetResource,
  gcsAssetResourcesEquivalent,
} from "@/src/infrastructure/google/release/gcs-resource";

describe("canonicalizeGcsAssetResource", () => {
  it("accepts the projects/_/buckets form", () => {
    expect(
      canonicalizeGcsAssetResource(
        "//storage.googleapis.com/projects/_/buckets/resolvia-assets",
      ),
    ).toBe("//storage.googleapis.com/projects/_/buckets/resolvia-assets");
  });

  it("canonicalizes the short bucket form to projects/_/buckets", () => {
    expect(
      canonicalizeGcsAssetResource("//storage.googleapis.com/resolvia-assets"),
    ).toBe("//storage.googleapis.com/projects/_/buckets/resolvia-assets");
  });

  it.each([
    "",
    "gs://resolvia-assets",
    "https://storage.googleapis.com/resolvia-assets",
    "//storage.googleapis.com/projects/my-project/buckets/resolvia-assets",
    "//storage.googleapis.com/projects/_/buckets/resolvia-assets/objects/x",
    "//storage.googleapis.com/resolvia-assets/extra",
    "//storage.googleapis.com/",
    "//storage.googleapis.com/projects/_/buckets/",
    "//compute.googleapis.com/projects/_/buckets/resolvia-assets",
  ])("fails closed for non-canonical path %s", (value) => {
    expect(canonicalizeGcsAssetResource(value)).toBeNull();
  });

  it("treats short and projects/_ forms as equivalent", () => {
    expect(
      gcsAssetResourcesEquivalent(
        "//storage.googleapis.com/resolvia-assets",
        "//storage.googleapis.com/projects/_/buckets/resolvia-assets",
      ),
    ).toBe(true);
  });

  it("rejects inequivalent or invalid pairs", () => {
    expect(
      gcsAssetResourcesEquivalent(
        "//storage.googleapis.com/resolvia-assets",
        "//storage.googleapis.com/other-bucket",
      ),
    ).toBe(false);
    expect(
      gcsAssetResourcesEquivalent(
        "gs://resolvia-assets",
        "//storage.googleapis.com/resolvia-assets",
      ),
    ).toBe(false);
  });
});
