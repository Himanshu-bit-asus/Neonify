import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });
const rootDatabaseUrl = process.env.DATABASE_URL;
loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env"), override: true });
if (process.env.NODE_ENV !== "production" && rootDatabaseUrl) {
  process.env.DATABASE_URL = rootDatabaseUrl;
}

import { Worker, Queue } from "bullmq";
import { PrismaClient, SongStatus } from "@prisma/client";
import { GetObjectCommand, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createWriteStream, promises as fs } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import type { Readable } from "node:stream";

// Try to load sharp (optional - falls back gracefully if not installed)
let sharp: any = null;
try {
  const sharpModule = await import("sharp");
  sharp = sharpModule.default;
} catch {
  console.warn("[worker] sharp not available — cover resizing skipped");
}

const exec = promisify(execFile);
const localRequire = createRequire(import.meta.url);
const bundledFfmpegPath = localRequire("ffmpeg-static") as string | null;
const bundledFfprobe = localRequire("ffprobe-static") as { path?: string };
const ffmpegPath = process.env.FFMPEG_PATH ?? bundledFfmpegPath ?? "ffmpeg";
const ffprobePath = process.env.FFPROBE_PATH ?? bundledFfprobe.path ?? "ffprobe";
const db = new PrismaClient();
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

// Original S3 bucket (legacy HLS uploads)
const legacyBucket = process.env.S3_BUCKET ?? "streamify-media";
const legacyStorage = new S3Client({
  region: process.env.S3_REGION ?? "us-east-1",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: Boolean(process.env.S3_ENDPOINT),
  credentials: process.env.S3_ACCESS_KEY
    ? { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY ?? "" }
    : undefined,
});

// Supabase S3-compatible storage (service role)
const supabaseStorage = new S3Client({
  region: process.env.SUPABASE_REGION ?? process.env.S3_REGION ?? "ap-south-1",
  endpoint: process.env.SUPABASE_STORAGE_URL ?? process.env.supabase_storage_url,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.SUPABASE_STORAGE_ACCESS_KEY ?? process.env.supabase_storage_access_key ?? "",
    secretAccessKey: process.env.SUPABASE_STORAGE_SECRET_KEY ?? process.env.supabase_storage_secret_key ?? "",
  },
});
const supabaseStorageConfigured = Boolean(
  (process.env.SUPABASE_STORAGE_URL ?? process.env.supabase_storage_url)
  && (process.env.SUPABASE_STORAGE_ACCESS_KEY ?? process.env.supabase_storage_access_key)
  && (process.env.SUPABASE_STORAGE_SECRET_KEY ?? process.env.supabase_storage_secret_key),
);
const coverBucket = process.env.COVER_BUCKET ?? (supabaseStorageConfigured ? "covers" : legacyBucket);

async function uploadToSupabase(filePath: string, bucket: string, key: string, contentType: string) {
  const body = await fs.readFile(filePath);
  await supabaseStorage.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: "public, max-age=31536000, immutable",
  }));
}

async function uploadFile(path: string, key: string, contentType: string) {
  await legacyStorage.send(new PutObjectCommand({
    Bucket: legacyBucket,
    Key: key,
    Body: await fs.readFile(path),
    ContentType: contentType,
    CacheControl: "public, max-age=31536000, immutable",
  }));
}

async function uploadProcessedFile(path: string, bucket: string, key: string, contentType: string) {
  if (supabaseStorageConfigured) {
    await uploadToSupabase(path, bucket, key, contentType);
    return;
  }
  await uploadFile(path, key, contentType);
}

const indexQueue = new Queue("index-sync", { connection: { url: redisUrl } });
const transcodeQueue = new Queue("transcode", { connection: { url: redisUrl } });

// ============================================
// MEDIA WORKER — transcode + cover resize
// ============================================
const worker = new Worker<{ songId: string; masterAudioKey: string; creatorId?: string }>("transcode", async (job) => {
  // Only handle transcode-song jobs (ignore play-event etc.)
  if (job.name === "play-event") return;

  const song = await db.song.findUniqueOrThrow({ where: { id: job.data.songId } });
  const creatorId = job.data.creatorId ?? song.creatorId;
  const directory = await mkdtemp(join(tmpdir(), "neonify-transcode-"));

  try {
    await job.updateProgress(5);

    // ── 1. Download master ──
    const inputPath = join(directory, "source");
    let masterBody: Readable | null = null;

    // Try Supabase first (new upload format)
    try {
      const supabaseResult = await supabaseStorage.send(new GetObjectCommand({
        Bucket: "song-audio",
        Key: job.data.masterAudioKey,
      }));
      masterBody = supabaseResult.Body as Readable;
    } catch {
      // Fallback to legacy S3
      const legacyResult = await legacyStorage.send(new GetObjectCommand({
        Bucket: legacyBucket,
        Key: job.data.masterAudioKey,
      }));
      masterBody = legacyResult.Body as Readable;
    }

    if (!masterBody) throw new Error("Master audio not found in any storage");
    await pipeline(masterBody, createWriteStream(inputPath));
    await job.updateProgress(15);

    // ── 2. ffprobe duration + metadata ──
    const probeResult = await exec(ffprobePath, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=nw=1:nk=1",
      inputPath,
    ]);
    const duration = Math.max(1, Math.round(Number(probeResult.stdout.trim())));
    await job.updateProgress(20);

    // ── 3. Transcode to 320k and 160k MP3 ──
    for (const bitrate of [320, 160] as const) {
      const outPath = join(directory, `${bitrate}k.mp3`);
      await exec(ffmpegPath, [
        "-y",
        "-i", inputPath,
        "-vn",
        "-c:a", "libmp3lame",
        "-b:a", `${bitrate}k`,
        "-ar", "44100",
        "-ac", "2",
        "-af", "loudnorm=I=-14:TP=-1.5:LRA=11",
        outPath,
      ]);
      await job.updateProgress(bitrate === 320 ? 45 : 65);

      // Store processed audio alongside the original upload provider.
      const mp3Key = `${creatorId}/${song.id}/audio/${bitrate}k.mp3`;
      await uploadProcessedFile(outPath, supabaseStorageConfigured ? "song-audio" : legacyBucket, mp3Key, "audio/mpeg");
    }
    await job.updateProgress(70);

    // Also generate HLS for backwards compatibility (to existing S3)
    try {
      for (const bitrate of [160, 320]) {
        await exec(ffmpegPath, ["-y", "-i", inputPath, "-vn", "-c:a", "aac", "-b:a", `${bitrate}k`,
          "-f", "hls", "-hls_time", "6", "-hls_playlist_type", "vod",
          "-hls_segment_filename", join(directory, `${bitrate}_%03d.ts`),
          join(directory, `${bitrate}.m3u8`)]);
      }
      const master = ["#EXTM3U", "#EXT-X-VERSION:3",
        "#EXT-X-STREAM-INF:BANDWIDTH=176000,CODECS=\"mp4a.40.2\"", "160.m3u8",
        "#EXT-X-STREAM-INF:BANDWIDTH=352000,CODECS=\"mp4a.40.2\"", "320.m3u8", ""].join("\n");
      await fs.writeFile(join(directory, "master.m3u8"), master);
      const hlsPrefix = `hls/${song.id}`;
      for (const filename of await fs.readdir(directory)) {
        if (filename === "source" || filename.endsWith(".mp3")) continue;
        await uploadFile(join(directory, filename), `${hlsPrefix}/${filename}`,
          filename.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t");
      }
      await db.song.update({ where: { id: song.id }, data: { hlsMasterKey: `${hlsPrefix}/master.m3u8` } });
    } catch (hlsErr) {
      console.warn("[worker] HLS generation failed (non-fatal):", hlsErr);
    }
    await job.updateProgress(75);

    // ── 4. Cover art resize (if uploaded) ──
    let coverArtKey: string | null = song.coverArtKey;
    const coverInputPath = join(directory, "cover_original");
    let hasCover = false;
    const coverKeys = [
      song.coverArtKey,
      ...[".jpg", ".jpeg", ".png", ".webp"].map((extension) => `${creatorId}/${song.id}/cover${extension}`),
    ].filter((key): key is string => Boolean(key && !key.startsWith("http://") && !key.startsWith("https://")));
    const coverStorage = supabaseStorageConfigured ? supabaseStorage : legacyStorage;

    for (const coverKey of [...new Set(coverKeys)]) {
      try {
        const result = await coverStorage.send(new GetObjectCommand({ Bucket: coverBucket, Key: coverKey }));
        if (result.Body) {
          await pipeline(result.Body as Readable, createWriteStream(coverInputPath));
          hasCover = true;
          break;
        }
      } catch { /* try the next possible cover key */ }
    }

    if (hasCover && sharp) {
      for (const size of [150, 640, 1500] as const) {
        const outPath = join(directory, `cover_${size}.jpg`);
        await sharp(coverInputPath)
          .resize(size, size, { fit: "cover", position: "center" })
          .jpeg({ quality: 85 })
          .toFile(outPath);
        const coverKey = `${creatorId}/${song.id}/${size}.jpg`;
        await uploadProcessedFile(outPath, coverBucket, coverKey, "image/jpeg");
        if (size === 640) coverArtKey = coverKey;
      }
    }
    await job.updateProgress(90);

    // ── 5. Update DB: READY ──
    await db.song.update({
      where: { id: song.id },
      data: {
        status: SongStatus.READY,
        isPublished: true,
        durationSeconds: duration,
        ...(coverArtKey ? { coverArtKey } : {}),
      },
    });
    await job.updateProgress(95);

    // ── 6. Invalidate Redis caches ──
    try {
      const { default: Redis } = await import("ioredis");
      const redis = new (Redis as unknown as { new(url: string): { del: (...keys: string[]) => Promise<void>; quit: () => Promise<void> } })(redisUrl);
      await redis.del(`library:${creatorId}`, `reco:${creatorId}`);
      await redis.quit();
    } catch { /* cache invalidation is best-effort */ }

    // ── 7. Enqueue search index sync ──
    await indexQueue.add("sync", {
      id: song.id,
      title: song.title,
      artist_name: song.artistName,
      album_title: song.album ?? "",
      genre: song.genre,
      tags: song.tags,
    });

    await job.updateProgress(100);
    console.info("[worker] transcode completed", { jobId: job.id, songId: song.id, duration });

  } catch (error) {
    console.error("[worker] transcode failed", { jobId: job.id, songId: song.id, error });
    await db.song.update({ where: { id: song.id }, data: { status: SongStatus.FAILED } }).catch(() => undefined);
    throw error;
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}, {
  connection: { url: redisUrl },
  concurrency: Number(process.env.TRANSCODE_CONCURRENCY ?? 4),
});

worker.on("failed", (job, error) => console.error("[worker] transcode failed", { jobId: job?.id, error: error.message }));
worker.on("completed", (job) => console.info("[worker] transcode completed", { jobId: job.id }));

// ============================================
// MEILISEARCH INDEX WORKER
// ============================================
const meiliUrl = process.env.MEILISEARCH_URL ?? "http://meilisearch:7700";
const meiliKey = process.env.MEILISEARCH_MASTER_KEY ?? "streamify-meilisearch-master-key";

const indexWorker = new Worker<{ id: string; title: string; artist_name: string; album_title: string; genre: string; tags: string[] }>("index-sync", async (job) => {
  const doc = job.data;
  await fetch(`${meiliUrl}/indexes/songs/settings`, {
    method: "PATCH",
    headers: { "Authorization": `Bearer ${meiliKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      searchableAttributes: ["title", "artist_name", "album_title", "genre"],
      typoTolerance: { enabled: true },
    }),
  }).catch(() => null);

  const res = await fetch(`${meiliUrl}/indexes/songs/documents`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${meiliKey}`, "Content-Type": "application/json" },
    body: JSON.stringify([doc]),
  });
  if (!res.ok) throw new Error(`Meilisearch failed: ${await res.text()}`);
}, { connection: { url: redisUrl } });

indexWorker.on("failed", (job, error) => console.error("[worker] index-sync failed", { jobId: job?.id, error: error.message }));

// ============================================
// PLAY EVENT WORKER
// ============================================
const playEventWorker = new Worker<{ userId: string; songId: string; durationPlayed?: number; completed?: boolean; bitrate?: string }>("transcode", async (job) => {
  if (job.name !== "play-event") return; // only handle play-event jobs
  // ML analytics — fire and forget
  const ML_URL = process.env.ML_SERVICE_URL ?? "http://ml:8000";
  await fetch(`${ML_URL}/events/play`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(job.data),
  }).catch(() => undefined);
}, { connection: { url: redisUrl }, concurrency: 10 });

playEventWorker.on("failed", () => undefined); // ignore failures

// ============================================
// NIGHTLY CLEANUP JOB
// ============================================
async function cleanupOrphans() {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const orphaned = await db.song.findMany({
      where: {
        OR: [
          { status: SongStatus.FAILED, createdAt: { lt: sevenDaysAgo } },
          { status: SongStatus.PROCESSING, createdAt: { lt: sevenDaysAgo } },
        ],
      },
      select: { id: true, creatorId: true, masterAudioKey: true },
    });

    for (const song of orphaned) {
      // Delete from Supabase storage
      try {
        const prefix = `${song.creatorId}/${song.id}/`;
        const listed = await supabaseStorage.send(new ListObjectsV2Command({
          Bucket: "song-audio",
          Prefix: prefix,
        }));
        if (listed.Contents?.length) {
          await supabaseStorage.send(new DeleteObjectsCommand({
            Bucket: "song-audio",
            Delete: { Objects: listed.Contents.map(o => ({ Key: o.Key! })) },
          }));
        }
      } catch { /* best effort */ }
      // Delete DB row
      await db.song.delete({ where: { id: song.id } }).catch(() => undefined);
    }
    console.info(`[cleanup] Removed ${orphaned.length} orphaned songs`);
  } catch (err) {
    console.error("[cleanup] Failed:", err);
  }
}

async function selfHealBrokenSongs() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const broken = await db.$queryRaw<Array<{ song_id: string; failures: bigint; total: bigint }>>`
    SELECT song_id,
      COUNT(*) FILTER (WHERE status IN ('error', 'blocked')) AS failures,
      COUNT(*) AS total
    FROM playback_errors
    WHERE created_at >= ${since}
    GROUP BY song_id
    HAVING COUNT(*) >= 5
      AND COUNT(*) FILTER (WHERE status IN ('error', 'blocked'))::float / COUNT(*) > 0.05
  `;

  for (const item of broken) {
    const song = await db.song.findUnique({ where: { id: item.song_id } });
    if (!song?.masterAudioKey) continue;
    try {
      await supabaseStorage.send(new HeadObjectCommand({ Bucket: "song-audio", Key: song.masterAudioKey }));
      await db.song.update({ where: { id: song.id }, data: { status: SongStatus.PROCESSING, isPublished: false } });
      await transcodeQueue.add("transcode-song", {
        songId: song.id, masterAudioKey: song.masterAudioKey, creatorId: song.creatorId,
      }, { jobId: `self-heal:${song.id}:${Date.now()}`, attempts: 5, backoff: { type: "exponential", delay: 5_000 } });
      console.warn("[self-heal] queued reprocess", { songId: song.id, failures: String(item.failures), total: String(item.total) });
    } catch {
      await db.song.update({ where: { id: song.id }, data: { status: SongStatus.FAILED, isPublished: false } });
      console.warn("[self-heal] hid missing source", { songId: song.id });
    }
  }
}

// Run cleanup on start and schedule nightly
void cleanupOrphans();
setInterval(cleanupOrphans, 24 * 60 * 60 * 1000);
void selfHealBrokenSongs().catch((err) => console.error("[self-heal] failed:", err));
setInterval(() => void selfHealBrokenSongs().catch((err) => console.error("[self-heal] failed:", err)), 24 * 60 * 60 * 1000);

process.on("SIGTERM", async () => {
  await worker.close();
  await indexWorker.close();
  await playEventWorker.close();
  await db.$disconnect();
});

process.on("SIGINT", async () => {
  await worker.close();
  await indexWorker.close();
  await playEventWorker.close();
  await db.$disconnect();
  process.exit(0);
});
