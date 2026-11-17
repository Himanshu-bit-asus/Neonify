create table if not exists public.playback_errors (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  song_id text not null references public.songs(id) on delete cascade,
  status varchar(10) not null,
  error_code varchar(80),
  bitrate varchar(10),
  attempt integer not null default 0,
  buffered_ms integer,
  user_agent varchar(500),
  created_at timestamptz not null default now()
);
create index if not exists playback_errors_song_created_idx on public.playback_errors(song_id, created_at);
create index if not exists playback_errors_status_created_idx on public.playback_errors(status, created_at);
