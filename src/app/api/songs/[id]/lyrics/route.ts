import { NextRequest, NextResponse } from "next/server";

const API_URL = (process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api")
  .replace("localhost", "127.0.0.1")
  .replace(/\/$/, "");

type RouteContext = { params: Promise<{ id: string }> };

async function proxyLyricsRequest(
  request: NextRequest,
  { params }: RouteContext,
  method: "GET" | "POST",
) {
  const { id } = await params;
  const authorization = request.headers.get("authorization");
  try {
    const response = await fetch(`${API_URL}/songs/${encodeURIComponent(id)}/lyrics${method === "POST" ? "/transcribe" : ""}`, {
      method,
      cache: "no-store",
      headers: {
        ...(authorization ? { Authorization: authorization } : {}),
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body: await request.text() } : {}),
    });

    return new NextResponse(response.body, {
      status: response.status,
      headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "Lyrics API unavailable" }, { status: 502 });
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  return proxyLyricsRequest(request, context, "GET");
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxyLyricsRequest(request, context, "POST");
}
