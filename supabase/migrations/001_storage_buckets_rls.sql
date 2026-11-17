-- ============================================
-- Supabase Storage Buckets + RLS Policies
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)
-- Project: ayscaqekmarchfbsowkf
-- ============================================

-- Create buckets (INSERT ... ON CONFLICT DO UPDATE handles re-runs)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'song-audio',
    'song-audio',
    false,
    262144000, -- 250 MB
    ARRAY['audio/mpeg','audio/wav','audio/flac','audio/x-wav','audio/aac','audio/ogg']
  ),
  (
    'covers',
    'covers',
    true,
    10485760, -- 10 MB
    ARRAY['image/jpeg','image/png','image/webp']
  ),
  (
    'media-extra',
    'media-extra',
    true,
    5242880, -- 5 MB
    ARRAY['text/plain','text/x-lrc','application/octet-stream']
  )
ON CONFLICT (id) DO UPDATE SET
  public            = EXCLUDED.public,
  file_size_limit   = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================
-- song-audio bucket RLS policies (PRIVATE)
-- Layout: {creatorId}/{songId}/master/original.<ext>
--         {creatorId}/{songId}/audio/320k.mp3
--         {creatorId}/{songId}/audio/160k.mp3
-- ============================================

-- Authenticated users can READ any song (for streaming via signed URL)
DROP POLICY IF EXISTS "Authenticated read song-audio" ON storage.objects;
CREATE POLICY "Authenticated read song-audio"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'song-audio');

-- Creator can only INSERT into their own {creatorId}/ folder
-- storage.foldername(name) returns ARRAY of path segments
-- [1] = first segment = creatorId
DROP POLICY IF EXISTS "Creator write own folder song-audio" ON storage.objects;
CREATE POLICY "Creator write own folder song-audio"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'song-audio'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Creator can UPDATE files in their own folder
DROP POLICY IF EXISTS "Creator update own folder song-audio" ON storage.objects;
CREATE POLICY "Creator update own folder song-audio"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'song-audio'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Creator can DELETE files in their own folder
DROP POLICY IF EXISTS "Creator delete own folder song-audio" ON storage.objects;
CREATE POLICY "Creator delete own folder song-audio"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'song-audio'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================
-- covers bucket RLS policies (PUBLIC CDN)
-- Layout: {creatorId}/{songId}/150.jpg | 640.jpg | 1500.jpg
-- ============================================

-- Anyone (anon + authenticated) can read covers
DROP POLICY IF EXISTS "Public read covers" ON storage.objects;
CREATE POLICY "Public read covers"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'covers');

-- Creator can write to their own folder
DROP POLICY IF EXISTS "Creator write own folder covers" ON storage.objects;
CREATE POLICY "Creator write own folder covers"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'covers'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Creator can update their own folder
DROP POLICY IF EXISTS "Creator update own folder covers" ON storage.objects;
CREATE POLICY "Creator update own folder covers"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'covers'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Creator can delete their own folder
DROP POLICY IF EXISTS "Creator delete own folder covers" ON storage.objects;
CREATE POLICY "Creator delete own folder covers"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'covers'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================
-- media-extra bucket RLS policies (PUBLIC)
-- Layout: {creatorId}/{songId}/lyrics.lrc
-- ============================================

-- Anyone can read media-extra (lyrics, waveforms)
DROP POLICY IF EXISTS "Public read media-extra" ON storage.objects;
CREATE POLICY "Public read media-extra"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'media-extra');

-- Creator can write to their own folder
DROP POLICY IF EXISTS "Creator write own folder media-extra" ON storage.objects;
CREATE POLICY "Creator write own folder media-extra"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'media-extra'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Creator can update their own folder
DROP POLICY IF EXISTS "Creator update own folder media-extra" ON storage.objects;
CREATE POLICY "Creator update own folder media-extra"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'media-extra'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
