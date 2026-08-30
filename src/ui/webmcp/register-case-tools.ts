export type WebmcpToolAnnotations = {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
};

export type WebmcpToolDescriptor = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: WebmcpToolAnnotations;
  execute: (
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ) => Promise<unknown>;
};

export type ModelContext = {
  registerTool: (
    tool: WebmcpToolDescriptor,
    options?: { signal?: AbortSignal },
  ) => Promise<void> | void;
};

export function getDocumentModelContext(
  doc: Document = document,
): ModelContext | null {
  const withContext = doc as Document & {
    modelContext?: ModelContext;
  };
  const nav = typeof navigator !== "undefined"
    ? (navigator as Navigator & { modelContext?: ModelContext })
    : undefined;
  return withContext.modelContext ?? nav?.modelContext ?? null;
}

export const WEBMCP_REGISTERED_TOOL_NAMES = [
  "resolvia_get_case",
  "resolvia_get_truth_graph",
  "resolvia_list_resolution_gaps",
  "resolvia_check_resolution_readiness",
  "resolvia_prepare_evidence_request",
] as const;

export type WebmcpInvokeResponse =
  | { ok: true; tool: string; result: unknown }
  | { ok: false; error: string; code: string };

/**
 * execute() always fetches CURRENT server state — never a React snapshot.
 */
export async function invokeWebmcpViaSameOrigin(
  tool: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<WebmcpInvokeResponse> {
  const response = await fetch("/api/webmcp/invoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tool, arguments: args }),
    credentials: "same-origin",
    ...(signal ? { signal } : {}),
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      ok: false,
      error: "Malformed tool response.",
      code: "INVALID_RESPONSE",
    };
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    !("ok" in payload) ||
    typeof (payload as { ok: unknown }).ok !== "boolean"
  ) {
    return {
      ok: false,
      error: "Malformed tool response.",
      code: "INVALID_RESPONSE",
    };
  }
  return payload as WebmcpInvokeResponse;
}

export function createCaseWebmcpTools(defaultCaseId: string): WebmcpToolDescriptor[] {
  const caseIdProperty = {
    type: "string",
    description:
      "Resolvia case id. Accepts display id RV-1028 or domain id case-*. Untrusted input; validated server-side.",
    minLength: 1,
    maxLength: 128,
  };

  return [
    {
      name: "resolvia_get_case",
      description:
        "Return a bounded deterministic case summary for one authorized Resolvia case. Call when the user asks for case status, blocker, or next action. Authority: deterministic case fields only — not Gemini narrative. Do not use to mutate or resolve the case.",
      inputSchema: {
        type: "object",
        properties: { caseId: caseIdProperty },
        required: ["caseId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async (args, options) =>
        invokeWebmcpViaSameOrigin(
          "resolvia_get_case",
          { caseId: typeof args.caseId === "string" ? args.caseId : defaultCaseId },
          options?.signal,
        ),
    },
    {
      name: "resolvia_get_truth_graph",
      description:
        "Return bounded Truth Graph facts for one authorized case, preserving Claim != Evidence. Call when the user asks what is known, verified, unverified, or missing. Do not reinterpret evidence provenance. Read-only.",
      inputSchema: {
        type: "object",
        properties: { caseId: caseIdProperty },
        required: ["caseId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async (args, options) =>
        invokeWebmcpViaSameOrigin(
          "resolvia_get_truth_graph",
          { caseId: typeof args.caseId === "string" ? args.caseId : defaultCaseId },
          options?.signal,
        ),
    },
    {
      name: "resolvia_list_resolution_gaps",
      description:
        "Explain structured gaps that prevent deterministic resolution. Call when the user asks what is missing. Returns gap objects, not prose-only. Read-only; does not send requests.",
      inputSchema: {
        type: "object",
        properties: { caseId: caseIdProperty },
        required: ["caseId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async (args, options) =>
        invokeWebmcpViaSameOrigin(
          "resolvia_list_resolution_gaps",
          { caseId: typeof args.caseId === "string" ? args.caseId : defaultCaseId },
          options?.signal,
        ),
    },
    {
      name: "resolvia_check_resolution_readiness",
      description:
        "Return the deterministic Resolution Readiness projection (requirements satisfied / missing / blocked). Call for questions like 'Can this case be resolved yet?'. Not an ML confidence score. Read-only; does not resolve the case.",
      inputSchema: {
        type: "object",
        properties: { caseId: caseIdProperty },
        required: ["caseId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async (args, options) =>
        invokeWebmcpViaSameOrigin(
          "resolvia_check_resolution_readiness",
          { caseId: typeof args.caseId === "string" ? args.caseId : defaultCaseId },
          options?.signal,
        ),
    },
    {
      name: "resolvia_prepare_evidence_request",
      description:
        "Prepare a human-reviewable draft for ONE currently unresolved evidence requirement. Call only after identifying a MISSING requirement. Returns requiresHumanApproval=true. MUST NOT send email, call providers, mutate evidence, transition the case, or issue refunds. Do not use for contradictions.",
      inputSchema: {
        type: "object",
        properties: {
          caseId: caseIdProperty,
          target: {
            type: "string",
            enum: ["PROVIDER", "PARTNER", "CUSTOMER"],
            description: "Intended recipient of the draft request.",
          },
          requirementId: {
            type: "string",
            enum: [
              "provider_transaction_verified",
              "customer_receipt_confirmation",
              "contradictions_resolved",
            ],
            description:
              "Requirement id from Resolution Readiness. Must be currently unresolved and actionable.",
          },
        },
        required: ["caseId", "target", "requirementId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async (args, options) =>
        invokeWebmcpViaSameOrigin(
          "resolvia_prepare_evidence_request",
          {
            caseId:
              typeof args.caseId === "string" ? args.caseId : defaultCaseId,
            target: args.target,
            requirementId: args.requirementId,
          },
          options?.signal,
        ),
    },
  ];
}

export async function registerCaseWebmcpTools(input: {
  modelContext: ModelContext;
  defaultCaseId: string;
  signal: AbortSignal;
  onError?: (error: unknown) => void;
}): Promise<string[]> {
  const tools = createCaseWebmcpTools(input.defaultCaseId);
  const registered: string[] = [];
  for (const tool of tools) {
    if (input.signal.aborted) break;
    try {
      await input.modelContext.registerTool(tool, { signal: input.signal });
      registered.push(tool.name);
    } catch (error) {
      input.onError?.(error);
      throw error;
    }
  }
  return registered;
}
