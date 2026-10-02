import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  if (request.method !== "OPTIONS") return NextResponse.next();

  const origin = process.env.CORS_ORIGIN ?? "http://localhost:3000";
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Request-Id",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      Vary: "Origin",
    },
  });
}

export const config = {
  matcher: "/api/:path*",
};
