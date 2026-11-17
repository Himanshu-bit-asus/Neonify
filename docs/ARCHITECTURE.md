# Streamify architecture

## Services and boundaries

| Service | Responsibility | Scaling boundary |
| --- | --- | --- |
| `web` | Next.js App Router UI, player state, React Query client integration | Stateless; CDN/cache rendered assets |
| `api` | Fastify REST API, authorization, profiles, library, playback ticketing | Stateless replicas behind an ALB/Nginx |
| `worker` | BullMQ jobs for FFmpeg transcode and event aggregation | Scale by queue depth; isolate CPU-heavy nodes |
| `postgres` | Durable identities, catalog, library, listening-event source of truth | Managed PostgreSQL with PITR and read replicas |
| `redis` | BullMQ, recommendation cache, rate-limit state | Managed Redis with encryption and eviction policy |
| `minio` / S3 / R2 | Master source files, cover art, HLS playlists and segments | Private bucket; CloudFront/R2 CDN public edge |
| `ml` | ALS model serving and 24-hour recommendation cache | Independent CPU service; scheduled retrainer |

## Identity

The intended production identity provider is Clerk: enable Phone OTP and Google in its dashboard. `@clerk/nextjs` renders the sign-in controls in the web app and obtains a short-lived session JWT with `sub = clerkId`. Calls from the browser to the separate API send that token in the `Authorization: Bearer` header.

The Fastify API (the equivalent of an authentication guard in this service) validates the Clerk JWT signature against `CLERK_JWKS_URL`, expiry, optional issuer/audience, and the allowed `azp` origins in `CLERK_AUTHORIZED_PARTIES`. It upserts the `users` profile by `clerk_id` as a recovery path for a missed webhook, then reads the Streamify-specific `role` only from PostgreSQL. Clerk never grants application roles through token claims.

Configure a Clerk webhook endpoint at `https://<api-host>/webhooks/clerk` and subscribe to `user.created`, `user.updated`, and `user.deleted`. The endpoint verifies the Svix signature with `CLERK_WEBHOOK_SIGNING_SECRET` before it writes anything. Create and update events mirror the primary email, phone, display name, and avatar into `users`; deletes remove the matching user record (and its cascading application data). The handler is idempotent, so Clerk retries are safe. Do not put the webhook signing secret or `CLERK_SECRET_KEY` in browser-visible environment variables.

For local setup, set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_JWKS_URL`, `CLERK_ISSUER`, `CLERK_AUTHORIZED_PARTIES=http://localhost:3000`, and `CLERK_WEBHOOK_SIGNING_SECRET` in `.env`. The visual demo remains usable without a Clerk key, but it will not issue authenticated API calls until one is configured.

For a self-managed migration path, the schema includes hashed refresh tokens and OTP records. Keep access tokens short-lived (15 minutes), rotate refresh tokens, hash OTPs, enforce one-time usage, and call Twilio Verify rather than sending SMS directly. Never log bearer tokens, OTPs, or signed URLs.

## Playback and uploads

1. A creator requests an upload intent. The API issues a short-lived S3 PUT URL and creates a `PROCESSING` song.
2. The worker downloads the original, runs FFprobe, creates 160 and 320 kbps AAC HLS variants with six-second segments, uploads them under `hls/<song-id>/`, then marks the song `READY`.
3. An authenticated listener requests `/api/songs/:id/stream`; in production the API returns a 60-second CloudFront signed URL or signed cookie scoped to the HLS prefix. The web app plays the HLS master playlist through native Safari HLS or hls.js.
4. Client heartbeats at 15 seconds, every 30 seconds, on pause, and on completion. The API writes immutable listening events; counters and Recent Plays are derived asynchronously or transactionally.

The web preview uses a generated WAV endpoint only to demonstrate the native `<audio>` controls without shipping licensed tracks. Replace it with the signed HLS URL adapter for production.

## Recommendations

`services/ml/train.py` compacts the last 180 days of listening events into an implicit-feedback matrix. Play duration is weighted and completed plays receive a bonus. The scheduled job trains ALS, writes per-user song IDs atomically, and the FastAPI service stores returned IDs in Redis for 24 hours. The API falls back to published songs ordered by plays when the model has no history. Invalidate the user cache after a meaningful listen or like.

## Operational checklist

- Put the web and API behind TLS; set restrictive CORS origins, CSP, HSTS, and secure cookies.
- Use CloudFront/R2 signed delivery. The bucket must not permit arbitrary writes or source-master reads.
- Apply database migrations through CI, never `db push` in a production release.
- Add IP + account rate limits to OTP, auth, upload intents, and playback ticket endpoints.
- Run FFmpeg workers with CPU/memory limits and virus/mime validation before transcoding.
- Send structured Pino logs to Loki/CloudWatch, metrics to Prometheus/Grafana, and runtime errors to Sentry with PII scrubbing.
- Back up PostgreSQL, Redis queue metadata as needed, and model artifacts; test restore procedures.
