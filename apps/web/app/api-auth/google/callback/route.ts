import { type NextRequest, NextResponse } from "next/server";

import { appendProxiedSetCookies } from "~/lib/proxied-set-cookie";

const API_BASE = process.env.API_INTERNAL_URL ?? "http://localhost:8000";

export async function GET(request: NextRequest) {
  const upstream = `${API_BASE}/auth/google/callback${request.nextUrl.search}`;

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstream, {
      redirect: "manual",
      headers: {
        cookie: request.headers.get("cookie") ?? "",
      },
    });
  } catch {
    const signInUrl = new URL("/signin", request.url);
    signInUrl.searchParams.set(
      "error",
      "Evolvex API is not running. Run pnpm dev from evolvex/ and try again.",
    );
    return NextResponse.redirect(signInUrl);
  }

  const location = upstreamRes.headers.get("location");
  const response = location
    ? NextResponse.redirect(location)
    : new NextResponse(upstreamRes.body, { status: upstreamRes.status });

  appendProxiedSetCookies(response.headers, upstreamRes.headers);
  return response;
}
