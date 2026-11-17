import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const API_URL = (process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api")
  .replace("localhost", "127.0.0.1")
  .replace(/\/$/, "");

const eventSchema = z.object({
  songId: z.string().min(1).max(256),
  playDurationSeconds: z.number().min(0).max(60 * 60),
  completed: z.boolean().default(false),
});

export async function POST(request: NextRequest) {
  const bodyText = await request.text().catch(() => "{}");
  let bodyJson: Record<string, unknown> = {};
  try {
    bodyJson = JSON.parse(bodyText);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = eventSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid listening event" }, { status: 400 });
  }

  const authorization = request.headers.get("authorization");

  // If user is authenticated, forward to backend Fastify server to record DB & Redis stats
  if (authorization) {
    try {
      const response = await fetch(`${API_URL}/listening-events`, {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(parsed.data),
        cache: "no-store",
      });

      if (response.ok) {
        const data = await response.json().catch(() => ({ accepted: true }));
        return NextResponse.json(data, { status: response.status });
      }
    } catch {
      // Fall through to anonymous acceptance
    }
  }

  return NextResponse.json({ accepted: true, event: parsed.data }, { status: 202 });
}
