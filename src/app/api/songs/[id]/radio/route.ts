import { NextRequest, NextResponse } from "next/server";
import { songs } from "@/lib/catalog";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const limit = Math.min(50, Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? 20) || 20));
  const seedIndex = songs.findIndex((song) => song.id === id);
  
  // If the song is not in the hardcoded catalog, use the first song as seed fallback so S3 tracks don't 404
  const seed = seedIndex >= 0 ? songs[seedIndex] : songs[0];
  const related = songs.filter((song) => song.genre === seed.genre && song.id !== id);
  const discovery = songs.filter((song) => song.id !== id && !related.some((relatedSong) => relatedSong.id === song.id));
  
  return NextResponse.json({ source: "demo-radio", data: [...related, ...discovery].slice(0, limit) });
}
