import { invokeWebmcpTool } from "@/src/application/webmcp/invoke-tool";
import { getRequestIdentity } from "@/src/infrastructure/auth/get-request-identity";
import {
  ConnectedConfigurationError,
  getRuntimeConfig,
} from "@/src/infrastructure/google/runtime-config";
import {
  ConnectedPersistenceUnavailableError,
  getResolutionStoreForRuntime,
} from "@/src/infrastructure/runtime/get-resolution-store-for-runtime";
import { seedDemoCase } from "@/src/application/cases/seed-demo-case";
import { RV_1028_CASE_ID } from "@/src/demo/rv-1028";
import { normalizeWebmcpCaseId } from "@/src/application/webmcp/schemas";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let runtime;
  try {
    runtime = getRuntimeConfig(process.env);
  } catch (error) {
    if (error instanceof ConnectedConfigurationError) {
      return Response.json(
        { ok: false, error: "Service unavailable.", code: "UNAVAILABLE" },
        { status: 503 },
      );
    }
    throw error;
  }

  const identity = await getRequestIdentity(runtime);
  if (!identity) {
    return Response.json(
      { ok: false, error: "Sign in required.", code: "UNAUTHORIZED" },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Malformed JSON body.", code: "INVALID_INPUT" },
      { status: 400 },
    );
  }

  try {
    const store = getResolutionStoreForRuntime(runtime);
    if (
      runtime.mode === "LOCAL" &&
      body &&
      typeof body === "object" &&
      "arguments" in body &&
      body.arguments &&
      typeof body.arguments === "object" &&
      "caseId" in body.arguments &&
      typeof (body.arguments as { caseId: unknown }).caseId === "string"
    ) {
      try {
        const domainCaseId = normalizeWebmcpCaseId(
          (body.arguments as { caseId: string }).caseId,
        );
        if (domainCaseId === RV_1028_CASE_ID) {
          await seedDemoCase(store);
        }
      } catch {
        // Invalid case IDs are handled by invokeWebmcpTool.
      }
    }

    const result = await invokeWebmcpTool({ store, identity, body });
    if (!result.ok) {
      return Response.json(
        { ok: false, error: result.error, code: result.code },
        { status: result.status },
      );
    }
    return Response.json({
      ok: true,
      tool: result.tool,
      result: result.result,
    });
  } catch (error) {
    if (error instanceof ConnectedPersistenceUnavailableError) {
      return Response.json(
        { ok: false, error: "Service unavailable.", code: "UNAVAILABLE" },
        { status: 503 },
      );
    }
    throw error;
  }
}
