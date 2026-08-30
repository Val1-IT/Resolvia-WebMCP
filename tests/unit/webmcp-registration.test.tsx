// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildCaseWorkspaceViewModel } from "@/src/ui/case-workspace/model";
import { CaseWorkspace } from "@/src/ui/components/case-workspace";
import {
  createCaseWebmcpTools,
  getDocumentModelContext,
  registerCaseWebmcpTools,
  WEBMCP_REGISTERED_TOOL_NAMES,
} from "@/src/ui/webmcp/register-case-tools";
import { initialRefundBundle } from "@/tests/fixtures/domain";

afterEach(() => {
  Reflect.deleteProperty(document, "modelContext");
});

describe("WebMCP UI registration", () => {
  it("keeps ordinary Resolvia page working when WebMCP is unsupported", () => {
    render(
      <CaseWorkspace viewModel={buildCaseWorkspaceViewModel(initialRefundBundle())} />,
    );
    expect(screen.getByRole("heading", { name: /Resolution Readiness/i })).toBeInTheDocument();
    expect(screen.getByText("WEBMCP / AGENT COLLABORATION")).toBeInTheDocument();
    expect(screen.getByText("NOT READY")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AI RESOLUTION ANALYSIS" })).toBeInTheDocument();
    expect(getDocumentModelContext()).toBeNull();
  });

  it("registers exact expected tool names and cleans up with AbortController", async () => {
    const registered = new Map<string, AbortSignal>();
    const modelContext = {
      registerTool: vi.fn(async (tool: { name: string }, options?: { signal?: AbortSignal }) => {
        registered.set(tool.name, options!.signal!);
        options!.signal!.addEventListener("abort", () => {
          registered.delete(tool.name);
        });
      }),
    };
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: modelContext,
    });

    const controller = new AbortController();
    const names = await registerCaseWebmcpTools({
      modelContext,
      defaultCaseId: "RV-1028",
      signal: controller.signal,
    });
    expect(names).toEqual([...WEBMCP_REGISTERED_TOOL_NAMES]);
    expect(createCaseWebmcpTools("RV-1028").map((tool) => tool.name)).toEqual([
      ...WEBMCP_REGISTERED_TOOL_NAMES,
    ]);
    expect(registered.size).toBe(5);
    controller.abort();
    await waitFor(() => expect(registered.size).toBe(0));
  });

  it("tool schemas reject additional properties and omit high-risk tools", () => {
    for (const tool of createCaseWebmcpTools("RV-1028")) {
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.inputSchema.required).toContain("caseId");
    }
    const names = createCaseWebmcpTools("RV-1028").map((tool) => tool.name);
    expect(names).not.toContain("resolve_case");
    expect(names).not.toContain("promote_evidence");
  });
});
