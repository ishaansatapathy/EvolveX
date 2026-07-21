import { type NextRequest, NextResponse } from "next/server";

import { appendProxiedSetCookies } from "~/lib/proxied-set-cookie";

const API_BASE = process.env.API_INTERNAL_URL ?? "http://localhost:8000";

export const maxDuration = 60;

function buildUpstreamHeaders(request: NextRequest): Headers {
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  const origin = request.headers.get("origin");
  if (origin) headers.set("origin", origin);
  const referer = request.headers.get("referer");
  if (referer) headers.set("referer", referer);
  if (cookie && request.method !== "GET" && request.method !== "HEAD") {
    headers.set("x-evolvex-csrf", "1");
  }
  const accept = request.headers.get("accept");
  if (accept) headers.set("accept", accept);
  headers.set("accept-encoding", "identity");
  return headers;
}

async function proxyTrpc(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const pathname = path.join("/");
  const upstream = `${API_BASE}/trpc/${pathname}${request.nextUrl.search}`;
  const headers = buildUpstreamHeaders(request);

  const body =
    request.method !== "GET" && request.method !== "HEAD" ? await request.arrayBuffer() : undefined;

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstream, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    return NextResponse.json(
      {
        error: {
          message: "Evolvex API is waking up — please try again in a few seconds.",
          code: -32004,
        },
      },
      { status: 503 },
    );
  }

  const bodyText = await upstreamRes.text();
  const contentType = upstreamRes.headers.get("content-type") ?? "application/json";

  let response: NextResponse;
  if (contentType.includes("application/json")) {
    try {
      response = NextResponse.json(JSON.parse(bodyText) as unknown, {
        status: upstreamRes.status,
        statusText: upstreamRes.statusText,
      });
    } catch {
      response = new NextResponse(bodyText, {
        status: upstreamRes.status,
        statusText: upstreamRes.statusText,
        headers: { "content-type": contentType },
      });
    }
  } else {
    response = new NextResponse(bodyText, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: { "content-type": contentType },
    });
  }

  response.headers.set("Cache-Control", "no-store, no-transform");
  response.headers.delete("content-encoding");
  appendProxiedSetCookies(response.headers, upstreamRes.headers);
  return response;
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyTrpc(request, context);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyTrpc(request, context);
}
