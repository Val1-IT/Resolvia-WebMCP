import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { CSRF_COOKIE_NAME } from "@/src/infrastructure/auth/get-request-identity";
import { getRuntimeConfig } from "@/src/infrastructure/google/runtime-config";

export function GET(): Response {
  try {
    const runtime = getRuntimeConfig(process.env);
    if (runtime.mode !== "CONNECTED" || !runtime.webUrl) {
      return Response.json({ error: "AUTH_CONFIGURATION_UNAVAILABLE" }, { status: 503 });
    }
    const token = randomBytes(32).toString("base64url");
    const response = NextResponse.json({ csrfToken: token });
    response.cookies.set(CSRF_COOKIE_NAME, token, {
      httpOnly: true,
      secure: runtime.webUrl.startsWith("https://"),
      sameSite: "lax",
      path: "/",
      maxAge: 10 * 60,
    });
    response.headers.set("cache-control", "no-store");
    return response;
  } catch {
    return Response.json({ error: "AUTH_CONFIGURATION_UNAVAILABLE" }, { status: 503 });
  }
}