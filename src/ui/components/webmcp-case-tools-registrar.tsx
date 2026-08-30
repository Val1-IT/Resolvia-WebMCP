"use client";

import { useEffect } from "react";

import {
  getDocumentModelContext,
  registerCaseWebmcpTools,
} from "@/src/ui/webmcp/register-case-tools";

/**
 * Registers Resolvia WebMCP tools for the current case page.
 * Feature-detects document.modelContext; no-ops when unsupported.
 * AbortController cleans up on unmount / case navigation (Strict Mode safe).
 */
export function WebmcpCaseToolsRegistrar({
  caseId,
}: {
  caseId: string;
}) {
  useEffect(() => {
    const modelContext = getDocumentModelContext();
    if (!modelContext) return;

    const controller = new AbortController();
    void registerCaseWebmcpTools({
      modelContext,
      defaultCaseId: caseId,
      signal: controller.signal,
      onError: (error) => {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[webmcp] registration failed", error);
        } else {
          console.warn("[webmcp] registration failed");
        }
      },
    }).catch(() => {
      // Bounded diagnostic already emitted via onError.
    });

    return () => {
      controller.abort();
    };
  }, [caseId]);

  return null;
}
