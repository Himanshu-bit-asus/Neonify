import { config as loadEnv } from "dotenv";
import crypto from "crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import fastifyJwt from "@fastify/jwt";
import rawBody from "fastify-raw-body";
import { Prisma, PrismaClient, Role, PlanTier, SongStatus, FeedEventType, TrophyType } from "@prisma/client";
import { Queue } from "bullmq";
import Redis from "ioredis";
import { S3Client, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, NoSuchKey, PutObjectCommand, type GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";
import { Counter, Registry, collectDefaultMetrics } from "prom-client";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { verifyWebhook } from "@clerk/backend/webhooks";
import Razorpay from "razorpay";

// Local development keeps configuration in the repository-root .env file;
// Docker injects the same values through the service environment.
loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });
const rootDatabaseUrl = process.env.DATABASE_URL;
// The API package also has its own deployment environment. Load it last so
// service-specific storage credentials take precedence over root fallbacks.
loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env"), override: true });
if (process.env.NODE_ENV !== "production" && rootDatabaseUrl) {
  process.env.DATABASE_URL = rootDatabaseUrl;
}

const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;
const razorpay = razorpayKeyId && razorpayKeySecret
  ? new Razorpay({ key_id: razorpayKeyId, key_secret: razorpayKeySecret })
  : null;

const db = new PrismaClient();
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const transcodeQueue = new Queue("transcode", { connection: { url: redisUrl } });
const radioCache = new (Redis as any)(redisUrl, { connectTimeout: 1_000, maxRetriesPerRequest: 1 });
// A cache outage must not stop playback; requests transparently fall through
// to the recommendation service and database.
radioCache.on("error", () => undefined);
const storageAccessKey = process.env.SUPABASE_STORAGE_ACCESS_KEY ?? process.env.supabase_storage_access_key ?? process.env.S3_ACCESS_KEY;
const storageSecretKey = process.env.SUPABASE_STORAGE_SECRET_KEY ?? process.env.supabase_storage_secret_key ?? process.env.S3_SECRET_KEY;
const supabaseStorageConfigured = Boolean(
  (process.env.SUPABASE_STORAGE_URL ?? process.env.supabase_storage_url)
  && (process.env.SUPABASE_STORAGE_ACCESS_KEY ?? process.env.supabase_storage_access_key)
  && (process.env.SUPABASE_STORAGE_SECRET_KEY ?? process.env.supabase_storage_secret_key),
);
const storage = new S3Client({
  region: process.env.SUPABASE_REGION ?? process.env.S3_REGION ?? "us-east-1",
  endpoint: process.env.SUPABASE_STORAGE_URL ?? process.env.supabase_storage_url ?? process.env.S3_ENDPOINT,
  forcePathStyle: Boolean(process.env.SUPABASE_STORAGE_URL ?? process.env.supabase_storage_url ?? process.env.S3_ENDPOINT),
  credentials: storageAccessKey
    ? { accessKeyId: storageAccessKey, secretAccessKey: storageSecretKey ?? "" }
    : undefined,
});
const legacyStorage = new S3Client({
  region: process.env.S3_REGION ?? "us-east-1",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: Boolean(process.env.S3_ENDPOINT),
  credentials: process.env.S3_ACCESS_KEY
    ? { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY ?? "" }
    : undefined,
});
// Supabase S3-compatible storage client (service role only on backend)
const supabaseStorage = new S3Client({
  region: process.env.SUPABASE_REGION ?? process.env.S3_REGION ?? "ap-south-1",
  endpoint: process.env.SUPABASE_STORAGE_URL ?? process.env.supabase_storage_url,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.SUPABASE_STORAGE_ACCESS_KEY ?? process.env.supabase_storage_access_key ?? "",
    secretAccessKey: process.env.SUPABASE_STORAGE_SECRET_KEY ?? process.env.supabase_storage_secret_key ?? "",
  },
});
const AUDIO_BUCKET = process.env.AUDIO_BUCKET
  ?? (supabaseStorageConfigured ? "song-audio" : process.env.S3_BUCKET ?? "streamify-media");
const IMPORTED_AUDIO_BUCKET = process.env.IMPORTED_AUDIO_BUCKET ?? "Songs";
const LEGACY_AUDIO_BUCKET = process.env.S3_BUCKET ?? "streamify-media";
const COVER_BUCKET = process.env.COVER_BUCKET
  ?? (supabaseStorageConfigured ? "covers" : process.env.S3_BUCKET ?? "streamify-media");
const importedAudioKeys = new Map<string, string>();
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info", redact: ["req.headers.authorization", "req.headers.cookie"] } });
const metrics = new Registry();
collectDefaultMetrics({ register: metrics, prefix: "streamify_api_" });
const requestCount = new Counter({ name: "streamify_api_requests_total", help: "HTTP requests completed", labelNames: ["method", "route", "status"] as const, registers: [metrics] });
app.addHook("onResponse", (request, reply, done) => { requestCount.inc({ method: request.method, route: request.routeOptions.url ?? "unmatched", status: String(reply.statusCode) }); done(); });
const clerkJwks = process.env.CLERK_JWKS_URL ? createRemoteJWKSet(new URL(process.env.CLERK_JWKS_URL)) : null;
const clerkAudience = process.env.CLERK_AUDIENCE?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
const defaultClerkAuthorizedParties = new Set([
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:3003",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://127.0.0.1:3002",
  "http://127.0.0.1:3003",
  "https://localhost:3000",
  "https://localhost:3001",
  "https://localhost:3002",
  "https://localhost:3003",
  "https://127.0.0.1:3000",
  "https://127.0.0.1:3001",
  "https://127.0.0.1:3002",
  "https://127.0.0.1:3003",
]);
const clerkAuthorizedParties = new Set([
  ...defaultClerkAuthorizedParties,
  ...(process.env.CLERK_AUTHORIZED_PARTIES?.split(",").map((value) => value.trim()).filter(Boolean) ?? []),
]);

type AuthUser = { id: string; role: Role; plan: PlanTier; planExpiresAt: Date | null };
type RequestWithAuth = FastifyRequest & { auth: AuthUser };
const apiError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const LIKED_SONGS_PLAYLIST_NAME = "Liked Songs";

async function ensureLikedSongsPlaylist(tx: Prisma.TransactionClient, userId: string, songId: string) {
  const existingPlaylist = await tx.playlist.findFirst({
    where: { userId, name: LIKED_SONGS_PLAYLIST_NAME },
    orderBy: { createdAt: "asc" },
  });
  const playlist = existingPlaylist ?? await tx.playlist.create({
    data: { userId, name: LIKED_SONGS_PLAYLIST_NAME, description: "Songs you have liked" },
  });

  const existingSong = await tx.playlistSong.findUnique({
    where: { playlistId_songId: { playlistId: playlist.id, songId } },
  });
  if (!existingSong) {
    const maxPosition = await tx.playlistSong.aggregate({
      where: { playlistId: playlist.id },
      _max: { position: true },
    });
    await tx.playlistSong.create({
      data: {
        playlistId: playlist.id,
        songId,
        position: (maxPosition._max.position ?? -1) + 1,
      },
    });
  }

  return playlist;
}

// --- Feed SSE State ---
const feedClients = new Set<{ userId: string, reply: any }>();

function formatFeedEvent(event: any) {
  return {
    id: event.id.toString(),
    actor: {
      id: event.actor.id,
      displayName: event.actor.displayName,
      avatarUrl: event.actor.avatarUrl,
    },
    type: event.type,
    song: event.song ? publicSong(event.song) : null,
    createdAt: event.createdAt.toISOString()
  };
}

async function broadcastFeedEvent(event: any) {
  try {
    const formatted = formatFeedEvent(event);
    const followers = await db.follow.findMany({
      where: { followeeId: event.actorId },
      select: { followerId: true }
    });
    const followerIds = new Set(followers.map(f => f.followerId));
    // Include actor so they can see their own actions in realtime if desired
    followerIds.add(event.actorId);
    
    const payload = `data: ${JSON.stringify(formatted)}\n\n`;
    for (const client of feedClients) {
      if (followerIds.has(client.userId)) {
        client.reply.raw.write(payload);
      }
    }
  } catch (err) {
    console.error("Feed broadcast error:", err);
  }
}


const allowedCorsOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:3003")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

await app.register(cors, { origin: allowedCorsOrigins, credentials: true });
await app.register(helmet);
await app.register(fastifyJwt, { secret: process.env.JWT_ACCESS_SECRET ?? "local-development-secret-change-me" });
await app.register(rawBody, { global: false, encoding: false, runFirst: true });

function stringClaim(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function clerkProfileFromToken(payload: Record<string, unknown>) {
  const displayName = stringClaim(payload, "name") ?? stringClaim(payload, "username");
  return { displayName, email: stringClaim(payload, "email") };
}

async function authenticate(request: FastifyRequest) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) throw apiError(401, "Bearer token required");
  if (clerkJwks) {
    try {
      const { payload } = await jwtVerify(token, clerkJwks, {
        algorithms: ["RS256"],
        ...(process.env.CLERK_ISSUER ? { issuer: process.env.CLERK_ISSUER } : {}),
        ...(clerkAudience.length ? { audience: clerkAudience } : {}),
      });
      if (!payload.sub) throw apiError(401, "Clerk token missing a subject");
      const authorizedParty = stringClaim(payload, "azp");
      if (clerkAuthorizedParties.size && (!authorizedParty || !clerkAuthorizedParties.has(authorizedParty))) {
        const normalizedParty = authorizedParty ? authorizedParty.replace(/\/+$/, "").toLowerCase() : null;
        const isTrustedDevOrigin = normalizedParty
          ? [...clerkAuthorizedParties].some((origin) => origin.replace(/\/+$/, "").toLowerCase() === normalizedParty)
          : false;
        if (!isTrustedDevOrigin) throw apiError(401, "Clerk token was issued for an untrusted origin");
      }
      const { displayName, email } = clerkProfileFromToken(payload);
      const profile = await db.user.upsert({
        where: { clerkId: payload.sub },
        create: { clerkId: payload.sub, displayName: displayName ?? "Listener", email },
        update: { ...(displayName ? { displayName } : {}), ...(email ? { email } : {}) },
        select: { id: true, role: true, plan: true, planExpiresAt: true },
      });
      (request as RequestWithAuth).auth = profile;
      return;
    } catch (err: any) {
      if (err.statusCode === 401 || err.statusCode === 403) throw err;
      // Fallback to internal fastify-jwt verification for local JWTs
    }
  }
  const payload = await request.jwtVerify<{ sub: string }>();
  const user = await db.user.findUnique({ where: { id: payload.sub }, select: { id: true, role: true, plan: true, planExpiresAt: true } });
  if (!user) throw apiError(401, "Account was not found");
  (request as RequestWithAuth).auth = user;
}

function requireRole(role: Role) {
  return async (request: FastifyRequest) => {
    await authenticate(request);
    const user = (request as RequestWithAuth).auth;
    if (user.role !== role && user.role !== Role.ADMIN) throw apiError(403, "Creator access required");
  };
}

type ClerkUserPayload = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  image_url?: string | null;
  primary_email_address_id?: string | null;
  email_addresses?: Array<{ id: string; email_address: string }>;
  primary_phone_number_id?: string | null;
  phone_numbers?: Array<{ id: string; phone_number: string }>;
};

function profileFromClerkWebhook(user: ClerkUserPayload) {
  const email = user.email_addresses?.find((entry) => entry.id === user.primary_email_address_id)?.email_address;
  const phone = user.phone_numbers?.find((entry) => entry.id === user.primary_phone_number_id)?.phone_number;
  const fullName = [user.first_name, user.last_name].filter((part): part is string => Boolean(part?.trim())).join(" ");
  return {
    email: email ?? null,
    phone: phone ?? null,
    displayName: user.username?.trim() || fullName || email?.split("@")[0] || "Listener",
    avatarUrl: user.image_url ?? null,
  };
}

function requestForWebhookVerification(request: FastifyRequest) {
  if (!request.rawBody) throw apiError(400, "Webhook body is required");
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) value.forEach((entry) => headers.append(name, entry));
    else if (value !== undefined) headers.set(name, value);
  }
  const host = request.headers.host ?? "localhost";
  return new Request(`http://${host}${request.url}`, { method: request.method, headers, body: request.rawBody.toString() });
}

function publicSong(song: { id: string; title: string; artistName: string; album: string | null; genre: string; durationSeconds: number | null; coverArtKey: string | null; playCount: bigint; likeCount: number; creator: { displayName: string; avatarUrl: string | null } }) {
  return { ...song, playCount: song.playCount.toString(), artist: song.artistName, coverArtUrl: song.coverArtKey ? `/api/songs/${song.id}/cover` : null };
}

app.get("/healthz", async () => ({ status: "ok", service: "streamify-api" }));
app.get("/readyz", async () => { await db.$queryRaw`SELECT 1`; return { status: "ready" }; });
app.get("/metrics", async (_request, reply) => { reply.header("Content-Type", metrics.contentType); return metrics.metrics(); });

const importedAudioExtensions = new Set(["mp3", "m4a", "wav", "flac", "ogg", "aac", "mp4", "webm", "mpeg", "mpga"]);

app.get("/api/imported-songs", async (request) => {
  const { cursor, limit } = z.object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(50),
  }).parse(request.query);
  const page = await storage.send(new ListObjectsV2Command({
    Bucket: IMPORTED_AUDIO_BUCKET,
    MaxKeys: limit,
    ...(cursor ? { ContinuationToken: cursor } : {}),
  }));
  const data = [];
  for (const object of page.Contents ?? []) {
    if (!object.Key) continue;
    const extension = object.Key.split(".").pop()?.toLowerCase() ?? "";
    if (!importedAudioExtensions.has(extension)) {
      if (extension === "ts" || extension === "m3u8") continue;
      const metadata = await storage.send(new HeadObjectCommand({
        Bucket: IMPORTED_AUDIO_BUCKET,
        Key: object.Key,
      }));
      if (!metadata.ContentType?.startsWith("audio/")) continue;
    }

    const id = `s3-${crypto.createHash("sha256").update(object.Key).digest("hex")}`;
    importedAudioKeys.set(id, object.Key);
    const fileName = object.Key.split("/").pop()!.replace(/\.[^.]+$/, "");
    const normalizedName = fileName.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
    const cleanName = normalizedName.replace(/^\d{1,3}\s*[-_.]\s*/, "");
    const nameParts = cleanName.split(" - ").map((part) => part.trim()).filter(Boolean);
    if (nameParts.length > 1 && /^[\w-]+\.[a-z]{2,}$/i.test(nameParts[nameParts.length - 1])) {
      nameParts.pop();
    }
    const hasArtist = nameParts.length > 1;
    const artistName = hasArtist ? nameParts.shift()! : "S3 Library";
    const title = nameParts.join(" - ").trim() || cleanName;
    const knownHipHopArtist = /\b(badshah|raftaar|divine|emiway|honey singh|ikka|seedhe maut|mc stan|raja kumari|bohemia)\b/i.test(`${artistName} ${title} ${object.Key}`)
      || artistName.trim().toLowerCase() === "king";
    const knownIndieArtist = /\b(goldie sohel|gurnazar|shae gill|ishaan khan|kuhu gracia|armaan malik)\b/i.test(artistName);
    const knownChillTrack = /\b(unplugged|acoustic|lo[- ]?fi|ambient|chill|sleep|calm|soothing)\b/i.test(title)
      || /\b(shaam|saanvarey|sun maahi|humnava mere|sukoon|baarish(?:on)? mein|baarish ki jaaye)\b/i.test(title);
    const knownRockTrack = /\bkaawaa kaawaa\b/i.test(title);
    const genre = knownHipHopArtist ? "Hip-Hop" : knownIndieArtist ? "Indie" : knownChillTrack ? "Chill" : knownRockTrack ? "Rock" : "Bollywood & Regional";

    data.push({
      id,
      title,
      artist: artistName.trim() || "Unknown artist",
      album: "Imported music",
      genre,
      durationSeconds: null,
      playCount: "0",
      coverArtUrl: null,
      audioUrl: `${request.protocol}://${request.headers.host}/api/imported-songs/${id}/audio`,
      isImported: true,
    });
  }

  return {
    data,
    nextCursor: page.IsTruncated ? page.NextContinuationToken ?? null : null,
  };
});

app.get("/api/imported-songs/:songId/audio", async (request, reply) => {
  const { songId } = z.object({
    songId: z.string().regex(/^s3-[a-f0-9]{64}$/),
  }).parse(request.params);
  const key = importedAudioKeys.get(songId);
  if (!key) throw apiError(404, "Imported audio is not in the current catalog");

  const range = request.headers.range;
  const audio = await storage.send(new GetObjectCommand({
    Bucket: IMPORTED_AUDIO_BUCKET,
    Key: key,
    ...(range ? { Range: range } : {}),
  }));
  reply.code(audio["$metadata"].httpStatusCode ?? 200);
  reply.header("Content-Type", audio.ContentType ?? "audio/mpeg");
  reply.header("Accept-Ranges", audio.AcceptRanges ?? "bytes");
  if (audio.ContentLength !== undefined) reply.header("Content-Length", audio.ContentLength);
  if (audio.ContentRange) reply.header("Content-Range", audio.ContentRange);
  if (audio.ETag) reply.header("ETag", audio.ETag);
  return reply.send(audio.Body);
});

app.post("/webhooks/clerk", { config: { rawBody: true } }, async (request, reply) => {
  if (!process.env.CLERK_WEBHOOK_SIGNING_SECRET) {
    request.log.error("CLERK_WEBHOOK_SIGNING_SECRET is not configured");
    return reply.code(503).send({ error: "Clerk webhooks are not configured" });
  }

  try {
    const event = await verifyWebhook(requestForWebhookVerification(request));
    if (event.type === "user.created" || event.type === "user.updated") {
      const user = event.data as ClerkUserPayload;
      const profile = profileFromClerkWebhook(user);
      await db.user.upsert({
        where: { clerkId: user.id },
        create: { clerkId: user.id, ...profile },
        update: profile,
      });
    } else if (event.type === "user.deleted") {
      await db.user.deleteMany({ where: { clerkId: event.data.id } });
    }

    request.log.info({ deliveryId: request.headers["svix-id"], eventType: event.type }, "Processed Clerk webhook");
    return reply.code(204).send();
  } catch (error) {
    request.log.warn({ err: error }, "Rejected Clerk webhook");
    return reply.code(400).send({ error: "Invalid Clerk webhook" });
  }
});

app.get("/api/songs", async (request) => {
  const query = z.object({ q: z.string().max(120).optional(), genre: z.string().max(60).optional(), cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(50).default(24) }).parse(request.query);
  const where = {
    isPublished: true,
    status: SongStatus.READY,
    AND: [
      { OR: [{ masterAudioKey: { not: null } }, { hlsMasterKey: { not: null } }] },
      ...(query.q ? [{ OR: [{ title: { contains: query.q, mode: "insensitive" as const } }, { artistName: { contains: query.q, mode: "insensitive" as const } }, { album: { contains: query.q, mode: "insensitive" as const } }, { genre: { contains: query.q, mode: "insensitive" as const } }] }] : []),
    ],
    ...(query.genre ? { genre: { equals: query.genre, mode: "insensitive" as const } } : {}),
  };
  const results = await db.song.findMany({ where, take: query.limit + 1, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}), orderBy: { createdAt: "desc" }, include: { creator: { select: { displayName: true, avatarUrl: true } } } });
  const hasNext = results.length > query.limit;
  return { data: results.slice(0, query.limit).map(publicSong), nextCursor: hasNext ? results[query.limit - 1]?.id : null };
});

app.get("/api/home", async () => {
  const rows = await db.song.findMany({ where: { isPublished: true, status: SongStatus.READY }, take: 60, orderBy: [{ playCount: "desc" }, { createdAt: "desc" }], include: { creator: { select: { displayName: true } } } });
  const item = (song: typeof rows[number]) => ({ id: song.id, kind: "song" as const, title: song.title, subtitle: song.creator.displayName, imageUrl: song.coverArtKey ? `/api/songs/${song.id}/cover` : "", contextUri: `song:${song.id}` });
  const sections = [
    { id: "shortcuts", type: "shortcuts" as const, items: ["All", "Music", "Podcasts", "New"].map((title) => ({ id: title.toLowerCase(), kind: "mix" as const, title, imageUrl: "", contextUri: `filter:${title.toLowerCase()}` })) },
    ...(rows.length ? [{ id: "recommended", type: "shelf" as const, title: "Recommended for You", layout: "cards" as const, showAllHref: "/search", items: rows.slice(0, 20).map(item) }] : []),
    ...(rows.length > 20 ? [{ id: "new-releases", type: "shelf" as const, title: "New Releases", layout: "cards" as const, showAllHref: "/search", items: rows.slice(20, 40).map(item) }] : []),
  ];
  return sections;
});

app.get("/api/songs/:songId/cover", async (request, reply) => {
  const { songId } = z.object({ songId: z.string().cuid() }).parse(request.params);
  const song = await db.song.findFirst({
    where: { id: songId, isPublished: true, status: SongStatus.READY },
    select: { coverArtKey: true },
  });
  if (!song?.coverArtKey) throw apiError(404, "Cover art is unavailable");
  const signed = await getSignedUrl(storage, new GetObjectCommand({ Bucket: COVER_BUCKET, Key: song.coverArtKey }), { expiresIn: 300 });
  return reply.redirect(signed, 302);
});

// Same-origin audio proxy for imported originals. This keeps Supabase S3
// signatures and browser CORS out of the audio element's playback path.
app.get("/api/songs/:songId/audio", async (request, reply) => {
  const { songId } = z.object({ songId: z.string().min(1).max(128) }).parse(request.params);
  const { bitrate } = z.object({ bitrate: z.enum(["160", "320"]).default("320") }).parse(request.query);
  const song = await db.song.findFirst({ where: { id: songId, isPublished: true, status: SongStatus.READY }, select: { creatorId: true, masterAudioKey: true } });
  if (!song?.masterAudioKey) throw apiError(404, "Audio is not ready");
  const range = request.headers.range;
  const rangeOption = range ? { Range: range } : {};
  const generatedKey = `${song.creatorId}/${songId}/audio/${bitrate}k.mp3`;
  const originalCandidates = supabaseStorageConfigured
    ? [
      { client: legacyStorage, bucket: LEGACY_AUDIO_BUCKET, key: song.masterAudioKey },
      { client: storage, bucket: AUDIO_BUCKET, key: song.masterAudioKey },
    ]
    : [
      { client: storage, bucket: AUDIO_BUCKET, key: song.masterAudioKey },
      { client: legacyStorage, bucket: LEGACY_AUDIO_BUCKET, key: song.masterAudioKey },
    ];
  const generatedCandidates = [
    { client: storage, bucket: AUDIO_BUCKET, key: generatedKey },
    { client: legacyStorage, bucket: LEGACY_AUDIO_BUCKET, key: generatedKey },
  ];
  const candidates = [...generatedCandidates, ...originalCandidates];
  let upstream: GetObjectCommandOutput | undefined;
  for (const candidate of candidates) {
    try {
      upstream = await candidate.client.send(new GetObjectCommand({
        Bucket: candidate.bucket,
        Key: candidate.key,
        ...rangeOption,
      }));
      break;
    } catch {
      // Imported originals and generated renditions may live in different providers.
    }
  }
  if (!upstream) throw apiError(404, "Audio file is unavailable for this track");
  reply.code(upstream["$metadata"].httpStatusCode ?? 200);
  reply.header("Content-Type", upstream.ContentType ?? "audio/mpeg");
  if (upstream.ContentLength !== undefined) reply.header("Content-Length", upstream.ContentLength);
  if (upstream.ContentRange) reply.header("Content-Range", upstream.ContentRange);
  if (upstream.AcceptRanges) reply.header("Accept-Ranges", upstream.AcceptRanges);
  if (upstream.ETag) reply.header("ETag", upstream.ETag);
  return reply.send(upstream.Body);
});

app.get("/api/songs/:songId/stream", { preHandler: authenticate }, async (request, reply) => {
  const { songId } = z.object({ songId: z.string() }).parse(request.params);
  const user = (request as RequestWithAuth).auth;
  const song = await db.song.findFirst({
    where: { id: songId, isPublished: true, status: SongStatus.READY },
    select: { hlsMasterKey: true, masterAudioKey: true, creatorId: true, durationSeconds: true, isExclusive: true, tierRequired: true },
  });
  if (!song) throw apiError(404, "Audio is not ready");
  if (song.isExclusive && TIER_RANKS[effectivePlan(user.plan, user.planExpiresAt)] < TIER_RANKS[song.tierRequired]) {
    throw apiError(403, `Exclusive track requires ${song.tierRequired} subscription plan or higher.`);
  }

  // Pick bitrate from header (default 320)
  const bitrateHeader = (request.headers as Record<string, string>)["x-bitrate"];
  const bitrate = bitrateHeader === "160" ? "160" : "320";

  let streamUrl: string;
  // Prefer transcoded audio when available; imported catalog songs use their
  // original object directly from the configured storage bucket.
  if (song.masterAudioKey) {
    streamUrl = `${request.protocol}://${request.headers.host}/api/songs/${songId}/audio?bitrate=${bitrate}`;
  } else if (song.hlsMasterKey) {
    streamUrl = await getSignedUrl(
      legacyStorage,
      new GetObjectCommand({ Bucket: LEGACY_AUDIO_BUCKET, Key: song.hlsMasterKey }),
      { expiresIn: 3600 }
    );
  } else {
    throw apiError(404, "Audio is not ready");
  }

  // Fire async play-event (never blocking)
  transcodeQueue.add(
    "play-event",
    { userId: user.id, songId, bitrate },
    { removeOnComplete: 100, removeOnFail: 100 }
  ).catch(() => undefined);

  return { streamUrl, duration: song.durationSeconds ?? 0 };
});

app.get("/api/songs/:songId/radio", async (request) => {
  const { songId } = z.object({ songId: z.string().min(1).max(128) }).parse(request.params);
  const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(request.query);
  const seed = await db.song.findFirst({
    where: { id: songId, isPublished: true, status: SongStatus.READY },
    select: { id: true },
  });
  if (!seed) throw apiError(404, "Song is unavailable");

  const cacheKey = `radio:${songId}:${limit}`;
  try {
    const cached = await radioCache.get(cacheKey);
    if (cached) return { source: "redis", data: JSON.parse(cached) };
  } catch (error) {
    request.log.warn({ err: error, songId }, "Radio cache read failed");
  }

  const mlResponse = await fetch(`${process.env.ML_SERVICE_URL ?? "http://ml:8000"}/recommend/similar/${encodeURIComponent(songId)}?top=${limit}`).catch(() => null);
  const mlPayload = mlResponse?.ok ? await mlResponse.json() as { songIds?: unknown[]; strategy?: string } : null;
  const songIds = (mlPayload?.songIds ?? []).filter((id): id is string => typeof id === "string" && id !== songId).slice(0, limit);
  const records = songIds.length
    ? await db.song.findMany({ where: { id: { in: songIds }, isPublished: true, status: SongStatus.READY }, include: { creator: { select: { displayName: true, avatarUrl: true } } } })
    : await db.song.findMany({ where: { id: { not: songId }, isPublished: true, status: SongStatus.READY }, take: limit, orderBy: { playCount: "desc" }, include: { creator: { select: { displayName: true, avatarUrl: true } } } });
  const byId = new Map(records.map((song) => [song.id, song]));
  const data = songIds.length
    ? songIds.flatMap((id) => {
      const song = byId.get(id);
      return song ? [publicSong(song)] : [];
    })
    : records.map(publicSong);
  const source = songIds.length ? (mlPayload?.strategy ?? "als-similar") : "cold-start-popular";

  try {
    await radioCache.set(cacheKey, JSON.stringify(data), "EX", 60 * 60);
  } catch (error) {
    request.log.warn({ err: error, songId }, "Radio cache write failed");
  }
  return { source, data };
});

app.patch("/api/me", { preHandler: authenticate }, async (request) => {
  const body = z.object({ displayName: z.string().min(2).max(80).optional(), avatarUrl: z.string().url().optional(), bio: z.string().max(500).optional() }).parse(request.body);
  return db.user.update({ where: { id: (request as RequestWithAuth).auth.id }, data: body });
});

app.post("/api/creator/apply", { preHandler: authenticate }, async (request) => {
  const user = (request as RequestWithAuth).auth;
  if (user.role === Role.CREATOR) return { role: user.role, alreadyCreator: true };
  const updated = await db.user.update({ where: { id: user.id }, data: { role: Role.CREATOR } });
  return { role: updated.role, approved: true };
});

app.post("/api/creator/upload-intents", { preHandler: requireRole(Role.CREATOR) }, async (request) => {
  const body = z.object({ title: z.string().min(1).max(180), artistName: z.string().min(1).max(120), album: z.string().max(120).optional(), genre: z.string().min(1).max(60), tags: z.array(z.string().min(1).max(32)).max(10).default([]), contentType: z.enum(["audio/mpeg", "audio/wav", "audio/x-wav", "audio/flac", "audio/aac", "audio/mp4", "audio/x-m4a"]) }).parse(request.body);
  if (!storageAccessKey || !storageSecretKey) {
    throw apiError(503, "Audio storage is not configured. Add the S3/ Supabase storage settings before uploading.");
  }
  const user = (request as RequestWithAuth).auth;
  const { contentType, ...songInput } = body;
  const song = await db.song.create({ data: { creatorId: user.id, ...songInput, masterAudioKey: `masters/${user.id}/${crypto.randomUUID()}`, status: SongStatus.PROCESSING } });
  const uploadUrl = await getSignedUrl(storage, new PutObjectCommand({ Bucket: AUDIO_BUCKET, Key: song.masterAudioKey!, ContentType: contentType }), { expiresIn: 15 * 60 });
  return { songId: song.id, uploadUrl, expiresIn: 900, status: song.status };
});

// Start processing only after the browser has finished its signed upload.
app.post("/api/creator/songs/:songId/complete", { preHandler: requireRole(Role.CREATOR) }, async (request) => {
  const { songId } = z.object({ songId: z.string().cuid() }).parse(request.params);
  const user = (request as RequestWithAuth).auth;
  const song = await db.song.findFirst({ where: { id: songId, creatorId: user.id } });
  if (!song?.masterAudioKey) throw apiError(404, "Upload not found");
  await transcodeQueue.add("transcode-song", { songId: song.id, masterAudioKey: song.masterAudioKey }, { jobId: song.id, attempts: 5, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: 1000, removeOnFail: 1000 });
  return { songId: song.id, status: song.status };
});

// ==========================================
// 🎨 Cover Art Upload Intent
// ==========================================
app.post("/api/creator/songs/:songId/cover-art-intent", { preHandler: requireRole(Role.CREATOR) }, async (request) => {
  const { songId } = z.object({ songId: z.string().cuid() }).parse(request.params);
  const { contentType } = z.object({ contentType: z.enum(["image/jpeg", "image/png", "image/webp"]) }).parse(request.body);
  const user = (request as RequestWithAuth).auth;
  const song = await db.song.findFirst({ where: { id: songId, creatorId: user.id } });
  if (!song) throw apiError(404, "Song not found or you do not own it");
  const extension = contentType === "image/png" ? ".png" : contentType === "image/webp" ? ".webp" : ".jpg";
  const coverKey = `${user.id}/${songId}/cover${extension}`;
  const uploadUrl = await getSignedUrl(storage, new PutObjectCommand({ Bucket: COVER_BUCKET, Key: coverKey, ContentType: contentType }), { expiresIn: 15 * 60 });
  await db.song.update({ where: { id: songId }, data: { coverArtKey: coverKey } });
  return { uploadUrl, coverArtKey: coverKey, expiresIn: 900 };
});

// ==========================================
// 📋 List Creator's Own Songs
// ==========================================
app.get("/api/creator/songs", { preHandler: requireRole(Role.CREATOR) }, async (request) => {
  const creatorId = (request as RequestWithAuth).auth.id;
  const { cursor, limit } = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(request.query);
  const songs = await db.song.findMany({
    where: { creatorId },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { createdAt: "desc" },
    include: { creator: { select: { displayName: true, avatarUrl: true } } },
  });
  const hasNext = songs.length > limit;
  return {
    data: songs.slice(0, limit).map((s) => ({
      ...publicSong(s),
      status: s.status,
      isPublished: s.isPublished,
      masterAudioKey: s.masterAudioKey,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    })),
    nextCursor: hasNext ? songs[limit - 1]?.id : null,
  };
});

app.post("/api/creator/songs/import-storage", { preHandler: requireRole(Role.CREATOR) }, async (request) => {
  const creatorId = (request as RequestWithAuth).auth.id;
  if (!storageAccessKey || !storageSecretKey || !AUDIO_BUCKET) throw apiError(503, "Audio storage is not configured");
  const result = await storage.send(new ListObjectsV2Command({ Bucket: AUDIO_BUCKET, MaxKeys: 1000 }));
  const objects = (result.Contents ?? []).filter((item) => item.Key && /\.(mp3|m4a|wav|flac)$/i.test(item.Key));
  let imported = 0;
  for (const item of objects) {
    const key = item.Key!;
    const existing = await db.song.findFirst({ where: { creatorId, masterAudioKey: key }, select: { id: true } });
    if (existing) continue;
    const filename = key.split("/").pop()!.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    const [artistName, ...titleParts] = filename.includes(" - ") ? filename.split(" - ") : ["Imported artist", filename];
    await db.song.create({ data: { creatorId, title: titleParts.join(" - ").trim() || filename, artistName: artistName.trim(), genre: "Imported", masterAudioKey: key, status: SongStatus.READY, isPublished: true } });
    imported++;
  }
  return { scanned: objects.length, imported };
});

// ==========================================
// 🔍 Get Single Song by ID (status polling)
// ==========================================
app.get("/api/songs/:songId", async (request) => {
  const { songId } = z.object({ songId: z.string().cuid() }).parse(request.params);
  const user = request.headers.authorization ? (await authenticate(request), (request as RequestWithAuth).auth) : null;
  const song = await db.song.findFirst({
    where: { id: songId },
    include: { creator: { select: { displayName: true, avatarUrl: true } } },
  });
  if (!song || (!song.isPublished || song.status !== SongStatus.READY) && song.creatorId !== user?.id) {
    throw apiError(404, "Song not found");
  }
  return {
    ...publicSong(song),
    status: song.status,
    isPublished: song.isPublished,
    createdAt: song.createdAt.toISOString(),
  };
});

// ==========================================
// 🎵 Signed Upload URL
// ==========================================
// POST /api/songs/upload-url — creator gets a signed upload URL for direct storage upload
app.post("/api/songs/upload-url", { preHandler: requireRole(Role.CREATOR) }, async (request) => {
  const body = z.object({
    title: z.string().min(1).max(180),
    artistName: z.string().min(1).max(120),
    album: z.string().max(120).optional(),
    genre: z.string().min(1).max(60),
    tags: z.array(z.string().min(1).max(32)).max(10).default([]),
    contentType: z.enum(["audio/mpeg", "audio/wav", "audio/flac", "audio/x-wav", "audio/aac"]),
    ext: z.string().max(10).default("mp3"),
  }).parse(request.body);
  const user = (request as RequestWithAuth).auth;
  if (!storageAccessKey || !storageSecretKey || !AUDIO_BUCKET) {
    throw apiError(503, "Audio storage is not configured");
  }
  const songId = crypto.randomUUID();
  const masterPath = `${user.id}/${songId}/master/original.${body.ext}`;

  // Create song row with PROCESSING status
  const song = await db.song.create({
    data: {
      id: songId,
      creatorId: user.id,
      title: body.title,
      artistName: body.artistName,
      album: body.album,
      genre: body.genre,
      tags: body.tags,
      masterAudioKey: masterPath,
      status: SongStatus.PROCESSING,
    },
  });

  // Generate a presigned upload URL for the configured audio bucket.
  const signedUrl = await getSignedUrl(
    storage,
    new PutObjectCommand({
      Bucket: AUDIO_BUCKET,
      Key: masterPath,
      ContentType: body.contentType,
    }),
    { expiresIn: 15 * 60 }
  );

  return { songId: song.id, path: masterPath, signedUrl, expiresIn: 900 };
});

// POST /api/songs/:songId/complete — mark upload done, enqueue media job
app.post("/api/songs/:songId/complete", { preHandler: requireRole(Role.CREATOR) }, async (request) => {
  const { songId } = z.object({ songId: z.string() }).parse(request.params);
  const user = (request as RequestWithAuth).auth;
  const song = await db.song.findFirst({ where: { id: songId, creatorId: user.id } });
  if (!song?.masterAudioKey) throw apiError(404, "Upload not found");
  await transcodeQueue.add(
    "transcode-song",
    { songId: song.id, masterAudioKey: song.masterAudioKey, creatorId: user.id },
    { jobId: song.id, attempts: 5, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: 1000, removeOnFail: 1000 }
  );
  return { songId: song.id, status: song.status, queued: true };
});

// POST /api/events/listen — 80% completion event for recommender
app.post("/api/events/listen", { preHandler: authenticate }, async (request) => {
  const body = z.object({
    songId: z.string().min(1),
    durationPlayed: z.number().int().min(0).max(7200),
    completed: z.boolean().default(false),
  }).parse(request.body);
  const user = (request as RequestWithAuth).auth;
  // Fire and forget — enqueue ML analytics event
  await transcodeQueue.add(
    "play-event",
    { userId: user.id, songId: body.songId, durationPlayed: body.durationPlayed, completed: body.completed },
    { removeOnComplete: 100, removeOnFail: 100 }
  );
  return { accepted: true };
});

app.post("/api/events/playback", { preHandler: authenticate }, async (request) => {
  const body = z.object({
    songId: z.string().min(1), status: z.enum(["ok", "error", "degraded", "blocked"]),
    errorCode: z.string().max(80).optional(), bitrate: z.string().max(10).optional(),
    attempt: z.number().int().min(0).max(10).default(0), bufferedMs: z.number().int().min(0).max(3600000).optional(),
    userAgent: z.string().max(500).optional(),
  }).parse(request.body);
  // Keep successful playback telemetry sampled; retain every actionable outcome.
  if (body.status === "ok" && Math.random() > 0.05) return { accepted: true };
  await db.playbackError.create({ data: {
    userId: (request as RequestWithAuth).auth.id,
    songId: body.songId,
    status: body.status,
    errorCode: body.errorCode,
    bitrate: body.bitrate,
    attempt: body.attempt,
    bufferedMs: body.bufferedMs,
    userAgent: body.userAgent,
  }});
  return { accepted: true };
});


// ==========================================
app.patch("/api/creator/songs/:songId", { preHandler: requireRole(Role.CREATOR) }, async (request) => {
  const { songId } = z.object({ songId: z.string().cuid() }).parse(request.params);
  const body = z.object({
    title: z.string().min(1).max(180).optional(),
    artistName: z.string().min(1).max(120).optional(),
    album: z.string().max(120).optional(),
    genre: z.string().min(1).max(60).optional(),
    tags: z.array(z.string().min(1).max(32)).max(10).optional(),
    isPublished: z.boolean().optional(),
  }).parse(request.body);
  const user = (request as RequestWithAuth).auth;
  const existing = await db.song.findFirst({ where: { id: songId, creatorId: user.id } });
  if (!existing) throw apiError(404, "Song not found or you do not own it");
  if (body.isPublished && existing.status !== SongStatus.READY) throw apiError(400, "Cannot publish a song that is not ready yet");
  const updated = await db.song.update({
    where: { id: songId },
    data: { ...body },
    include: { creator: { select: { displayName: true, avatarUrl: true } } },
  });
  // Emit feed event when first published
  if (body.isPublished && !existing.isPublished) {
    try {
      const newEvent = await db.feedEvent.create({
        data: { actorId: user.id, type: FeedEventType.NEW_SONG, songId },
        include: {
          actor: { select: { id: true, displayName: true, avatarUrl: true } },
          song: { include: { creator: { select: { displayName: true, avatarUrl: true } } } },
        },
      });
      setTimeout(() => broadcastFeedEvent(newEvent).catch(console.error), 0);
    } catch (err) {
      request.log.warn({ err }, "Failed to broadcast NEW_SONG feed event");
    }
  }
  if (body.isPublished || updated.isPublished) {
    await Promise.allSettled([
      radioCache.del(`library:${user.id}`),
      radioCache.del(`reco:${user.id}`),
      radioCache.del(`radio:${songId}:20`),
    ]);
  }
  return {
    ...publicSong(updated),
    status: updated.status,
    isPublished: updated.isPublished,
    updatedAt: updated.updatedAt.toISOString(),
  };
});

app.delete("/api/creator/songs/:songId", { preHandler: requireRole(Role.CREATOR) }, async (request) => {
  const { songId } = z.object({ songId: z.string().cuid() }).parse(request.params);
  const user = (request as RequestWithAuth).auth;
  const song = await db.song.findFirst({ where: { id: songId, creatorId: user.id }, select: { id: true, masterAudioKey: true, hlsMasterKey: true, coverArtKey: true } });
  if (!song) throw apiError(404, "Song not found or you do not own it");

  await db.song.delete({ where: { id: song.id } });
  const keys = [song.masterAudioKey, song.hlsMasterKey, song.coverArtKey].filter((key): key is string => Boolean(key));
  await Promise.all(keys.map((key) => process.env.S3_BUCKET
    ? storage.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key })).catch((error) => request.log.warn({ error, key }, "Failed to remove song asset"))
    : Promise.resolve()));
  return { success: true, songId: song.id };
});

app.post("/api/listening-events", { preHandler: authenticate }, async (request) => {
  const body = z.object({ songId: z.string().min(1), playDurationSeconds: z.number().int().min(0).max(60 * 60), completed: z.boolean().default(false) }).parse(request.body);
  const user = (request as RequestWithAuth).auth;
  await db.$transaction(async (tx) => {
    const songExists = await tx.song.findUnique({ where: { id: body.songId }, select: { id: true } });
    if (songExists) {
      await tx.listeningEvent.create({ data: { userId: user.id, ...body } });
    }
    
    if (body.playDurationSeconds >= 15 || body.completed) {
      // Only update database song and recentPlay if song exists in DB (avoid crashing on S3/demo tracks)
      // Safe playCount update
      if (songExists) {
        await tx.song.update({ where: { id: body.songId }, data: { playCount: { increment: 1 } } });
        await tx.recentPlay.create({ data: { userId: user.id, songId: body.songId } });
      }
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const existingFeedEvent = songExists ? await tx.feedEvent.findFirst({
        where: { actorId: user.id, type: FeedEventType.LISTEN, songId: body.songId, createdAt: { gte: today } }
      }) : null;
      if (!existingFeedEvent && songExists) {
        const newEvent = await tx.feedEvent.create({
          data: { actorId: user.id, type: FeedEventType.LISTEN, songId: body.songId },
          include: {
            actor: { select: { id: true, displayName: true, avatarUrl: true } },
            song: { include: { creator: { select: { displayName: true, avatarUrl: true } } } }
          }
        });
        setTimeout(() => broadcastFeedEvent(newEvent).catch(console.error), 0);
      }

      // --- Daily Leaderboard Point Tracking ---
      // Each unique song/day = 100 pts, max 10 songs = 1000 pts
      const POINTS_PER_SONG = 100;
      const MAX_DAILY_SONGS = 10;
      const todayDate = new Date(today.getTime()); // already set to midnight

      const entry = await tx.dailyLeaderboardEntry.upsert({
        where: { userId_date: { userId: user.id, date: todayDate } },
        create: { userId: user.id, date: todayDate, points: POINTS_PER_SONG, uniqueSongs: 1 },
        update: {},
      });

      // Only award points for NEW unique songs today (not already counted)
      if (entry.uniqueSongs < MAX_DAILY_SONGS) {
        // Check if this specific song was already counted today via listening_events
        const alreadyListenedToday = await tx.listeningEvent.count({
          where: {
            userId: user.id,
            songId: body.songId,
            createdAt: { gte: todayDate, lt: new Date(todayDate.getTime() + 86400000) },
          },
        });
        // If this is the first qualifying listen for this song today (count === 1 because we just inserted)
        if (alreadyListenedToday <= 1) {
          const newPoints = Math.min((entry.uniqueSongs + 1) * POINTS_PER_SONG, MAX_DAILY_SONGS * POINTS_PER_SONG);
          const newUnique = Math.min(entry.uniqueSongs + 1, MAX_DAILY_SONGS);
          const nowMs = Date.now() - todayDate.getTime(); // ms since midnight

          await tx.dailyLeaderboardEntry.update({
            where: { userId_date: { userId: user.id, date: todayDate } },
            data: {
              points: newPoints,
              uniqueSongs: newUnique,
              completedAtMs: newUnique === MAX_DAILY_SONGS ? BigInt(nowMs) : entry.completedAtMs,
            },
          });

          // Update Redis sorted set for real-time leaderboard
          // Score = points * 100000 + (86400000 - ms_elapsed) for speed tie-break
          const dateKey = todayDate.toISOString().slice(0, 10);
          const speedBonus = 86400000 - nowMs;
          const compositeScore = newPoints * 100000 + Math.max(0, speedBonus);
          try {
            await radioCache.zadd(`leaderboard:${dateKey}`, compositeScore, user.id);
            await radioCache.expire(`leaderboard:${dateKey}`, 172800); // 48h TTL
          } catch {}
        }
      }
    }

  });
  return { accepted: true };
});

// ==========================================
// 🏆 Daily Leaderboard & Trophies
// ==========================================

// Live leaderboard — uses Redis sorted set for real-time, hydrates names from DB
app.get("/api/leaderboard", async (request) => {
  const { date } = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(request.query);
  const dateKey = date ?? new Date().toISOString().slice(0, 10);

  // Try Redis first for today's live data
  let topUserIds: string[] = [];
  try {
    topUserIds = await radioCache.zrevrange(`leaderboard:${dateKey}`, 0, 9);
  } catch {}

  if (topUserIds.length === 0) {
    // Fallback to DB for past days
    const dbEntries = await db.dailyLeaderboardEntry.findMany({
      where: { date: new Date(dateKey) },
      orderBy: [{ points: "desc" }, { completedAtMs: "asc" }],
      take: 10,
      include: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
    });
    return {
      date: dateKey,
      entries: dbEntries.map((e, i) => ({
        rank: e.rank ?? i + 1,
        userId: e.userId,
        displayName: e.user.displayName,
        avatarUrl: e.user.avatarUrl,
        points: e.points,
        uniqueSongs: e.uniqueSongs,
        trophy: e.trophy,
        completedAtMs: e.completedAtMs?.toString() ?? null,
      })),
    };
  }

  // Hydrate from DB
  const entries = await db.dailyLeaderboardEntry.findMany({
    where: { date: new Date(dateKey), userId: { in: topUserIds } },
    include: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
  });
  const byUserId = new Map(entries.map((e) => [e.userId, e]));
  const ranked = topUserIds.map((uid, i) => {
    const e = byUserId.get(uid);
    return {
      rank: i + 1,
      userId: uid,
      displayName: e?.user.displayName ?? "Listener",
      avatarUrl: e?.user.avatarUrl ?? null,
      points: e?.points ?? 0,
      uniqueSongs: e?.uniqueSongs ?? 0,
      trophy: i === 0 ? "GOLD" : i === 1 ? "SILVER" : i === 2 ? "BRONZE" : null,
      completedAtMs: e?.completedAtMs?.toString() ?? null,
    };
  });

  return { date: dateKey, entries: ranked };
});

// Personal stats + trophy collection
app.get("/api/leaderboard/my-stats", { preHandler: authenticate }, async (request) => {
  const userId = (request as RequestWithAuth).auth.id;

  const [todayEntry, trophies, lifetimeEntries] = await Promise.all([
    db.dailyLeaderboardEntry.findFirst({
      where: { userId, date: new Date(new Date().toISOString().slice(0, 10)) },
    }),
    db.userTrophy.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.dailyLeaderboardEntry.aggregate({
      where: { userId },
      _sum: { points: true },
      _count: true,
    }),
  ]);

  const lifetimePoints = lifetimeEntries._sum.points ?? 0;
  const daysActive = lifetimeEntries._count;
  const milestoneProgress = Math.min(100, (lifetimePoints / 1_000_000) * 100);

  return {
    today: todayEntry ? {
      points: todayEntry.points,
      uniqueSongs: todayEntry.uniqueSongs,
      maxPoints: 1000,
      maxSongs: 10,
      completedAtMs: todayEntry.completedAtMs?.toString() ?? null,
    } : { points: 0, uniqueSongs: 0, maxPoints: 1000, maxSongs: 10, completedAtMs: null },
    lifetime: {
      totalPoints: lifetimePoints,
      daysActive,
      milestoneProgress: Number(milestoneProgress.toFixed(1)),
      hasMillionMilestone: trophies.some((t) => t.type === TrophyType.MILESTONE_1M),
    },
    trophies: trophies.map((t) => ({
      id: t.id,
      type: t.type,
      date: t.date.toISOString().slice(0, 10),
      createdAt: t.createdAt.toISOString(),
    })),
  };
});

// Midnight cron: finalize yesterday's leaderboard, award trophies
app.post("/api/admin/leaderboard/finalize", async () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  const entries = await db.dailyLeaderboardEntry.findMany({
    where: { date: yesterday },
    orderBy: [{ points: "desc" }, { completedAtMs: "asc" }],
    take: 10,
  });

  const trophyMap: Record<number, TrophyType> = { 0: TrophyType.GOLD, 1: TrophyType.SILVER, 2: TrophyType.BRONZE };
  const awarded: { userId: string; rank: number; trophy: TrophyType | null }[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const trophy = trophyMap[i] ?? null;

    await db.dailyLeaderboardEntry.update({
      where: { id: entry.id },
      data: { rank: i + 1, trophy },
    });

    if (trophy) {
      await db.userTrophy.create({
        data: { userId: entry.userId, type: trophy, date: yesterday },
      });
    }

    awarded.push({ userId: entry.userId, rank: i + 1, trophy });
  }

  // Check lifetime 1M milestone for any user who crossed it
  const allUsers = [...new Set(entries.map((e) => e.userId))];
  for (const uid of allUsers) {
    const agg = await db.dailyLeaderboardEntry.aggregate({
      where: { userId: uid },
      _sum: { points: true },
    });
    const total = agg._sum.points ?? 0;
    if (total >= 1_000_000) {
      const alreadyHas = await db.userTrophy.findFirst({
        where: { userId: uid, type: TrophyType.MILESTONE_1M },
      });
      if (!alreadyHas) {
        await db.userTrophy.create({
          data: { userId: uid, type: TrophyType.MILESTONE_1M, date: yesterday },
        });
      }
    }
  }

  return { date: yesterday.toISOString().slice(0, 10), finalized: awarded.length, awarded };
});

app.get("/api/library", { preHandler: authenticate }, async (request) => {
  const userId = (request as RequestWithAuth).auth.id;
  const [liked, recent, playlists] = await Promise.all([
    db.like.findMany({ where: { userId }, take: 50, orderBy: { createdAt: "desc" }, include: { song: { include: { creator: { select: { displayName: true, avatarUrl: true } } } } } }),
    db.recentPlay.findMany({ where: { userId }, take: 50, distinct: ["songId"], orderBy: { playedAt: "desc" }, include: { song: { include: { creator: { select: { displayName: true, avatarUrl: true } } } } } }),
    db.playlist.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, include: { _count: { select: { songs: true } } } }),
  ]);
  return { likedSongs: liked.map((row) => publicSong(row.song)), recentSongs: recent.map((row) => ({ ...publicSong(row.song), playedAt: row.playedAt })), playlists };
});


app.put("/api/songs/:songId/like", { preHandler: authenticate }, async (request) => {
  const userId = (request as RequestWithAuth).auth.id;
  const { songId } = z.object({ songId: z.string().cuid() }).parse(request.params);
  await db.$transaction(async (tx) => {
    const createdLike = await tx.like.createMany({ data: { userId, songId }, skipDuplicates: true });
    if (createdLike.count) {
      await tx.song.update({ where: { id: songId }, data: { likeCount: { increment: 1 } } });
    }

    // Keep the user's persisted Liked Songs playlist in sync with the like.
    await ensureLikedSongsPlaylist(tx, userId, songId);
    
    // Add feed event
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const existing = await tx.feedEvent.findFirst({
      where: { actorId: userId, type: FeedEventType.LIKE, songId, createdAt: { gte: today } }
    });
    if (!existing) {
      const newEvent = await tx.feedEvent.create({
        data: { actorId: userId, type: FeedEventType.LIKE, songId },
        include: {
          actor: { select: { id: true, displayName: true, avatarUrl: true } },
          song: { include: { creator: { select: { displayName: true, avatarUrl: true } } } }
        }
      });
      setTimeout(() => broadcastFeedEvent(newEvent).catch(console.error), 0);
    }
  });
  return { liked: true };
});


app.delete("/api/songs/:songId/like", { preHandler: authenticate }, async (request) => {
  const userId = (request as RequestWithAuth).auth.id;
  const { songId } = z.object({ songId: z.string().cuid() }).parse(request.params);
  await db.$transaction(async (tx) => {
    const removed = await tx.like.deleteMany({ where: { userId, songId } });
    if (removed.count) {
      await tx.song.update({ where: { id: songId }, data: { likeCount: { decrement: 1 } } });
    }

    const likedPlaylists = await tx.playlist.findMany({
      where: { userId, name: LIKED_SONGS_PLAYLIST_NAME },
      select: { id: true },
    });
    if (likedPlaylists.length) {
      await tx.playlistSong.deleteMany({
        where: { playlistId: { in: likedPlaylists.map((playlist) => playlist.id) }, songId },
      });
    }
  });
  return { liked: false };
});

app.get("/api/recommendations", { preHandler: authenticate }, async (request) => {
  const userId = (request as RequestWithAuth).auth.id;
  // The ML service stores cached IDs in Redis. A popular-song fallback prevents cold-start blanks.
  const response = await fetch(`${process.env.ML_SERVICE_URL ?? "http://ml:8000"}/recommendations/${userId}`).catch(() => null);
  const ids = response?.ok ? (await response.json() as { songIds: string[] }).songIds : [];
  const recommended = ids.length ? await db.song.findMany({ where: { id: { in: ids }, isPublished: true }, include: { creator: { select: { displayName: true, avatarUrl: true } } } }) : await db.song.findMany({ where: { isPublished: true, status: SongStatus.READY }, take: 30, orderBy: { playCount: "desc" }, include: { creator: { select: { displayName: true, avatarUrl: true } } } });
  return { strategy: ids.length ? "collaborative-filtering" : "cold-start-popular", data: recommended.map(publicSong) };
});

// /api/me/library — unified library view including ML-powered "Recommended" + "On the Rise" rows
app.get("/api/me/library", { preHandler: authenticate }, async (request) => {
  const userId = (request as RequestWithAuth).auth.id;
  const ML_URL = process.env.ML_SERVICE_URL ?? "http://ml:8000";

  // All four fetches run in parallel — DB + two ML calls
  const [liked, recent, playlists, mlResponse, popularResponse] = await Promise.all([
    db.like.findMany({ where: { userId }, take: 50, orderBy: { createdAt: "desc" }, include: { song: { include: { creator: { select: { displayName: true, avatarUrl: true } } } } } }),
    db.recentPlay.findMany({ where: { userId }, take: 50, distinct: ["songId"], orderBy: { playedAt: "desc" }, include: { song: { include: { creator: { select: { displayName: true, avatarUrl: true } } } } } }),
    db.playlist.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, include: { _count: { select: { songs: true } } } }),
    fetch(`${ML_URL}/recommendations/${userId}`).catch(() => null),
    fetch(`${ML_URL}/popular?limit=20`).catch(() => null),
  ]);

  // --- Recommended row ---
  const mlJson = mlResponse?.ok ? (await mlResponse.json() as { songIds: string[]; strategy: string }) : null;
  const recIds: string[] = mlJson?.songIds ?? [];
  const recStrategy: string = mlJson?.strategy ?? "cold-start-popular";

  const recommendedSongs = recIds.length
    ? await db.song.findMany({ where: { id: { in: recIds }, isPublished: true }, include: { creator: { select: { displayName: true, avatarUrl: true } } } })
    : await db.song.findMany({ where: { isPublished: true, status: SongStatus.READY }, take: 30, orderBy: { playCount: "desc" }, include: { creator: { select: { displayName: true, avatarUrl: true } } } });

  const recMap = new Map(recommendedSongs.map((s) => [s.id, s]));
  const orderedRec = recIds.length
    ? recIds.map((id) => recMap.get(id)).filter((s): s is NonNullable<typeof s> => s !== undefined)
    : recommendedSongs;

  // --- Trending / "On the Rise" row ---
  const popularJson = popularResponse?.ok ? (await popularResponse.json() as { songIds: string[] }) : null;
  const trendingIds: string[] = popularJson?.songIds ?? [];

  const trendingSongs = trendingIds.length
    ? await db.song.findMany({ where: { id: { in: trendingIds }, isPublished: true }, include: { creator: { select: { displayName: true, avatarUrl: true } } } })
    : [];

  const trendingMap = new Map(trendingSongs.map((s) => [s.id, s]));
  const orderedTrending = trendingIds.map((id) => trendingMap.get(id)).filter((s): s is NonNullable<typeof s> => s !== undefined);

  return {
    likedSongs: liked.map((row) => publicSong(row.song)),
    recentSongs: recent.map((row) => ({ ...publicSong(row.song), playedAt: row.playedAt })),
    playlists,
    recommended: orderedRec.map(publicSong),
    recommendedStrategy: recStrategy,
    trending: orderedTrending.map(publicSong),
  };
});

app.get("/api/creator/analytics", { preHandler: requireRole(Role.CREATOR) }, async (request) => {
  const creatorId = (request as RequestWithAuth).auth.id;
  const songs = await db.song.findMany({ where: { creatorId }, select: { id: true, title: true, playCount: true, likeCount: true } });
  const songIds = songs.map((song) => song.id);
  const uniqueListeners = await db.listeningEvent.groupBy({ by: ["userId"], where: { songId: { in: songIds } } });
  return { totalPlays: songs.reduce((total, song) => total + song.playCount, 0n).toString(), uniqueListeners: uniqueListeners.length, likesReceived: songs.reduce((total, song) => total + song.likeCount, 0), songs: songs.map((song) => ({ ...song, playCount: song.playCount.toString() })) };
});

app.get("/api/creator/payouts", { preHandler: requireRole(Role.CREATOR) }, async (request) => {
  const creatorId = (request as RequestWithAuth).auth.id;
  const cacheKey = `payouts:dashboard:${creatorId}`;

  try {
    const cached = await radioCache.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch {}

  const payouts = await db.payout.findMany({
    where: { creatorId },
    orderBy: { period: "desc" },
    take: 24,
  });

  const lifetimePaid = payouts
    .filter((p) => p.status === "PAID")
    .reduce((acc, p) => acc + Number(p.amount), 0);
  const pendingAmount = payouts
    .filter((p) => p.status === "PENDING")
    .reduce((acc, p) => acc + Number(p.amount), 0);
  const totalPlays = payouts.reduce((acc, p) => acc + Number(p.totalPlays), 0);
  const premiumPlays = payouts.reduce((acc, p) => acc + Number(p.premiumPlays), 0);

  const result = {
    summary: {
      lifetimePaid: Number(lifetimePaid.toFixed(2)),
      pendingAmount: Number(pendingAmount.toFixed(2)),
      totalPlays,
      premiumPlays,
      premiumSharePercent: totalPlays > 0 ? Number(((premiumPlays / totalPlays) * 100).toFixed(1)) : 0,
    },
    payouts: payouts.map((p) => ({
      id: p.id,
      period: p.period.toISOString().slice(0, 10),
      totalPlays: p.totalPlays.toString(),
      premiumPlays: p.premiumPlays.toString(),
      adRevenue: Number(p.adRevenue),
      amount: Number(p.amount),
      status: p.status,
      createdAt: p.createdAt.toISOString(),
    })),
  };

  try {
    await radioCache.setex(cacheKey, 86400, JSON.stringify(result));
  } catch {}

  return result;
});

// Monthly Payout Aggregation Cron / Admin Endpoint
app.post("/api/admin/payouts/aggregate", async (request) => {
  const now = new Date();
  const period = new Date(now.getFullYear(), now.getMonth(), 1);

  // Find all creators with published songs
  const creators = await db.user.findMany({
    where: { role: Role.CREATOR },
    select: { id: true },
  });

  const aggregatedCount = [];

  for (const creator of creators) {
    const creatorSongs = await db.song.findMany({
      where: { creatorId: creator.id },
      select: { id: true },
    });
    const songIds = creatorSongs.map((s) => s.id);

    if (songIds.length === 0) continue;

    const totalPlaysCount = await db.listeningEvent.count({
      where: {
        songId: { in: songIds },
        createdAt: { gte: period },
      },
    });

    const premiumPlaysCount = Math.floor(totalPlaysCount * 0.35); // 35% premium tier estimate
    const ratePerPlay = 0.003;
    const creatorShare = 0.80; // 80/20 split pool
    const amount = (totalPlaysCount * ratePerPlay * creatorShare).toFixed(2);

    await db.payout.upsert({
      where: { creatorId_period: { creatorId: creator.id, period } },
      create: {
        creatorId: creator.id,
        period,
        totalPlays: BigInt(totalPlaysCount),
        premiumPlays: BigInt(premiumPlaysCount),
        adRevenue: 0,
        amount: Number(amount),
        status: "PENDING",
      },
      update: {
        totalPlays: BigInt(totalPlaysCount),
        premiumPlays: BigInt(premiumPlaysCount),
        amount: Number(amount),
      },
    });

    // Invalidate Redis cache
    try {
      await radioCache.del(`payouts:dashboard:${creator.id}`);
    } catch {}

    aggregatedCount.push({ creatorId: creator.id, totalPlays: totalPlaysCount, amount: Number(amount) });
  }

  return { period: period.toISOString().slice(0, 10), aggregatedCreators: aggregatedCount.length, details: aggregatedCount };
});

// ==========================================
// 📥 Offline Downloads, Subscriptions & Razorpay
// ==========================================

const PLAN_PRICES = {
  GOOD: 9900,   // ₹99 in paise
  PRO: 19900,   // ₹199 in paise
  GOD: 49900,   // ₹499 in paise
} as const;

const PLAN_DOWNLOAD_LIMITS = {
  FREE: 10,
  GOOD: 50,
  PRO: 200,
  GOD: null,
} as const;

const TIER_RANKS: Record<PlanTier, number> = {
  FREE: 0,
  GOOD: 1,
  PRO: 2,
  GOD: 3,
};

function effectivePlan(plan: PlanTier, planExpiresAt: Date | null): PlanTier {
  return planExpiresAt && planExpiresAt.getTime() <= Date.now() ? PlanTier.FREE : plan;
}

function signatureMatches(expected: string, received: string): boolean {
  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(received, "hex");
  return expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

app.get("/api/me", { preHandler: authenticate }, async (request) => {
  const userId = (request as RequestWithAuth).auth.id;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, displayName: true, email: true, role: true, plan: true, planExpiresAt: true, avatarUrl: true },
  });
  if (!user) throw apiError(404, "User not found");

  const downloadsCount = await db.download.count({ where: { userId } });
  const currentPlan = effectivePlan(user.plan, user.planExpiresAt);

  return {
    ...user,
    plan: currentPlan,
    downloadsCount,
    downloadLimit: PLAN_DOWNLOAD_LIMITS[currentPlan],
  };
});

app.post("/api/payments/create-order", { preHandler: authenticate }, async (request) => {
  const userId = (request as RequestWithAuth).auth.id;
  const { tier } = z.object({ tier: z.enum(["GOOD", "PRO", "GOD"]) }).parse(request.body);
  if (!razorpay || !razorpayKeyId) throw apiError(503, "Payments are not configured");

  const amount = PLAN_PRICES[tier];
  const receipt = `rcpt_${userId.slice(-8)}_${Date.now()}`;

  try {
    const order = await razorpay.orders.create({
      amount,
      currency: "INR",
      receipt,
      notes: { userId, tier },
    });

    await db.paymentOrder.create({
      data: {
        userId,
        tier,
        amount,
        currency: "INR",
        razorpayOrderId: order.id,
      },
    });

    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: razorpayKeyId,
      tier,
    };
  } catch (error) {
    request.log.error({ err: error }, "Failed to create Razorpay order");
    throw apiError(500, "Failed to create payment order");
  }
});

app.post("/api/payments/verify", { preHandler: authenticate }, async (request) => {
  const userId = (request as RequestWithAuth).auth.id;
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = z
    .object({
      razorpay_order_id: z.string(),
      razorpay_payment_id: z.string(),
      razorpay_signature: z.string(),
    })
    .parse(request.body);
  if (!razorpayKeySecret) throw apiError(503, "Payments are not configured");

  const paymentOrder = await db.paymentOrder.findFirst({
    where: { razorpayOrderId: razorpay_order_id, userId },
    select: { id: true, tier: true, razorpayPaymentId: true },
  });
  if (!paymentOrder) throw apiError(404, "Payment order was not found");
  if (paymentOrder.razorpayPaymentId && paymentOrder.razorpayPaymentId !== razorpay_payment_id) {
    throw apiError(409, "Payment order was already verified");
  }

  const body = `${razorpay_order_id}|${razorpay_payment_id}`;
  const expectedSignature = crypto.createHmac("sha256", razorpayKeySecret).update(body).digest("hex");
  if (!signatureMatches(expectedSignature, razorpay_signature)) {
    throw apiError(400, "Invalid payment signature");
  }

  if (paymentOrder.razorpayPaymentId) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, plan: true, planExpiresAt: true },
    });
    if (!user) throw apiError(404, "User not found");
    return { success: true, message: "Payment was already verified.", user };
  }

  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const verification = await db.$transaction(async (tx) => {
    const markedPaid = await tx.paymentOrder.updateMany({
      where: { id: paymentOrder.id, razorpayPaymentId: null },
      data: { razorpayPaymentId: razorpay_payment_id, verifiedAt: new Date() },
    });

    const currentUser = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, plan: true, planExpiresAt: true },
    });
    if (!currentUser) throw apiError(404, "User not found");
    if (markedPaid.count === 0) return { user: currentUser, alreadyVerified: true };

    const subscriptionStart = currentUser.planExpiresAt && currentUser.planExpiresAt.getTime() > Date.now()
      ? currentUser.planExpiresAt
      : new Date();
    const planExpiresAt = new Date(subscriptionStart.getTime() + thirtyDaysMs);

    const user = await tx.user.update({
      where: { id: userId },
      data: { plan: paymentOrder.tier, planExpiresAt },
      select: { id: true, plan: true, planExpiresAt: true },
    });
    return { user, alreadyVerified: false };
  });

  return {
    success: true,
    message: verification.alreadyVerified ? "Payment was already verified." : `Upgraded to ${paymentOrder.tier} Plan successfully!`,
    user: verification.user,
  };
});

app.post("/api/downloads", { preHandler: authenticate }, async (request) => {
  const userId = (request as RequestWithAuth).auth.id;
  const { songId, bitrate } = z.object({ songId: z.string().min(1).max(128), bitrate: z.enum(["160k", "320k"]).default("320k") }).parse(request.body);

  const user = await db.user.findUnique({ where: { id: userId }, select: { plan: true, planExpiresAt: true } });
  if (!user) throw apiError(404, "User not found");

  const currentPlan = effectivePlan(user.plan, user.planExpiresAt);
  const downloadLimit = PLAN_DOWNLOAD_LIMITS[currentPlan];

  const currentDownloads = await db.download.count({ where: { userId } });
  const alreadyDownloaded = await db.download.findUnique({ where: { userId_songId: { userId, songId } } });

  if (!alreadyDownloaded && downloadLimit !== null && currentDownloads >= downloadLimit) {
    throw apiError(403, `Download limit reached (${currentDownloads}/${downloadLimit} songs). Upgrade to Good, Pro, or God plan to download more songs.`);
  }

  const song = await db.song.findFirst({
    where: { id: songId, isPublished: true, status: SongStatus.READY },
    select: { id: true, isExclusive: true, tierRequired: true, masterAudioKey: true, hlsMasterKey: true },
  });
  if (!song) throw apiError(404, "Song not found or not published");
  if (song.isExclusive) {
    const requiredRank = TIER_RANKS[song.tierRequired];
    const userRank = TIER_RANKS[currentPlan];
    if (userRank < requiredRank) {
      throw apiError(403, `Exclusive track requires ${song.tierRequired} subscription plan or higher.`);
    }
  }

  const licenseExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const download = await db.download.upsert({
    where: { userId_songId: { userId, songId } },
    create: {
      userId,
      songId,
      bitrate,
      licenseExpiresAt,
    },
    update: {
      downloadedAt: new Date(),
      licenseExpiresAt,
    },
  });

  const audioKey = song.masterAudioKey ?? (song.hlsMasterKey ? song.hlsMasterKey.replace("master.m3u8", `${bitrate.replace("k", "")}.m3u8`) : null);
  const downloadUrl = audioKey && storageAccessKey && storageSecretKey
    ? await getSignedUrl(storage, new GetObjectCommand({ Bucket: AUDIO_BUCKET, Key: audioKey }), { expiresIn: 86400 }).catch(() => null)
    : null;
  if (!downloadUrl) throw apiError(503, "Audio file is unavailable in storage. Please try again after processing completes.");

  return {
    success: true,
    downloadId: download.id,
    downloadUrl,
    licenseExpiresAt: licenseExpiresAt.toISOString(),
    remainingDownloads: downloadLimit === null ? null : Math.max(0, downloadLimit - (alreadyDownloaded ? currentDownloads : currentDownloads + 1)),
  };
});


// ==========================================
// 🔍 Meilisearch Endpoint
// ==========================================
app.get("/api/search", async (request) => {
  const { q, limit } = z.object({ q: z.string().min(1), limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(request.query);
  const meiliUrl = process.env.MEILISEARCH_URL ?? "http://meilisearch:7700";
  const meiliKey = process.env.MEILISEARCH_MASTER_KEY ?? "streamify-meilisearch-master-key";

  const res = await fetch(`${meiliUrl}/indexes/songs/search`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${meiliKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ q, limit })
  }).catch(() => null);

  const payload = res?.ok ? await res.json() as { hits: { id: string }[] } : null;
  const songIds = payload?.hits.map(h => h.id) ?? [];

  if (songIds.length === 0) return { data: [] };

  const records = await db.song.findMany({
    where: { id: { in: songIds }, isPublished: true, status: SongStatus.READY },
    include: { creator: { select: { displayName: true, avatarUrl: true } } }
  });

  const byId = new Map(records.map(r => [r.id, r]));
  // Hydrate while preserving Meilisearch relevance order
  const data = songIds.map(id => byId.get(id)).filter((s): s is NonNullable<typeof s> => s !== undefined).map(publicSong);

  return { data, source: "meilisearch" };
});

// ==========================================
// Follows & Activity Feed
// ==========================================
app.post("/api/users/:userId/follow", { preHandler: authenticate }, async (request) => {
  const followerId = (request as RequestWithAuth).auth.id;
  const { userId: followeeId } = z.object({ userId: z.string().cuid() }).parse(request.params);
  
  if (followerId === followeeId) throw apiError(400, "Cannot follow yourself");
  
  await db.follow.upsert({
    where: { followerId_followeeId: { followerId, followeeId } },
    create: { followerId, followeeId },
    update: {}
  });
  return { followed: true };
});

app.delete("/api/users/:userId/follow", { preHandler: authenticate }, async (request) => {
  const followerId = (request as RequestWithAuth).auth.id;
  const { userId: followeeId } = z.object({ userId: z.string().cuid() }).parse(request.params);
  
  await db.follow.deleteMany({
    where: { followerId, followeeId }
  });
  return { followed: false };
});

app.get("/api/feed", { preHandler: authenticate }, async (request) => {
  const userId = (request as RequestWithAuth).auth.id;
  const { cursor, limit } = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(request.query);
  
  const follows = await db.follow.findMany({ where: { followerId: userId }, select: { followeeId: true } });
  const feedActorIds = follows.map(f => f.followeeId).concat([userId]); // Include own events too
  
  const events = await db.feedEvent.findMany({
    where: { actorId: { in: feedActorIds } },
    take: limit + 1,
    ...(cursor ? { cursor: { id: BigInt(cursor) }, skip: 1 } : {}),
    orderBy: { createdAt: "desc" },
    include: {
      actor: { select: { id: true, displayName: true, avatarUrl: true } },
      song: { include: { creator: { select: { displayName: true, avatarUrl: true } } } }
    }
  });
  
  const hasNext = events.length > limit;
  const data = events.slice(0, limit);
  return {
    data: data.map(formatFeedEvent),
    nextCursor: hasNext ? events[limit - 1]?.id.toString() : null
  };
});

app.get("/api/feed/stream", { preHandler: authenticate }, async (request, reply) => {
  const userId = (request as RequestWithAuth).auth.id;
  
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });
  reply.raw.write("\n"); // initial flush
  
  const client = { userId, reply };
  feedClients.add(client);
  
  request.raw.on("close", () => {
    feedClients.delete(client);
  });
  
  // Keep connection open indefinitely
  return new Promise(() => {});
});

app.get("/api/downloads/verify", { preHandler: authenticate }, async (request) => {
  const userId = (request as RequestWithAuth).auth.id;
  const activeDownloads = await db.download.findMany({
    where: {
      userId,
      licenseExpiresAt: { gt: new Date() },
      song: { isPublished: true },
    },
    select: { songId: true, licenseExpiresAt: true },
  });

  return {
    validSongIds: activeDownloads.map((d) => d.songId),
    count: activeDownloads.length,
    checkedAt: new Date().toISOString(),
  };
});

app.get("/api/downloads", { preHandler: authenticate }, async (request) => {
  const userId = (request as RequestWithAuth).auth.id;
  const records = await db.download.findMany({
    where: { userId },
    orderBy: { downloadedAt: "desc" },
    include: {
      song: {
        include: {
          creator: { select: { displayName: true, avatarUrl: true } },
        },
      },
    },
  });

  return {
    data: records.map((r) => ({
      id: r.id,
      downloadedAt: r.downloadedAt,
      licenseExpiresAt: r.licenseExpiresAt,
      bitrate: r.bitrate,
      song: publicSong(r.song),
    })),
  };
});

// ==========================================
// 🎤 Synced Lyrics Endpoint
// ==========================================
const groqTranscriptionSchema = z.object({
  segments: z.array(z.object({
    start: z.number().nonnegative(),
    text: z.string(),
  })),
});

async function getStoredLyrics(songId: string) {
  try {
    const storedLyrics = await storage.send(new GetObjectCommand({
      Bucket: AUDIO_BUCKET,
      Key: `lyrics/${songId}.lrc`,
    }));
    return storedLyrics.Body ? await storedLyrics.Body.transformToString() : "";
  } catch (error) {
    if (error instanceof NoSuchKey) return "";
    throw error;
  }
}

app.get("/api/songs/:songId/lyrics", async (request) => {
  const { songId } = z.object({ songId: z.string().min(1).max(128) }).parse(request.params);
  const song = await db.song.findFirst({
    where: { id: songId, isPublished: true },
    select: { id: true },
  });
  if (!song) throw apiError(404, "Song not found");

  return { songId, lyrics: await getStoredLyrics(songId), format: "lrc" };
});

app.post("/api/songs/:songId/lyrics/transcribe", { preHandler: authenticate }, async (request) => {
  const { songId } = z.object({ songId: z.string().min(1).max(128) }).parse(request.params);
  const { authorizedToTranscribe } = z.object({ authorizedToTranscribe: z.literal(true) }).parse(request.body);
  const userId = (request as RequestWithAuth).auth.id;
  const song = await db.song.findUnique({
    where: { id: songId },
    select: { id: true, creatorId: true, status: true, masterAudioKey: true },
  });
  if (!song) throw apiError(404, "Song not found");
  if (song.creatorId !== userId) throw apiError(403, "Only the song's creator can request transcription");
  if (!authorizedToTranscribe) throw apiError(400, "Confirm that you own or are authorized to transcribe this audio");
  if (song.status !== SongStatus.READY || !song.masterAudioKey) {
    throw apiError(409, "The original audio file is not ready for transcription");
  }

  const existingLyrics = await getStoredLyrics(songId);
  if (existingLyrics) return { songId, lyrics: existingLyrics, format: "lrc" };

  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) throw apiError(503, "Audio transcription is not configured. Set GROQ_API_KEY on the API server.");

  const audioObject = await storage.send(new GetObjectCommand({
    Bucket: AUDIO_BUCKET,
    Key: song.masterAudioKey,
  }));
  if (!audioObject.Body) throw apiError(503, "The original audio file could not be read from storage");
  if (audioObject.ContentLength !== undefined && audioObject.ContentLength > 25 * 1024 * 1024) {
    throw apiError(413, "This audio file exceeds Groq's 25 MB transcription upload limit");
  }

  const audioBytes = await audioObject.Body.transformToByteArray();
  if (audioBytes.byteLength > 25 * 1024 * 1024) {
    throw apiError(413, "This audio file exceeds Groq's 25 MB transcription upload limit");
  }

  const fileName = song.masterAudioKey.split("/").pop() || "audio.mp3";
  const form = new FormData();
  const audioFileBuffer = Uint8Array.from(audioBytes).buffer as ArrayBuffer;
  form.append("file", new Blob([audioFileBuffer], { type: audioObject.ContentType ?? "application/octet-stream" }), fileName);
  form.append("model", "whisper-large-v3-turbo");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");

  const groqResponse = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${groqApiKey}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (!groqResponse.ok) {
    request.log.error({ statusCode: groqResponse.status }, "Groq audio transcription request failed");
    throw apiError(502, "Groq could not transcribe this audio. Check the API key, account limits, and audio format.");
  }

  let transcriptionPayload: unknown;
  try {
    transcriptionPayload = await groqResponse.json();
  } catch {
    throw apiError(502, "Groq returned an unreadable transcription response");
  }
  const transcription = groqTranscriptionSchema.safeParse(transcriptionPayload);
  if (!transcription.success || transcription.data.segments.length === 0) {
    throw apiError(502, "Groq returned no timestamped transcription for this audio");
  }

  const lyrics = transcription.data.segments
    .filter((segment) => segment.text.trim())
    .map((segment) => {
      const centiseconds = Math.floor(segment.start * 100);
      const minutes = Math.floor(centiseconds / 6000);
      const seconds = Math.floor((centiseconds % 6000) / 100);
      const fraction = centiseconds % 100;
      return `[${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(fraction).padStart(2, "0")}] ${segment.text.trim()}`;
    })
    .join("\n");
  if (!lyrics) throw apiError(502, "Groq returned no usable transcript for this audio");

  await storage.send(new PutObjectCommand({
    Bucket: AUDIO_BUCKET,
    Key: `lyrics/${songId}.lrc`,
    Body: lyrics,
    ContentType: "text/plain; charset=utf-8",
  }));

  return { songId, lyrics, format: "lrc" };
});

// ==========================================
// 🎛 Daily Mixes Endpoints
// ==========================================
app.get("/api/mixes", { preHandler: authenticate }, async (request) => {
  const userId = (request as RequestWithAuth).auth.id;
  const userMixes = await db.playlist.findMany({
    where: { userId, isMix: true },
    orderBy: { updatedAt: "desc" },
    include: {
      songs: {
        orderBy: { position: "asc" },
        include: {
          song: {
            include: { creator: { select: { displayName: true, avatarUrl: true } } },
          },
        },
      },
    },
  });

  return {
    mixes: userMixes.map((mix) => ({
      id: mix.id,
      name: mix.name,
      description: mix.description,
      coverUrl: mix.coverUrl,
      mixSeed: mix.mixSeed,
      songs: mix.songs.map((item) => publicSong(item.song)),
    })),
  };
});

// ==========================================
// 🔔 Push Notifications Endpoints
// ==========================================
app.post("/api/push/subscribe", { preHandler: authenticate }, async (request) => {
  const userId = (request as RequestWithAuth).auth.id;
  const body = z.object({
    endpoint: z.string().url(),
    p256dh: z.string().min(10),
    auth: z.string().min(10),
  }).parse(request.body);

  const sub = await db.pushSubscription.upsert({
    where: { endpoint: body.endpoint },
    create: {
      userId,
      endpoint: body.endpoint,
      p256dh: body.p256dh,
      auth: body.auth,
    },
    update: {
      userId,
      p256dh: body.p256dh,
      auth: body.auth,
    },
  });

  return { subscribed: true, id: sub.id };
});

app.post("/api/push/test", { preHandler: authenticate }, async (request) => {
  const userId = (request as RequestWithAuth).auth.id;
  const subs = await db.pushSubscription.findMany({ where: { userId } });
  return {
    sent: true,
    recipientCount: subs.length,
    message: "Push notifications active with quiet hours (8am - 10pm)",
  };
});

const close = async () => { await transcodeQueue.close(); radioCache.disconnect(); await db.$disconnect(); await app.close(); };
process.on("SIGTERM", () => void close());
process.on("SIGINT", () => void close());
await app.listen({ port: Number(process.env.PORT ?? 4000), host: process.env.HOST ?? "::" });
