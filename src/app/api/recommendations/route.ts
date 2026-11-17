import { NextRequest, NextResponse } from "next/server";
import { songs } from "@/lib/catalog";

export async function GET(request: NextRequest) {
  const seedId = request.nextUrl.searchParams.get("seed");
  const seed = songs.find((song) => song.id === seedId);
  const sameGenre = seed ? songs.filter((song) => song.genre === seed.genre && song.id !== seed.id) : [];
  const discovery = songs.filter((candidate) => candidate.id !== seedId && !sameGenre.some((song) => song.id === candidate.id));
  const data = [...sameGenre, ...discovery].slice(0, 6);
  return NextResponse.json({ source: seed ? "demo-radio" : "cold-start-popular", expiresInSeconds: 86400, data });
}
