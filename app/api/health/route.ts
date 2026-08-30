import {
  ConnectedConfigurationError,
  getRuntimeConfig,
} from "@/src/infrastructure/google/runtime-config";

export function GET(): Response {
  try {
    const runtime = getRuntimeConfig(process.env);
    return Response.json({
      mode: runtime.mode,
      revision: process.env.K_REVISION ?? null,
      firestoreReady:
        runtime.mode === "CONNECTED" && Boolean(runtime.firestoreDatabase),
      pubsubReady: runtime.mode === "CONNECTED" && Boolean(runtime.topicName),
    });
  } catch (error) {
    if (error instanceof ConnectedConfigurationError) {
      return Response.json(
        {
          mode: "CONNECTED",
          revision: process.env.K_REVISION ?? null,
          firestoreReady: false,
          pubsubReady: false,
        },
        { status: 503 },
      );
    }
    return new Response(null, { status: 503 });
  }
}