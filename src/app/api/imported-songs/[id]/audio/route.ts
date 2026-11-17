import { NextRequest, NextResponse } from "next/server";

const API_URL = (process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api")
  .replace("localhost", "127.0.0.1")
  .replace(/\/$/, "");

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  try {
    const response = await fetch(`${API_URL}/imported-songs/${encodeURIComponent(id)}/audio`, {
      headers: request.headers.get("range") ? { Range: request.headers.get("range")! } : undefined,
      cache: "no-store",
    });
    const headers = new Headers();
    for (const name of ["Accept-Ranges", "Content-Length", "Content-Range", "Content-Type", "ETag"]) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }

    return new NextResponse(response.body, {
      status: response.status,
      headers,
    });
  } catch {
    return NextResponse.json({ error: "Imported audio is unavailable" }, { status: 502 });
  }
}
