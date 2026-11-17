import { NextRequest, NextResponse } from "next/server";

const API_URL = (process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api")
  .replace("localhost", "127.0.0.1")
  .replace(/\/$/, "");

export async function GET(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  try {
    const response = await fetch(`${API_URL}/leaderboard/my-stats`, {
      cache: "no-store",
      headers: authorization ? { Authorization: authorization } : undefined,
    });

    return new NextResponse(response.body, {
      status: response.status,
      headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "Leaderboard API unavailable" }, { status: 502 });
  }
}