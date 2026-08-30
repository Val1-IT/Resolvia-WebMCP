import { createHash } from "node:crypto";

import type { ResolutionEvent } from "@/src/domain/events/model";

export class ResolutionEventCanonicalizationError extends Error {
  constructor() {
    super("Resolution event payload cannot be canonicalized.");
    this.name = "ResolutionEventCanonicalizationError";
  }
}

export function canonicalResolutionEventJson(event: ResolutionEvent): string {
  return JSON.stringify(canonicalize(event));
}

export function resolutionEventDigest(event: ResolutionEvent): string {
  return `sha256:${createHash("sha256")
    .update(canonicalResolutionEventJson(event), "utf8")
    .digest("base64url")}`;
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ResolutionEventCanonicalizationError();
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  throw new ResolutionEventCanonicalizationError();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
