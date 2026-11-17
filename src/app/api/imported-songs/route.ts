import { NextRequest, NextResponse } from "next/server";

const API_URL = (process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api")
  .replace("localhost", "127.0.0.1")
  .replace(/\/$/, "");

export async function GET(request: NextRequest) {
  try {
    const response = await fetch(`${API_URL}/imported-songs${request.nextUrl.search}`, {
      cache: "no-store",
    });
    const payload = await response.json() as { data?: Array<Record<string, unknown>>; nextCursor?: string | null };
    const data = (payload.data ?? []).map((song) => ({
      ...song,
      audioUrl: typeof song.id === "string" ? `/api/imported-songs/${encodeURIComponent(song.id)}/audio` : null,
    }));

    return NextResponse.json({ ...payload, data }, { status: response.status });
  } catch (error) {
    console.error("Failed to load imported songs from API:", error);
    return NextResponse.json({ error: "Imported songs API unavailable", data: [] }, { status: 502 });
  }
}
