# Supabase Storage Setup Guide

## Step 1: Run the SQL Migration

Open [Supabase SQL Editor](https://supabase.com/dashboard/project/ayscaqekmarchfbsowkf/sql) and run the contents of:

```
supabase/migrations/001_storage_buckets_rls.sql
```

This creates 3 buckets with correct RLS policies:
- `song-audio` → **PRIVATE** (stream via signed URLs only)
- `covers` → **PUBLIC** (CDN-served cover art)
- `media-extra` → **PUBLIC** (lyrics / waveforms)

## Step 2: Get Your Storage Service Role Credentials

In Supabase Dashboard → **Project Settings → API**:

| Variable | Where to find it |
|---|---|
| `SUPABASE_URL` | Project URL (e.g. `https://ayscaqekmarchfbsowkf.supabase.co`) |
| `SUPABASE_STORAGE_URL` | `https://ayscaqekmarchfbsowkf.storage.supabase.co/storage/v1/s3` |
| `SUPABASE_STORAGE_ACCESS_KEY` | S3 Access Key (from Storage → Settings → S3 Connection) |
| `SUPABASE_STORAGE_SECRET_KEY` | S3 Secret Key (same place) |

## Step 3: Update Environment Variables

In both `.env` and `apps/api/.env`, add:

```env
SUPABASE_URL=https://ayscaqekmarchfbsowkf.supabase.co
SUPABASE_STORAGE_URL=https://ayscaqekmarchfbsowkf.storage.supabase.co/storage/v1/s3
SUPABASE_REGION=ap-south-1
SUPABASE_STORAGE_ACCESS_KEY=<from-supabase-dashboard>
SUPABASE_STORAGE_SECRET_KEY=<from-supabase-dashboard>
```

> ⚠️ **CRITICAL**: The `SUPABASE_STORAGE_SECRET_KEY` (service role secret) must NEVER be exposed to the frontend. It is used only by the backend API and worker processes.

## Bucket Folder Layout

```
song-audio (PRIVATE)
├── {creatorId}/{songId}/master/original.<ext>   ← Creator uploads here directly
├── {creatorId}/{songId}/audio/320k.mp3          ← Worker generates these
└── {creatorId}/{songId}/audio/160k.mp3

covers (PUBLIC - CDN)
├── {creatorId}/{songId}/150.jpg
├── {creatorId}/{songId}/640.jpg   ← URL stored in DB as cover_art_key
└── {creatorId}/{songId}/1500.jpg

media-extra (PUBLIC)
└── {creatorId}/{songId}/lyrics.lrc
```

## Upload Flow

```
Creator Frontend                    Backend API              Supabase Storage        BullMQ Worker
     │                                   │                        │                       │
     │  POST /api/songs/upload-url        │                        │                       │
     │──────────────────────────────────►│                        │                       │
     │                                   │  createSignedUploadUrl │                       │
     │                                   │───────────────────────►│                       │
     │  { songId, signedUrl, path }       │                        │                       │
     │◄──────────────────────────────────│                        │                       │
     │                                   │                        │                       │
     │  PUT {signedUrl} (file bytes)      │                        │                       │
     │───────────────────────────────────────────────────────────►│                       │
     │  Upload progress (XHR onprogress)  │                        │                       │
     │                                   │                        │                       │
     │  POST /api/songs/:id/complete      │                        │                       │
     │──────────────────────────────────►│  enqueue BullMQ job    │                       │
     │                                   │────────────────────────────────────────────────►│
     │  { queued: true }                  │                        │                       │
     │◄──────────────────────────────────│                        │  download master      │
     │                                   │                        │◄──────────────────────│
     │  [Poll /api/songs/:id every 2s]    │                        │  ffprobe + transcode  │
     │  status: PROCESSING → READY        │                        │  upload 320k/160k.mp3 │
     │                                   │                        │───────────────────────►│
     │                                   │  UPDATE status=READY   │                       │
     │                                   │◄───────────────────────────────────────────────│
     │  TanStack Query auto-refetch       │                        │                       │
     │  stops (READY detected)            │                        │                       │
     │  invalidate ['library','songs']    │                        │                       │
     │  Song appears in HomeView rows     │                        │                       │
```

## Streaming Flow

```
User clicks Play           Backend API              Supabase song-audio
      │                        │                          │
      │  GET /api/songs/:id/stream                        │
      │  (x-bitrate: 320)      │                          │
      │───────────────────────►│                          │
      │                        │  createSignedUrl(3600s)  │
      │                        │─────────────────────────►│
      │  { streamUrl, duration }│                          │
      │◄───────────────────────│                          │
      │                        │                          │
      │  <audio src={streamUrl}>                          │
      │  (direct to Supabase CDN, no backend involved)    │
```
