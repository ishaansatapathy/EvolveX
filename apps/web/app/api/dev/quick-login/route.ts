import { type NextRequest, NextResponse } from "next/server";

import { appendProxiedSetCookies } from "~/lib/proxied-set-cookie";

const API_BASE = process.env.API_INTERNAL_URL ?? "http://localhost:8000";

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(`${API_BASE}/auth/dev/quick-login`, {
      redirect: "manual",
      headers: {
        cookie: request.headers.get("cookie") ?? "",
      },
    });
  } catch {
    return NextResponse.redirect(
      new URL("/signin?error=Evolvex+API+is+not+running.+Run+pnpm+dev", request.url),
    );
  }

  const location = upstreamRes.headers.get("location");
  const response = location
    ? NextResponse.redirect(location)
    : new NextResponse(upstreamRes.body, { status: upstreamRes.status });

  appendProxiedSetCookies(response.headers, upstreamRes.headers);
  return response;
}
