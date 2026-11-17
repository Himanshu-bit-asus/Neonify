import { NextRequest } from "next/server";

/**
 * Development-only audio stream. Production requests are authorized by the API
 * and redirected to a short-lived CDN URL for the song's HLS master playlist.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sampleRate = 8000;
  const seconds = 220;
  const samples = sampleRate * seconds;
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, value: string) => Array.from(value).forEach((char, index) => bytes[offset + index] = char.charCodeAt(0));
  write(0, "RIFF"); view.setUint32(4, 36 + samples, true); write(8, "WAVEfmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true); view.setUint16(34, 8, true); write(36, "data"); view.setUint32(40, samples, true);
  // A quiet, generative preview avoids bundling unlicensed audio in the starter.
  const seed = id.split("").reduce((total, char) => total + char.charCodeAt(0), 0);
  const base = 172 + (seed % 5) * 22;
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const envelope = 0.13 + 0.08 * Math.sin((Math.PI * t) / 3) ** 2;
    const signal = Math.sin(2 * Math.PI * base * t) * .62 + Math.sin(2 * Math.PI * base * 1.5 * t) * .24 + Math.sin(2 * Math.PI * base * .5 * t) * .14;
    bytes[44 + i] = Math.max(0, Math.min(255, Math.round(128 + signal * 127 * envelope)));
  }
  return new Response(bytes, { headers: { "Content-Type": "audio/wav", "Content-Length": String(bytes.byteLength), "Cache-Control": "public, max-age=3600", "X-Streamify-Demo": "true" } });
}
