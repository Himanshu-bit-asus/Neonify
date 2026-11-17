"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine, Bell, CheckCircle2, ChevronLeft, ChevronRight, CirclePlus, Clock, Clock3,
  Coins, Crown, DollarSign, DownloadCloud, Ellipsis, Flame, Grid2X2, Heart, Home, Library, ListMusic,
  Lock, Loader2, Mic2, Music2, Pause, Play, Plus, Radio, Repeat2, Search, Settings2,
  Shuffle, SkipBack, SkipForward, Sliders, Sparkles, Trash2, TrendingUp, Trophy, Upload, Volume2, WifiOff, X, Zap
} from "lucide-react";
import { songs, genres, type Song } from "@/lib/catalog";
import { CoverArt } from "@/components/cover-art";
import { AuthControls } from "@/components/auth-controls";
import { useApiToken } from "@/components/auth-provider";
import { usePlayer } from "@/components/player-provider";
import { LyricsModal } from "@/components/lyrics-modal";
import { AudioVisualizer } from "@/components/audio-visualizer";
import { cn, formatTime } from "@/lib/utils";
import { UploadDialog } from "@/components/upload-dialog";
import { NeonBar } from "@/components/neon-bar";
import { FloatingAlexaOrb } from "@/components/floating-alexa-orb";


type View = "home" | "search" | "library" | "leaderboard" | "creator" | "neon";
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api").replace(/\/$/, "");

const ACCENT_PALETTES = [
  "from-indigo-700 via-violet-500 to-fuchsia-400",
  "from-amber-300 via-orange-500 to-rose-500",
  "from-fuchsia-800 via-purple-800 to-slate-950",
  "from-sky-400 via-cyan-600 to-blue-950",
  "from-pink-300 via-rose-500 to-red-600",
  "from-lime-300 via-emerald-500 to-green-950",
  "from-orange-200 via-stone-500 to-stone-900",
  "from-cyan-300 via-indigo-700 to-slate-950",
  "from-yellow-100 via-amber-300 to-orange-600",
  "from-blue-200 via-indigo-700 to-slate-950",
];

function normalizeCatalogSearch(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

function mapRemoteSong(item: Record<string, unknown>, index: number): Song | null {
  if (typeof item.id !== "string" || typeof item.title !== "string") return null;
  const fallback = songs[index % songs.length];
  const rawCover = typeof item.coverArtUrl === "string" && item.coverArtUrl.trim()
    ? item.coverArtUrl
    : typeof item.cover === "string" && item.cover.trim()
    ? item.cover
    : null;

  const resolvedCover = rawCover
    ? rawCover.startsWith("http")
      ? rawCover
      : `${API_URL}${rawCover.startsWith("/") ? "" : "/"}${rawCover}`
    : `procedural-${item.id}`;

  const assignedAccent = typeof item.accent === "string" && item.accent
    ? item.accent
    : ACCENT_PALETTES[index % ACCENT_PALETTES.length];

  return {
    ...fallback,
    id: item.id,
    title: item.title,
    artist: typeof item.artist === "string" ? item.artist : typeof item.artistName === "string" ? item.artistName : "Unknown artist",
    album: typeof item.album === "string" ? item.album : "Single",
    genre: typeof item.genre === "string" ? item.genre : fallback.genre,
    duration: typeof item.durationSeconds === "number" ? item.durationSeconds : item.isImported === true ? 0 : fallback.duration,
    plays: typeof item.playCount === "string" ? item.playCount : "New",
    cover: resolvedCover,
    accent: assignedAccent,
    audioUrl: typeof item.audioUrl === "string" ? item.audioUrl : undefined,
    isImported: item.isImported === true,
    isExclusive: item.isExclusive === true,
    tierRequired: item.tierRequired === "GOOD" || item.tierRequired === "PRO" || item.tierRequired === "GOD" ? item.tierRequired : "FREE",
  };
}

async function fetchCatalogPages(path: string): Promise<Array<Record<string, unknown>>> {
  const items: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;

  do {
    const isClient = typeof window !== "undefined";
    const base = isClient ? window.location.origin : (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");
    const url = new URL(`/api${path.startsWith("/") ? "" : "/"}${path}`, base);
    url.searchParams.set("limit", "50");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url.toString(), { cache: "no-store" });
    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Catalog request to ${path} failed with HTTP ${response.status}${details ? `: ${details.slice(0, 200)}` : ""}`);
    }
    const page = await response.json() as { data?: Array<Record<string, unknown>>; nextCursor?: string | null };
    if (!Array.isArray(page.data)) throw new Error("Catalog response is missing its data list");
    items.push(...page.data);
    cursor = page.nextCursor ?? null;
  } while (cursor);

  return items;
}

  const nav = [
  ["home", Home, "Home"],
  ["search", Search, "Search"],
  ["library", Library, "Your Library"],
  ["leaderboard", Trophy, "Leaderboard"],
    ["neon", Sparkles, "Neon"],
] as const;

interface DailyMix {
  id: string;
  title: string;
  subtitle: string;
  art: string;
  songs: Song[];
}

type UserPlaylist = {
  id: string;
  title: string;
  songIds: string[];
};

const USER_PLAYLISTS_STORAGE_KEY = "streamify-user-playlists";
const LOCAL_LEADERBOARD_STORAGE_KEY = "streamify-local-leaderboard-stats";

const defaultDailyMixes: DailyMix[] = [
  { id: "mix-1", title: "Daily Mix 1", subtitle: "Nova Lane, coastline, Milo Rae", art: "midnight", songs: [songs[0], songs[7], songs[1], songs[5]] },
  { id: "mix-2", title: "Chill Mix", subtitle: "Sage Wilder, Léon, Hana Tsu", art: "focus", songs: [songs[6], songs[9], songs[8], songs[3]] },
  { id: "mix-3", title: "Energy Mix", subtitle: "Juno Park, KIRA, Amara", art: "discovery", songs: [songs[5], songs[2], songs[4], songs[0]] },
  { id: "mix-4", title: "Focus Flow", subtitle: "Deep synth & ambient rhythms", art: "sunset", songs: [songs[3], songs[0], songs[7], songs[9]] },
];

function IconButton({ children, label, onClick, active = false, className }: { children: React.ReactNode; label: string; onClick?: () => void; active?: boolean; className?: string }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} className={cn("grid h-9 w-9 place-items-center rounded-full text-zinc-400 transition hover:bg-white/10 hover:text-white", active && "bg-white text-black hover:bg-white hover:text-black", className)}>{children}</button>;
}

function SectionHeading({ title, action }: { title: string; action?: string }) {
  return <div className="mb-4 flex items-end justify-between gap-4"><h2 className="text-xl font-bold tracking-tight md:text-2xl">{title}</h2>{action && <button className="text-xs font-bold uppercase tracking-[.12em] text-zinc-400 hover:text-white">{action}</button>}</div>;
}

function SongRow({ song, index, compact = false }: { song: Song; index: number; compact?: boolean }) {
  const { current, play, toggleLike, liked, addToQueue, downloadedIds, downloadingIds, downloadSong, removeDownload, startRadio, userPlan, setSubscriptionModalOpen } = usePlayer();
  const active = current?.id === song.id;
  const isDownloaded = downloadedIds.has(song.id);
  const isDownloading = downloadingIds.has(song.id);
  const tierRanks: Record<string, number> = { FREE: 0, GOOD: 1, PRO: 2, GOD: 3 };
  const isLocked = song.isExclusive && song.tierRequired && tierRanks[userPlan] < tierRanks[song.tierRequired];

  const tierIcon = song.tierRequired === "GOD" ? <Flame className="h-2.5 w-2.5" /> : song.tierRequired === "PRO" ? <Crown className="h-2.5 w-2.5" /> : <Zap className="h-2.5 w-2.5" />;
  const tierColor = song.tierRequired === "GOD" ? "bg-amber-500/20 text-amber-300 border-amber-500/30" : song.tierRequired === "PRO" ? "bg-lime-300/15 text-lime-300 border-lime-300/30" : "bg-blue-500/20 text-blue-300 border-blue-500/30";

  return <div className={cn("group grid items-center gap-3 rounded-md px-2 py-2 text-sm transition hover:bg-white/[.07]", compact ? "grid-cols-[24px_42px_minmax(0,1fr)_auto]" : "grid-cols-[24px_46px_minmax(0,1.25fr)_minmax(0,1fr)_70px_64px] md:grid-cols-[28px_48px_minmax(0,1.4fr)_minmax(0,1fr)_80px_72px]", active && "bg-white/[.09]") }>
    <button type="button" aria-label={`Play ${song.title}`} className="relative grid h-7 place-items-center text-zinc-400" onClick={() => isLocked ? setSubscriptionModalOpen(true) : (active ? play() : play(song))}>
      <span className={cn("group-hover:hidden", active && "hidden")}>{index + 1}</span>
      {isLocked ? <Lock className="hidden h-4 w-4 text-zinc-400 group-hover:block" /> : <Play className={cn("hidden h-4 w-4 fill-white text-white group-hover:block", active && "block")} />}
    </button>
    <div className="relative">
      <CoverArt art={song.cover} accent={song.accent} className="h-10 w-10 rounded" />
      {isLocked && <div className="absolute inset-0 flex items-center justify-center rounded bg-black/60"><Lock className="h-3 w-3 text-zinc-300" /></div>}
    </div>
    <div className="min-w-0">
      <p className={cn("truncate font-medium flex items-center gap-1.5", active ? "text-lime-300" : "text-white")}>
        {song.title}
        {isDownloaded && <span title="Available Offline" className="inline-block h-1.5 w-1.5 rounded-full bg-lime-400" />}
        {song.isExclusive && song.tierRequired && (
          <span className={cn("inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider", tierColor)}>
            {tierIcon}{song.tierRequired}
          </span>
        )}
      </p>
      <p className="truncate text-xs text-zinc-400">{song.artist}</p>
    </div>
    {!compact && <p className="hidden truncate text-zinc-400 md:block">{song.album}</p>}
    {!compact && <p className="hidden text-right text-xs text-zinc-400 md:block">{formatTime(song.duration)}</p>}
    <div className="flex items-center justify-end gap-1">
      {isLocked ? (
        <button type="button" onClick={() => setSubscriptionModalOpen(true)} className="flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-300 opacity-0 transition hover:bg-amber-500/20 group-hover:opacity-100">
          <Lock className="h-3 w-3" /> Unlock
        </button>
      ) : (
        <>
          {!song.isImported && (
            <>
              <button
                type="button"
                title={isDownloaded ? "Downloaded (Click to remove)" : isDownloading ? "Downloading..." : "Download for offline listening"}
                className={cn(
                  "p-1.5 text-zinc-500 transition hover:text-white",
                  isDownloaded ? "text-lime-300 opacity-100" : isDownloading ? "animate-pulse text-lime-300 opacity-100" : "opacity-0 group-hover:opacity-100"
                )}
                onClick={() => (isDownloaded ? removeDownload(song.id) : downloadSong(song))}
              >
                <ArrowDownToLine className={cn("h-4 w-4", isDownloaded && "stroke-[2.5]")} />
              </button>
              <button type="button" className={cn("p-1.5", liked.has(song.id) ? "text-lime-300" : "text-zinc-500 opacity-0 group-hover:opacity-100")} aria-label={`Like ${song.title}`} onClick={() => toggleLike(song.id)}>
                <Heart className={cn("h-4 w-4", liked.has(song.id) && "fill-current")} />
              </button>
              <button
                type="button"
                title="Go to Radio — infinite autoplay from this track"
                className="p-1 text-zinc-500 opacity-0 transition hover:text-lime-300 group-hover:opacity-100"
                aria-label={`Start radio from ${song.title}`}
                onClick={() => startRadio(song)}
              >
                <Radio className="h-4 w-4" />
              </button>
            </>
          )}
          <button type="button" className="p-1 text-zinc-500 opacity-0 transition hover:text-white group-hover:opacity-100" aria-label={`Add ${song.title} to queue`} onClick={() => addToQueue(song)}>
            <CirclePlus className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  </div>;
}

function SongCard({ song }: { song: Song }) {
  const { current, playing, play, toggleLike, liked, downloadedIds, startRadio, userPlan, setSubscriptionModalOpen } = usePlayer();
  const isCurrent = current?.id === song.id;
  const isDownloaded = downloadedIds.has(song.id);
  const tierRanks: Record<string, number> = { FREE: 0, GOOD: 1, PRO: 2, GOD: 3 };
  const isLocked = song.isExclusive && song.tierRequired && tierRanks[userPlan] < tierRanks[song.tierRequired];
  const tierColor = song.tierRequired === "GOD" ? "bg-amber-500/80 text-black" : song.tierRequired === "PRO" ? "bg-lime-300 text-black" : "bg-blue-500 text-white";

  return <article className="group relative min-w-[142px] max-w-[168px] flex-1 rounded-lg p-2.5 transition hover:bg-white/[.08]">
    <div className="relative mb-3 aspect-square overflow-hidden rounded-md shadow-xl">
      <CoverArt art={song.cover} accent={song.accent} className="h-full w-full" label={`${song.title} cover art`} />
      {isDownloaded && (
        <span className="absolute top-2 left-2 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-bold text-lime-300 backdrop-blur-sm">
          Offline
        </span>
      )}
      {song.isExclusive && song.tierRequired && (
        <span className={cn("absolute top-2 right-2 rounded-full px-1.5 py-0.5 text-[9px] font-black backdrop-blur-sm", tierColor)}>
          {song.tierRequired}
        </span>
      )}
      {isLocked ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
          <Lock className="h-6 w-6 text-white mb-1" />
          <button onClick={() => setSubscriptionModalOpen(true)} className="rounded-full bg-white/20 px-2.5 py-0.5 text-[10px] font-bold text-white hover:bg-white/30">Unlock</button>
        </div>
      ) : (
        /* Play / Radio hover controls */
        <div className="absolute inset-x-0 bottom-0 flex translate-y-2 items-center justify-between px-2 pb-2 opacity-0 transition duration-200 group-hover:translate-y-0 group-hover:opacity-100">
          {!song.isImported && (
            <button
              type="button"
              title="Go to Radio"
              aria-label={`Start radio from ${song.title}`}
              onClick={() => startRadio(song)}
              className="grid h-8 w-8 place-items-center rounded-full bg-black/60 text-lime-300 backdrop-blur-sm transition hover:scale-105 hover:bg-black/80"
            >
              <Radio className="h-4 w-4" />
            </button>
          )}
          <button type="button" onClick={() => isCurrent ? (playing ? undefined : play()) : play(song)} aria-label={`Play ${song.title}`} className="grid h-11 w-11 place-items-center rounded-full bg-lime-300 text-black shadow-lg transition hover:scale-105 hover:bg-lime-200">
            {isCurrent && playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="ml-0.5 h-5 w-5 fill-current" />}
          </button>
        </div>
      )}
    </div>
    <div className="flex min-w-0 items-start gap-1">
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-bold">{song.title}</h3>
        <p className="truncate pt-0.5 text-xs text-zinc-400">{song.artist}</p>
      </div>
      {!song.isImported && (
        <button onClick={() => toggleLike(song.id)} aria-label={`Like ${song.title}`} className={cn("mt-0.5 text-zinc-500 transition hover:text-lime-300", liked.has(song.id) && "text-lime-300")}>
          <Heart className={cn("h-4 w-4", liked.has(song.id) && "fill-current")} />
        </button>
      )}
    </div>
  </article>;
}

function DailyMixCard({ mix }: { mix: DailyMix }) {
  const { playQueue } = usePlayer();
  return (
    <article className="group relative min-w-[160px] max-w-[190px] flex-1 rounded-xl p-3 transition hover:bg-white/[.08] bg-white/[.03] border border-white/[.06]">
      <div className="relative mb-3 aspect-square overflow-hidden rounded-lg shadow-xl">
        <CoverArt art={mix.art} className="h-full w-full" label={`${mix.title} cover`} />
        <button
          type="button"
          onClick={() => playQueue(mix.songs)}
          aria-label={`Play ${mix.title}`}
          className="absolute bottom-2.5 right-2.5 grid h-11 w-11 translate-y-2 place-items-center rounded-full bg-lime-300 text-black opacity-0 shadow-lg transition duration-200 hover:scale-105 hover:bg-lime-200 group-hover:translate-y-0 group-hover:opacity-100"
        >
          <Play className="ml-0.5 h-5 w-5 fill-current" />
        </button>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-lime-300" />
          <h3 className="truncate text-sm font-black text-white">{mix.title}</h3>
        </div>
        <p className="line-clamp-2 pt-1 text-xs text-zinc-400 leading-snug">{mix.subtitle}</p>
      </div>
    </article>
  );
}

function Hero({ onDiscover, featuredSong, hydrated }: { onDiscover: () => void; featuredSong?: Song; hydrated: boolean }) {
  const { play, startRadio, radioActive, radioLoading, isOffline } = usePlayer();
  const showOffline = hydrated && isOffline;
  return <section className="relative mb-9 min-h-[265px] overflow-hidden rounded-xl border border-white/[.08] bg-[#1b1c27] p-6 shadow-2xl sm:min-h-[300px] sm:p-8">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_20%,rgba(151,115,255,.62),transparent_24%),radial-gradient(circle_at_88%_84%,rgba(162,225,45,.22),transparent_22%),linear-gradient(112deg,#171721_5%,#28233b_50%,#1a1a24)]" />
    <div className="absolute right-[-30px] top-[-34px] hidden h-[370px] w-[370px] rounded-full border-[48px] border-fuchsia-400/25 shadow-[0_0_100px_rgba(185,105,255,.38)] sm:block" />
    <div className="absolute right-[14%] top-[26%] hidden h-32 w-32 rotate-[19deg] rounded-[34px] bg-gradient-to-br from-pink-400 to-violet-800 shadow-2xl sm:block"><div className="absolute inset-[20%] rounded-full border-[14px] border-black/50" /></div>
    <div className="relative z-10 max-w-[490px]">
      <div className="mb-4 flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[.13em] text-lime-200">
        {showOffline ? (
          <span className="flex items-center gap-1.5 text-amber-300">
            <WifiOff className="h-3.5 w-3.5" /> Offline Mode Active
          </span>
        ) : radioActive ? (
          "Radio is on"
        ) : (
          <><Sparkles className="h-3.5 w-3.5" /> Fresh for you</>
        )}
      </div>
      <p className="mb-1 text-sm font-semibold text-zinc-300">DISCOVER YOUR NEXT OBSESSION</p>
      <h1 className="max-w-md text-balance text-4xl font-black leading-[.98] tracking-[-.055em] sm:text-5xl">Sound that <span className="text-lime-300">moves</span> with you.</h1>
      <p className="mt-4 max-w-sm text-sm leading-6 text-zinc-300">A hand-picked mix shaped by your late-night listening.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button onClick={() => featuredSong ? play(featuredSong) : onDiscover()} className="inline-flex h-10 items-center gap-2 rounded-full bg-lime-300 px-5 text-sm font-bold text-[#172000] transition hover:scale-[1.03] hover:bg-lime-200"><Play className="h-4 w-4 fill-current" /> Play mix</button>
        <button onClick={() => startRadio(featuredSong)} disabled={!hydrated || !featuredSong || radioLoading || showOffline} className="inline-flex h-10 items-center gap-2 rounded-full border border-white/25 bg-black/15 px-5 text-sm font-bold transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"><Sparkles className="h-4 w-4" /> {radioLoading ? "Tuning radio…" : "Start radio"}</button>
        <button onClick={onDiscover} className="rounded-full border border-white/25 bg-black/15 px-5 text-sm font-bold transition hover:bg-white/10">Discover</button>
      </div>
    </div>
    {featuredSong && (
      <button type="button" onClick={() => play(featuredSong)} className="group absolute bottom-6 right-6 hidden w-[248px] items-center gap-3 rounded-lg border border-white/15 bg-black/30 p-3 text-left backdrop-blur-md transition hover:bg-black/45 sm:flex">
        <CoverArt art={featuredSong.cover} accent={featuredSong.accent} className="h-16 w-16 shrink-0 rounded-md shadow-2xl transition duration-300 group-hover:scale-105" label={`${featuredSong.title} cover art`} />
        <span className="min-w-0">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-[.14em] text-lime-300">Now in your library</span>
          <span className="block truncate text-sm font-black text-white">{featuredSong.title}</span>
          <span className="block truncate text-xs text-zinc-300">{featuredSong.artist}</span>
          <span className="mt-1 block text-[10px] text-zinc-500">{featuredSong.genre} · {formatTime(featuredSong.duration)}</span>
        </span>
        <Play className="h-4 w-4 shrink-0 fill-lime-300 text-lime-300 opacity-70 transition group-hover:scale-110 group-hover:opacity-100" />
      </button>
    )}
  </section>;
}

function HomeView({ onDiscover, remoteSongs, hydrated }: { onDiscover: () => void; remoteSongs: Song[]; hydrated: boolean }) {
  type LibrarySong = { id: string; title: string; artist: string; album: string; genre: string; duration: number; cover: string; accent: string; playCount: number };
  type LibraryData = { recommended: LibrarySong[]; recommendedStrategy: string; trending: LibrarySong[] };

  const [libraryData, setLibraryData] = useState<LibraryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [customGenre, setCustomGenre] = useState("All");
  const getApiToken = useApiToken();
  const { play, playQueue, liked } = usePlayer();

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const token = await getApiToken();
        if (!token) return;
        const response = await fetch(`${API_URL}/me/library`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = response.ok ? await response.json() as LibraryData : null;
        if (!cancelled && data?.recommended?.length) setLibraryData(data);
      } catch {
        // The local catalog remains available when personalization is offline.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [getApiToken]);

  // Keep the full catalog available to Search and Library, but make Home a focused personalized shelf.
  const allSongs = hydrated ? (remoteSongs.length ? remoteSongs : songs) : [];
  const visibleLibraryData = hydrated ? libraryData : null;
  const recommendationIds = new Set(visibleLibraryData?.recommended?.map((song) => song.id) ?? []);
  const likedGenres = new Set(allSongs.filter((song) => liked.has(song.id)).map((song) => song.genre));
  const visibleSongs = [...allSongs]
    .sort((left, right) => {
      const leftScore = (liked.has(left.id) ? 4 : 0) + (recommendationIds.has(left.id) ? 3 : 0) + (likedGenres.has(left.genre) ? 1 : 0);
      const rightScore = (liked.has(right.id) ? 4 : 0) + (recommendationIds.has(right.id) ? 3 : 0) + (likedGenres.has(right.genre) ? 1 : 0);
      return rightScore - leftScore;
    })
    .slice(0, 12);
  const catalogSongs = allSongs;
  const recommendedSongs: Song[] = visibleLibraryData?.recommended?.length
    ? (visibleLibraryData.recommended as unknown as Song[])
    : catalogSongs.slice(0, 8);

  const trendingSongs: Song[] = visibleLibraryData?.trending?.length
    ? (visibleLibraryData.trending as unknown as Song[])
    : catalogSongs.slice(4, 9);

  const customGenres = ["All", ...Array.from(new Set(visibleSongs.map((song) => song.genre))).slice(0, 5)];
  const filteredCustomSongs = customGenre === "All"
    ? visibleSongs
    : visibleSongs.filter((song) => song.genre === customGenre);
  const spotlightSong = filteredCustomSongs[0];
  const latestSongs = visibleSongs.slice(0, 6);
  const genreShelves = Array.from(new Set(visibleSongs.map((song) => song.genre)))
    .slice(0, 3)
    .map((genre) => ({ genre, songs: visibleSongs.filter((song) => song.genre === genre).slice(0, 4) }));

  const playCustomCollection = (shuffle = false) => {
    if (!filteredCustomSongs.length) return;
    playQueue(filteredCustomSongs, shuffle);
  };

  const isPersonalized = visibleLibraryData?.recommendedStrategy === "als" || visibleLibraryData?.recommendedStrategy === "cached-als";
  const dailyMixes = visibleSongs.length
    ? defaultDailyMixes.map((mix, mixIndex) => ({
      ...mix,
      songs: Array.from({ length: Math.min(4, visibleSongs.length) }, (_, index) => visibleSongs[(mixIndex * 4 + index) % visibleSongs.length]),
    }))
    : [];
  const isLoading = !hydrated || loading;

  return <>
    <Hero onDiscover={onDiscover} featuredSong={visibleSongs[0]} hydrated={hydrated} />

    {visibleSongs.length > 0 && (
      <section className="mb-10">
        <div className="relative mb-5 overflow-hidden rounded-xl border border-lime-300/15 bg-lime-300/[.06] p-5 sm:p-6">
          <div className="absolute right-[-50px] top-[-80px] h-48 w-48 rounded-full border-[28px] border-lime-300/10" />
          <div className="relative z-10 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="max-w-xl">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-[.14em] text-lime-300">Picked for you</p>
              <h2 className="text-2xl font-black tracking-tight md:text-3xl">Your most wanted.</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-300">The tracks rising to the top of your listening world.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => playCustomCollection()} className="inline-flex h-9 items-center gap-2 rounded-full bg-lime-300 px-4 text-xs font-black text-[#172000] transition hover:bg-lime-200">
                  <Play className="h-3.5 w-3.5 fill-current" /> Play all
                </button>
                <button type="button" onClick={() => playCustomCollection(true)} className="inline-flex h-9 items-center gap-2 rounded-full border border-white/20 bg-black/20 px-4 text-xs font-bold text-white transition hover:bg-white/10">
                  <Shuffle className="h-3.5 w-3.5" /> Shuffle collection
                </button>
              </div>
            </div>
            {spotlightSong && (
              <button type="button" onClick={() => play(spotlightSong)} className="group flex min-w-0 items-center gap-3 text-left md:max-w-[280px]">
                <CoverArt art={spotlightSong.cover} accent={spotlightSong.accent} className="h-14 w-14 shrink-0 rounded-md shadow-xl transition group-hover:scale-105" />
                <span className="min-w-0">
                  <span className="block text-[10px] font-bold uppercase tracking-[.12em] text-lime-300">Continue with</span>
                  <span className="block truncate text-sm font-bold text-white">{spotlightSong.title}</span>
                  <span className="block truncate text-xs text-zinc-400">{spotlightSong.artist}</span>
                </span>
                <Play className="h-4 w-4 shrink-0 fill-lime-300 text-lime-300 opacity-60 transition group-hover:opacity-100" />
              </button>
            )}
          </div>
        </div>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-xl font-bold tracking-tight md:text-2xl">Most wanted</h3>
            <p className="mt-1 text-xs text-zinc-500">{filteredCustomSongs.length} of {visibleSongs.length} tracks</p>
          </div>
          <div className="flex max-w-full gap-1 overflow-x-auto rounded-full bg-white/[.05] p-1">
            {customGenres.map((genre) => (
              <button key={genre} type="button" onClick={() => setCustomGenre(genre)} className={cn("shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold transition", customGenre === genre ? "bg-white text-black" : "text-zinc-400 hover:text-white")}>
                {genre}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-hidden rounded-lg bg-white/[.035] p-1 sm:p-2">
          <div className="hidden grid-cols-[28px_48px_minmax(0,1.4fr)_minmax(0,1fr)_80px_72px] gap-3 border-b border-white/[.07] px-2 py-2 text-[11px] font-semibold uppercase tracking-[.1em] text-zinc-500 md:grid">
            <span>#</span><span></span><span>Title</span><span>Album</span><span className="text-right">Time</span><span></span>
          </div>
          {filteredCustomSongs.map((song, index) => <SongRow key={song.id} song={song} index={index} />)}
        </div>
      </section>
    )}

    {visibleSongs.length > 0 && (
      <section className="mb-10">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-[.14em] text-lime-300">Fresh from storage</p>
            <h2 className="text-xl font-bold tracking-tight md:text-2xl">Latest releases</h2>
          </div>
          <span className="text-xs font-bold uppercase tracking-[.12em] text-zinc-500">{visibleSongs.length} total</span>
        </div>
        <div className="hide-scrollbar -mx-2 flex gap-1 overflow-x-auto px-2 pb-2">
          {latestSongs.map((song) => <SongCard key={song.id} song={song} />)}
        </div>
      </section>
    )}

    {/* 🎛 Daily Mixes section */}
    {dailyMixes.length > 0 && (
      <section className="mb-10">
        <SectionHeading title="Made for you" action="Daily Mixes" />
        <div className="hide-scrollbar -mx-2 flex gap-3 overflow-x-auto px-2 pb-2">
          {dailyMixes.map((mix) => (
            <DailyMixCard key={mix.id} mix={mix} />
          ))}
        </div>
      </section>
    )}

    {genreShelves.map(({ genre, songs: shelfSongs }) => (
      <section key={genre} className="mb-10">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-[.14em] text-zinc-500">From your catalog</p>
            <h2 className="text-xl font-bold tracking-tight md:text-2xl">{genre} nights</h2>
          </div>
          <button type="button" onClick={() => setCustomGenre(genre)} className="text-xs font-bold uppercase tracking-[.12em] text-zinc-400 hover:text-white">Browse {genre}</button>
        </div>
        <div className="hide-scrollbar -mx-2 flex gap-1 overflow-x-auto px-2 pb-2">
          {shelfSongs.map((song) => <SongCard key={song.id} song={song} />)}
        </div>
      </section>
    ))}

    {/* 🤖 Recommended for you (ML-powered) */}
    <section className="mb-10">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <h2 className="text-xl font-bold tracking-tight md:text-2xl">Recommended for you</h2>
          {!isLoading && (
            <span className={cn(
              "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider",
              isPersonalized ? "bg-lime-300/15 text-lime-300" : "bg-white/[.07] text-zinc-500"
            )}>
              {isPersonalized ? "✦ Personal" : "Popular"}
            </span>
          )}
        </div>
        <button className="text-xs font-bold uppercase tracking-[.12em] text-zinc-400 hover:text-white">Show all</button>
      </div>
      {isLoading ? (
        <div className="hide-scrollbar -mx-2 flex gap-1 overflow-x-auto px-2 pb-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="min-w-[142px] max-w-[168px] flex-1 animate-pulse rounded-lg p-2.5">
              <div className="mb-3 aspect-square rounded-md bg-white/[.07]" />
              <div className="mb-1.5 h-3 w-3/4 rounded bg-white/[.07]" />
              <div className="h-2.5 w-1/2 rounded bg-white/[.05]" />
            </div>
          ))}
        </div>
      ) : (
        <div className="hide-scrollbar -mx-2 flex gap-1 overflow-x-auto px-2 pb-1">
          {recommendedSongs.slice(0, 8).map((song) => <SongCard key={song.id} song={song} />)}
        </div>
      )}
    </section>

    {/* 📈 On the Rise (ML weighted trending) */}
    <section className="mb-10">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <h2 className="text-xl font-bold tracking-tight md:text-2xl">On the Rise</h2>
          <span className="rounded-full bg-orange-400/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-orange-300">Trending</span>
        </div>
        <button className="text-xs font-bold uppercase tracking-[.12em] text-zinc-400 hover:text-white">Show all</button>
      </div>
      <div className="rounded-lg bg-white/[.035] p-1 sm:p-2">
        <div className="hidden grid-cols-[28px_48px_minmax(0,1.4fr)_minmax(0,1fr)_80px_72px] gap-3 border-b border-white/[.07] px-2 py-2 text-[11px] font-semibold uppercase tracking-[.1em] text-zinc-500 md:grid">
          <span>#</span><span>Title</span><span /><span>Album</span><Clock3 className="h-3.5 w-3.5 justify-self-end" /><span />
        </div>
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="grid animate-pulse grid-cols-[28px_48px_1fr] gap-3 px-2 py-3">
                <div className="h-4 w-4 rounded bg-white/[.07]" />
                <div className="h-10 w-10 rounded bg-white/[.07]" />
                <div className="space-y-2">
                  <div className="h-3 w-2/3 rounded bg-white/[.07]" />
                  <div className="h-2.5 w-1/3 rounded bg-white/[.05]" />
                </div>
              </div>
            ))
          : trendingSongs.slice(0, 5).map((song, index) => <SongRow key={song.id} song={song} index={index} />)
        }
      </div>
    </section>

    {/* Fresh releases from the published catalog */}
    <section className="mb-10">
      <SectionHeading title="Fresh releases" action="Show all" />
      <div className="hide-scrollbar -mx-2 flex gap-1 overflow-x-auto px-2 pb-1">{visibleSongs.slice(0, 6).map((song) => <SongCard key={song.id} song={song} />)}</div>
    </section>
  </>;
}

function SearchView({ query, setQuery, catalogSongs }: { query: string; setQuery: (value: string) => void; catalogSongs: Song[] }) {
  const [visibleCount, setVisibleCount] = useState(50);
  const normalizedQuery = normalizeCatalogSearch(query);
  const matches = useMemo(
    () => catalogSongs.filter((song) => [song.title, song.artist, song.album, song.genre].some((value) => normalizeCatalogSearch(value).includes(normalizedQuery))),
    [catalogSongs, normalizedQuery],
  );
  const visibleSongs = matches.slice(0, visibleCount);

  useEffect(() => {
    setVisibleCount(50);
  }, [query]);

  return <>
    <section className="mb-10">
      <h1 className="mb-5 text-3xl font-black tracking-[-.04em]">Search music</h1>
      <label className="flex max-w-xl items-center gap-3 rounded-md bg-white/[.09] px-4 py-3 text-zinc-300 outline-none ring-lime-300/70 transition focus-within:ring-2">
        <Search className="h-5 w-5" />
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="What do you want to listen to?" className="w-full bg-transparent text-base text-white outline-none placeholder:text-zinc-400" />
        {query && <button onClick={() => setQuery("")} aria-label="Clear search"><X className="h-4 w-4" /></button>}
      </label>
    </section>
    {!query && (
      <section className="mb-10">
        <SectionHeading title="Browse genres" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {genres.map(([genre, gradient]) => (
            <button key={genre} onClick={() => setQuery(genre)} className={cn("relative h-28 overflow-hidden rounded-lg bg-gradient-to-br p-4 text-left shadow-lg transition hover:scale-[1.02]", gradient)}>
              <span className="relative z-10 text-xl font-black">{genre}</span>
              <Music2 className="absolute -bottom-2 -right-1 h-20 w-20 rotate-[24deg] text-white/25" />
            </button>
          ))}
        </div>
      </section>
    )}
    <section>
      <SectionHeading title={query ? `Results for “${query}”` : "All songs"} action={`${matches.length} tracks`} />
      <div className="rounded-lg bg-white/[.035] p-1 sm:p-2">
        {visibleSongs.length ? visibleSongs.map((song, index) => <SongRow key={song.id} song={song} index={index} />) : <p className="p-8 text-center text-sm text-zinc-400">No songs found. Try an artist, title, album, or genre.</p>}
      </div>
      {visibleCount < matches.length && (
        <button type="button" onClick={() => setVisibleCount((count) => count + 50)} className="mt-4 rounded-full border border-white/15 px-5 py-2 text-sm font-bold text-zinc-300 transition hover:bg-white/10 hover:text-white">
          Load more songs
        </button>
      )}
    </section>
  </>;
}

function LibraryView({
  catalogSongs,
  userPlaylists,
  selectedPlaylistId,
  onSelectPlaylist,
  onCreatePlaylist,
  onAddSong,
  onRemoveSong,
}: {
  catalogSongs: Song[];
  userPlaylists: UserPlaylist[];
  selectedPlaylistId: string | null;
  onSelectPlaylist: (playlistId: string | null) => void;
  onCreatePlaylist: () => void;
  onAddSong: (playlistId: string, song: Song) => void;
  onRemoveSong: (playlistId: string, songId: string) => void;
}) {
  const { liked, downloadedIds, playQueue } = usePlayer();
  const [isHydrated, setIsHydrated] = useState(false);
  const [addSongQuery, setAddSongQuery] = useState("");
  const likedSongs = catalogSongs.filter((song) => liked.has(song.id));
  const downloadedSongs = catalogSongs.filter((song) => downloadedIds.has(song.id));
  const selectedPlaylist = userPlaylists.find((playlist) => playlist.id === selectedPlaylistId);
  const isLikedPlaylist = selectedPlaylistId === "liked";
  const selectedPlaylistSongs = isLikedPlaylist
    ? likedSongs
    : selectedPlaylist
    ? selectedPlaylist.songIds.flatMap((id) => {
      const song = catalogSongs.find((item) => item.id === id);
      return song ? [song] : [];
    })
    : [];
  const addableSongs = selectedPlaylist
    ? catalogSongs.filter((song) => !selectedPlaylist.songIds.includes(song.id)
      && [song.title, song.artist, song.album].some((value) => normalizeCatalogSearch(value).includes(normalizeCatalogSearch(addSongQuery))))
      .slice(0, 8)
    : [];

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  if (selectedPlaylist || isLikedPlaylist) {
    return <>
      <section className="mb-8 flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-white/[.08] bg-gradient-to-br from-indigo-950/70 via-zinc-900 to-zinc-950 p-6 sm:p-8">
        <div>
          <button type="button" onClick={() => onSelectPlaylist(null)} className="mb-5 text-sm font-semibold text-zinc-400 transition hover:text-white">← Your library</button>
          <p className="mb-2 text-xs font-bold uppercase tracking-[.14em] text-lime-300">{isLikedPlaylist ? "Your collection" : "Playlist"}</p>
          <h1 className="text-4xl font-black tracking-[-.04em] sm:text-5xl">{isLikedPlaylist ? "Liked Songs" : selectedPlaylist?.title}</h1>
          <p className="mt-2 text-sm text-zinc-400">{selectedPlaylistSongs.length} {selectedPlaylistSongs.length === 1 ? "song" : "songs"}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" disabled={!selectedPlaylistSongs.length} onClick={() => playQueue(selectedPlaylistSongs, true)} aria-label="Shuffle playlist" className="grid h-11 w-11 place-items-center rounded-full border border-white/15 text-zinc-300 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"><Shuffle className="h-4 w-4" /></button>
          <button type="button" disabled={!selectedPlaylistSongs.length} onClick={() => playQueue(selectedPlaylistSongs)} className="inline-flex items-center gap-2 rounded-full bg-lime-300 px-5 py-3 text-sm font-black text-black transition hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-40">
            <Play className="h-4 w-4 fill-current" /> Play playlist
          </button>
        </div>
      </section>
      <section className="mb-8">
        <SectionHeading title="Songs" />
        <div className="rounded-lg bg-white/[.035] p-1 sm:p-2">
          {selectedPlaylistSongs.length
            ? selectedPlaylistSongs.map((song, index) => (
              <div key={song.id} className="group flex items-center gap-2">
                <div className="min-w-0 flex-1"><SongRow song={song} index={index} /></div>
                {selectedPlaylist && <button type="button" onClick={() => onRemoveSong(selectedPlaylist.id, song.id)} aria-label={`Remove ${song.title} from ${selectedPlaylist.title}`} className="mr-2 rounded-full p-2 text-zinc-500 transition hover:bg-white/10 hover:text-red-300"><Trash2 className="h-4 w-4" /></button>}
              </div>
            ))
            : <p className="p-8 text-center text-sm text-zinc-400">{isLikedPlaylist ? "Songs you like will appear here." : "This playlist is empty. Add songs below to get started."}</p>}
        </div>
      </section>
      {selectedPlaylist && <section>
        <SectionHeading title="Add songs" />
        <label className="mb-4 flex max-w-xl items-center gap-3 rounded-md bg-white/[.07] px-4 py-3 text-zinc-400 focus-within:ring-2 focus-within:ring-lime-300/70">
          <Search className="h-4 w-4" />
          <input value={addSongQuery} onChange={(event) => setAddSongQuery(event.target.value)} placeholder="Find a song to add" className="w-full bg-transparent text-sm text-white outline-none placeholder:text-zinc-500" />
        </label>
        <div className="rounded-lg bg-white/[.035] p-1 sm:p-2">
          {addableSongs.length
            ? addableSongs.map((song, index) => (
              <div key={song.id} className="group flex items-center gap-2">
                <div className="min-w-0 flex-1"><SongRow song={song} index={index} /></div>
                <button type="button" onClick={() => onAddSong(selectedPlaylist.id, song)} aria-label={`Add ${song.title} to ${selectedPlaylist.title}`} className="mr-2 rounded-full border border-white/10 px-3 py-1.5 text-xs font-bold text-zinc-300 transition hover:border-lime-300/40 hover:bg-lime-300/10 hover:text-lime-200">Add</button>
              </div>
            ))
            : <p className="p-6 text-center text-sm text-zinc-500">{addSongQuery ? "No matching songs to add." : "All songs are already in this playlist."}</p>}
        </div>
      </section>}
    </>;
  }

  return <>
    <section className="mb-9 flex items-end justify-between gap-4">
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-[.14em] text-lime-300">Your music</p>
        <h1 className="text-3xl font-black tracking-[-.04em]">Library</h1>
      </div>
      <button type="button" onClick={onCreatePlaylist} className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-black transition hover:scale-[1.02]"><Plus className="h-4 w-4" /> New playlist</button>
    </section>

    {/* 📥 Offline Downloads Tab */}
    <section className="mb-10">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight md:text-2xl flex items-center gap-2">
          <DownloadCloud className="h-5 w-5 text-lime-300" /> Downloaded Songs
        </h2>
        <span className="rounded-full bg-lime-300/10 px-2.5 py-0.5 text-xs font-bold text-lime-300 border border-lime-300/20">
          {downloadedSongs.length} / 100 Offline Tracks
        </span>
      </div>
      <div className="rounded-lg bg-white/[.035] p-1 sm:p-2">
        {downloadedSongs.length ? (
          downloadedSongs.map((song, index) => <SongRow song={song} index={index} key={song.id} />)
        ) : (
          <div className="p-8 text-center">
            <ArrowDownToLine className="mx-auto h-8 w-8 text-zinc-500 mb-2" />
            <p className="text-sm font-semibold text-white">No downloaded songs yet</p>
            <p className="text-xs text-zinc-400 mt-1">
              Tap the download icon on any track to listen offline anywhere.
            </p>
          </div>
        )}
      </div>
    </section>

    <section className="mb-10">
      <SectionHeading title="Playlists" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <button type="button" onClick={() => onSelectPlaylist("liked")} className="group rounded-xl border border-white/[.07] bg-white/[.03] p-3 text-left transition hover:border-lime-300/30 hover:bg-white/[.07]">
          <CoverArt art="liked" className="mb-3 aspect-square w-full rounded-lg shadow-xl" />
          <h3 className="truncate text-sm font-bold">Liked Songs</h3>
          <p className="truncate pt-1 text-xs text-zinc-400">{isHydrated ? `${liked.size} songs` : "Your favorites"}</p>
        </button>
        {userPlaylists.map((playlist, index) => (
          <button type="button" key={playlist.id} onClick={() => onSelectPlaylist(playlist.id)} className="group rounded-xl border border-white/[.07] bg-white/[.03] p-3 text-left transition hover:border-lime-300/30 hover:bg-white/[.07]">
            <div className="relative mb-3 aspect-square overflow-hidden rounded-lg shadow-xl">
              <CoverArt art={["midnight", "focus", "discovery", "sunset"][index % 4]} className="h-full w-full transition duration-300 group-hover:scale-105" />
              <span className="absolute inset-0 grid place-items-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/25 group-hover:opacity-100"><Play className="h-9 w-9 fill-current drop-shadow-lg" /></span>
            </div>
            <h3 className="truncate text-sm font-bold">{playlist.title}</h3>
            <p className="truncate pt-1 text-xs text-zinc-400">{playlist.songIds.length} {playlist.songIds.length === 1 ? "song" : "songs"}</p>
          </button>
        ))}
        <button type="button" onClick={onCreatePlaylist} className="grid min-h-48 place-items-center rounded-xl border border-dashed border-white/15 bg-white/[.02] p-4 text-zinc-400 transition hover:border-lime-300/40 hover:bg-lime-300/[.04] hover:text-lime-200">
          <span className="flex flex-col items-center gap-2"><Plus className="h-7 w-7" /><span className="text-sm font-bold">Create playlist</span></span>
        </button>
      </div>
    </section>

    <section className="mb-10">
      <SectionHeading title="Liked Songs" action="View playlist" />
      <div className="rounded-lg bg-white/[.035] p-1 sm:p-2">
        {likedSongs.length ? likedSongs.map((song, index) => <SongRow song={song} index={index} key={song.id} />) : <p className="p-8 text-center text-sm text-zinc-400">Songs you like will appear here.</p>}
      </div>
    </section>

    <section>
      <SectionHeading title="Recently played" action="See all" />
      <div className="rounded-lg bg-white/[.035] p-1 sm:p-2">{catalogSongs.slice(0, 4).map((song, index) => <SongRow song={{ ...song, added: "Today" }} index={index} key={song.id} />)}</div>
    </section>
  </>;
}

type PayoutItem = {
  id: string;
  period: string;
  totalPlays: string;
  premiumPlays: string;
  adRevenue: number;
  amount: number;
  status: "PENDING" | "PAID";
  createdAt: string;
};

type PayoutData = {
  summary: {
    lifetimePaid: number;
    pendingAmount: number;
    totalPlays: number;
    premiumPlays: number;
    premiumSharePercent: number;
    estRatePerPlay?: number;
  };
  payouts: PayoutItem[];
};


type CreatorSong = {
  id: string;
  title: string;
  artist: string;
  artistName: string;
  genre: string;
  playCount: string;
  likeCount: number;
  status: "PROCESSING" | "READY" | "FAILED";
  isPublished: boolean;
  coverArtUrl: string | null;
  createdAt: string;
};

function MySongsTab({ onUpload, refreshKey }: { onUpload: () => void; refreshKey: number }) {
  const [songs, setSongs] = useState<CreatorSong[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const getApiToken = useApiToken();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getApiToken().then((token) => fetch(`${API_URL}/creator/songs`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }))
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((d: { data: CreatorSong[] }) => { if (!cancelled) setSongs(d.data ?? []); })
      .catch(() => { if (!cancelled) setSongs([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [getApiToken, refreshKey]);

  const togglePublish = async (song: CreatorSong) => {
    if (song.status !== "READY") return;
    setToggling(song.id);
    try {
      const token = await getApiToken();
      const res = await fetch(`${API_URL}/creator/songs/${song.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ isPublished: !song.isPublished }),
      });
      if (res.ok) {
        setSongs((prev) => prev.map((s) => s.id === song.id ? { ...s, isPublished: !s.isPublished } : s));
      }
    } catch { /* swallow */ }
    finally { setToggling(null); }
  };

  const deleteSong = async (song: CreatorSong) => {
    if (!window.confirm(`Delete “${song.title}”? This cannot be undone.`)) return;
    setDeleting(song.id);
    try {
      const token = await getApiToken();
      const res = await fetch(`${API_URL}/creator/songs/${song.id}`, { method: "DELETE", headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (res.ok) setSongs((prev) => prev.filter((item) => item.id !== song.id));
    } finally { setDeleting(null); }
  };

  const importStorageSongs = async () => {
    setImporting(true);
    try {
      const token = await getApiToken();
      const res = await fetch(`${API_URL}/creator/songs/import-storage`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (res.ok) window.location.reload();
    } finally { setImporting(false); }
  };

  if (loading) {
    return (
      <div className="space-y-3 pt-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex animate-pulse items-center gap-3 rounded-lg bg-white/[.04] p-3">
            <div className="h-12 w-12 rounded-md bg-white/10" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-1/2 rounded bg-white/10" />
              <div className="h-2.5 w-1/3 rounded bg-white/[.07]" />
            </div>
            <div className="h-6 w-16 rounded-full bg-white/10" />
          </div>
        ))}
      </div>
    );
  }

  if (!songs.length) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-full border border-white/10 bg-white/[.04]">
          <Music2 className="h-7 w-7 text-zinc-500" />
        </div>
        <div>
          <p className="text-base font-bold text-white">No uploads yet</p>
          <p className="mt-1 text-sm text-zinc-400">Your released tracks will appear here.</p>
        </div>
        <button onClick={onUpload} className="inline-flex items-center gap-2 rounded-full bg-lime-300 px-5 py-2.5 text-sm font-bold text-[#172000] shadow-lg shadow-lime-300/20 transition hover:scale-[1.02] hover:bg-lime-200">
          <Upload className="h-4 w-4" /> Upload your first song
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2 pt-2">
      <button onClick={importStorageSongs} disabled={importing} className="mb-2 inline-flex items-center gap-2 rounded-full border border-lime-300/30 px-3 py-1.5 text-xs font-bold text-lime-300 hover:bg-lime-300/10 disabled:opacity-60">
        {importing && <Loader2 className="h-3 w-3 animate-spin" />} {importing ? "Importing…" : "Import songs from storage"}
      </button>
      {songs.map((song) => {
        const isToggling = toggling === song.id;
        return (
          <div key={song.id} className="flex items-center gap-3 rounded-xl border border-white/[.07] bg-white/[.03] p-3 transition hover:bg-white/[.05]">
            {song.coverArtUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`${API_URL}${song.coverArtUrl}`} alt={song.title} className="h-12 w-12 shrink-0 rounded-md object-cover" />
            ) : (
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-md bg-gradient-to-br from-violet-700 to-fuchsia-500">
                <Music2 className="h-5 w-5 text-white/80" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-white">{song.title}</p>
              <p className="truncate text-xs text-zinc-400">{song.artist} · {song.genre}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* Status badge */}
              {song.status === "PROCESSING" && (
                <span className="flex items-center gap-1 rounded-full bg-violet-500/10 px-2.5 py-0.5 text-[10px] font-bold text-violet-300 border border-violet-500/20">
                  <Loader2 className="h-2.5 w-2.5 animate-spin" /> Processing
                </span>
              )}
              {song.status === "FAILED" && (
                <span className="rounded-full bg-red-500/10 px-2.5 py-0.5 text-[10px] font-bold text-red-400 border border-red-500/20">Failed</span>
              )}
              {song.status === "READY" && (
                <button
                  onClick={() => togglePublish(song)}
                  disabled={isToggling}
                  title={song.isPublished ? "Click to unpublish" : "Click to publish"}
                  className={cn(
                    "flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold border transition disabled:opacity-60",
                    song.isPublished
                      ? "bg-lime-300/10 text-lime-300 border-lime-300/20 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20"
                      : "bg-zinc-500/10 text-zinc-400 border-zinc-500/20 hover:bg-lime-300/10 hover:text-lime-300 hover:border-lime-300/20"
                  )}
                >
                  {isToggling ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : song.isPublished ? <CheckCircle2 className="h-2.5 w-2.5" /> : null}
                  {isToggling ? "…" : song.isPublished ? "Live" : "Draft"}
                </button>
              )}
              {/* Play count */}
              <span className="hidden text-xs text-zinc-500 sm:block">{song.playCount} plays</span>
              <button onClick={() => deleteSong(song)} disabled={deleting === song.id} title="Delete song" className="rounded-full p-1.5 text-zinc-500 transition hover:bg-red-500/10 hover:text-red-400 disabled:opacity-60">
                {deleting === song.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CreatorView({ onUpload, catalogRefreshKey }: { onUpload: () => void; catalogRefreshKey: number }) {
  const [activeTab, setActiveTab] = useState<"songs" | "royalties">("songs");
  const [payoutsData, setPayoutsData] = useState<PayoutData | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isCreator, setIsCreator] = useState<boolean | null>(null);
  const [applyingCreator, setApplyingCreator] = useState(false);
  const getApiToken = useApiToken();

  useEffect(() => {
    // Check if user is a creator by calling analytics (creator-only route)
    getApiToken().then((token) => fetch(`${API_URL}/creator/analytics`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }))
      .then((r) => { setIsCreator(r.ok || r.status !== 403); })
      .catch(() => setIsCreator(true)); // network err → assume ok
  }, [getApiToken]);

  useEffect(() => {
    fetch("/api/creator/payouts")
      .then((res) => res.json())
      .then((data: PayoutData) => setPayoutsData(data))
      .catch(() => {
        setPayoutsData({
          summary: { lifetimePaid: 929.63, pendingAmount: 328.75, totalPlays: 159512, premiumPlays: 42100, premiumSharePercent: 26.4, estRatePerPlay: 0.0058 },
          payouts: [
            { id: "pay-1", period: "2026-08-01", totalPlays: "62,450", premiumPlays: "18,200", adRevenue: 142.5, amount: 328.75, status: "PENDING", createdAt: "2026-09-01T00:00:00Z" },
            { id: "pay-2", period: "2026-07-01", totalPlays: "54,120", premiumPlays: "14,800", adRevenue: 118.2, amount: 284.15, status: "PAID", createdAt: "2026-08-01T00:00:00Z" },
            { id: "pay-3", period: "2026-06-01", totalPlays: "42,942", premiumPlays: "9,100", adRevenue: 95.4, amount: 316.73, status: "PAID", createdAt: "2026-07-01T00:00:00Z" },
          ],
        });
      });
  }, []);

  const applyForCreator = async () => {
    setApplyingCreator(true);
    try {
      const token = await getApiToken();
      const res = await fetch(`${API_URL}/creator/apply`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) { setIsCreator(true); setRefreshKey((k) => k + 1); }
    } catch { /* swallow */ }
    finally { setApplyingCreator(false); }
  };

  return <>
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-3xl font-black tracking-[-.04em]">Creator Studio</h1>
        <p className="mt-1 text-sm text-zinc-400">Track stream metrics, uploads, and monthly royalty splits.</p>
      </div>
      <button onClick={onUpload} className="inline-flex items-center gap-2 rounded-full bg-lime-300 px-5 py-2.5 text-sm font-bold text-[#172000] shadow-lg shadow-lime-300/20 transition hover:scale-[1.02] hover:bg-lime-200">
        <Upload className="h-4 w-4" /> Upload Track
      </button>
    </div>

    {/* Become a Creator CTA */}
    {isCreator === false && (
      <div className="mb-8 rounded-2xl border border-lime-300/20 bg-lime-300/[.04] p-6 text-center">
        <Mic2 className="mx-auto mb-3 h-8 w-8 text-lime-300" />
        <h2 className="text-lg font-black text-white">Become a Creator</h2>
        <p className="mt-1 mb-4 text-sm text-zinc-400">Apply for creator access to upload tracks, earn royalties, and appear in the catalog.</p>
        <button onClick={applyForCreator} disabled={applyingCreator}
          className="inline-flex items-center gap-2 rounded-full bg-lime-300 px-6 py-2.5 text-sm font-bold text-[#172000] shadow-lg shadow-lime-300/20 transition hover:bg-lime-200 disabled:opacity-60">
          {applyingCreator ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {applyingCreator ? "Applying…" : "Apply for Creator Access"}
        </button>
      </div>
    )}

    {/* Tab Toggle */}
    <div className="mb-6 flex gap-2 border-b border-white/[.08] pb-3">
      <button onClick={() => setActiveTab("songs")} className={cn("rounded-full px-4 py-1.5 text-xs font-bold transition", activeTab === "songs" ? "bg-white text-black" : "text-zinc-400 hover:text-white")}>My Songs</button>
      <button onClick={() => setActiveTab("royalties")} className={cn("rounded-full px-4 py-1.5 text-xs font-bold transition", activeTab === "royalties" ? "bg-white text-black" : "text-zinc-400 hover:text-white")}>Royalty Dashboard</button>
    </div>

    {activeTab === "songs" && (
      <MySongsTab onUpload={onUpload} refreshKey={refreshKey + catalogRefreshKey} />
    )}

    {activeTab === "royalties" && (
      <section className="space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-white/[.04] p-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1"><DollarSign className="h-3.5 w-3.5 text-lime-300" /> Pending Payout</span>
            <p className="mt-2 text-2xl font-black text-lime-300">${payoutsData?.summary.pendingAmount.toFixed(2) ?? "328.75"}</p>
            <span className="mt-1 block text-[10px] text-zinc-500">Processing on the 15th</span>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[.04] p-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1"><Coins className="h-3.5 w-3.5 text-amber-300" /> Lifetime Royalties</span>
            <p className="mt-2 text-2xl font-black text-white">${payoutsData?.summary.lifetimePaid.toFixed(2) ?? "929.63"}</p>
            <span className="mt-1 block text-[10px] text-zinc-500">Via ROZOPAY Connect</span>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[.04] p-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5 text-emerald-400" /> Monetized Plays</span>
            <p className="mt-2 text-2xl font-black text-white">{payoutsData?.summary.totalPlays.toLocaleString() ?? "159,512"}</p>
            <span className="mt-1 block text-[10px] text-zinc-500">{(payoutsData?.summary.premiumSharePercent ?? 26.4)}% Premium subscribers</span>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[.04] p-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1"><Sparkles className="h-3.5 w-3.5 text-violet-400" /> Rate Per Stream</span>
            <p className="mt-2 text-2xl font-black text-white">$0.0058</p>
            <span className="mt-1 block text-[10px] text-zinc-500">80/20 creator split pool</span>
          </div>
        </div>

        {/* Payouts Table */}
        <div className="rounded-xl border border-white/10 bg-white/[.03] p-4 sm:p-6">
          <h2 className="text-lg font-bold tracking-tight mb-4">Payout Periods</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                  <th className="pb-3 pl-2">Period</th>
                  <th className="pb-3 text-right">Plays</th>
                  <th className="pb-3 text-right">Premium</th>
                  <th className="pb-3 text-right">Ad Revenue</th>
                  <th className="pb-3 text-right">Total Net</th>
                  <th className="pb-3 text-center">Status</th>
                  <th className="pb-3 pr-2 text-right">Invoice</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[.06]">
                {payoutsData?.payouts.map((payout) => {
                  const date = new Date(payout.period);
                  const formattedDate = date.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
                  return (
                    <tr key={payout.id} className="transition hover:bg-white/[.02]">
                      <td className="py-3.5 pl-2 font-bold text-white flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-lime-300" />{formattedDate}
                      </td>
                      <td className="py-3.5 text-right font-mono text-xs text-zinc-300">{payout.totalPlays}</td>
                      <td className="py-3.5 text-right font-mono text-xs text-lime-300/90">{payout.premiumPlays}</td>
                      <td className="py-3.5 text-right font-mono text-xs text-zinc-400">${payout.adRevenue.toFixed(2)}</td>
                      <td className="py-3.5 text-right font-mono text-sm font-bold text-white">${payout.amount.toFixed(2)}</td>
                      <td className="py-3.5 text-center">
                        {payout.status === "PAID" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-bold text-emerald-400 border border-emerald-500/20">
                            <CheckCircle2 className="h-3 w-3" /> PAID
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-bold text-amber-300 border border-amber-500/20">
                            <Clock className="h-3 w-3" /> PENDING
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 pr-2 text-right">
                        <button className="text-xs font-semibold text-zinc-400 hover:text-lime-300 transition underline underline-offset-2">PDF</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    )}
  </>;
}

function PlayerBar({
  onOpenSettings,
  onOpenLyrics,
}: {
  onOpenSettings: () => void;
  onOpenLyrics: () => void;
}) {
  const [queueOpen, setQueueOpen] = useState(false);
  const onToggleQueue = () => setQueueOpen((v) => !v);

  const {
    current,
    queue,
    playing,
    toggle,
    next,
    previous,
    currentTime,
    duration,
    seek,
    volume,
    setVolume,
    shuffle,
    toggleShuffle,
    repeat,
    toggleRepeat,
    toggleLike,
    liked,
    radioActive,
    radioLoading,
    startRadio,
    stopRadio,
    crossfadeDuration,
    downloadedIds,
    downloadSong,
    removeDownload,
  } = usePlayer();

  // Derive queueIndex from queue + current
  const queueIndex = queue.findIndex((s) => s.id === current?.id);

  // Auto-close queue panel when radio stops
  useEffect(() => { if (!radioActive) setQueueOpen(false); }, [radioActive]);

  if (!current) return null;
  const progress = duration ? Math.min(100, (currentTime / duration) * 100) : 0;
  const isDownloaded = downloadedIds.has(current.id);

  return (
    <footer className="glass fixed inset-x-0 bottom-0 z-40 grid h-[88px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-white/[.08] px-3 sm:grid-cols-[minmax(200px,1fr)_minmax(310px,1.25fr)_minmax(180px,1fr)] sm:px-5">
      {/* Left: Track Details */}
      <div className="flex min-w-0 items-center gap-3">
        <CoverArt art={current.cover} accent={current.accent} className="h-14 w-14 shrink-0 rounded" />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold flex items-center gap-1.5">
            {current.title}
            {isDownloaded && <span title="Playing from Offline Storage" className="inline-block h-1.5 w-1.5 rounded-full bg-lime-400" />}
          </p>
          <p className="truncate text-xs text-zinc-400">
            {current.artist}
            {radioActive && <span className="ml-2 text-lime-300 font-medium">Radio</span>}
          </p>
        </div>
        {!current.isImported && (
          <>
            <button
              onClick={() => toggleLike(current.id)}
              aria-label="Like current song"
              className={cn("hidden p-2 sm:block", liked.has(current.id) ? "text-lime-300" : "text-zinc-400 hover:text-white")}
            >
              <Heart className={cn("h-4 w-4", liked.has(current.id) && "fill-current")} />
            </button>
            <button
              onClick={() => (isDownloaded ? removeDownload(current.id) : downloadSong(current))}
              title={isDownloaded ? "Downloaded (Click to remove)" : "Download for offline listening"}
              className={cn("hidden p-2 sm:block", isDownloaded ? "text-lime-300" : "text-zinc-400 hover:text-white")}
            >
              <ArrowDownToLine className={cn("h-4 w-4", isDownloaded && "stroke-[2.5]")} />
            </button>
          </>
        )}
      </div>

      {/* Center: Controls & Progress */}
      <div className="hidden w-full max-w-xl justify-self-center sm:block">
        <div className="mb-2 flex items-center justify-center gap-1">
          {!current.isImported && (
            <IconButton
              label={radioActive ? "Stop radio" : "Start radio from current track"}
              onClick={() => (radioActive ? stopRadio() : startRadio(current))}
              active={radioActive}
              className={cn(radioLoading && "animate-pulse")}
            >
              <Sparkles className="h-4 w-4" />
            </IconButton>
          )}
          <IconButton label="Toggle shuffle" onClick={toggleShuffle} className={cn(shuffle && "text-lime-300")}>
            <Shuffle className="h-4 w-4" />
          </IconButton>
          <IconButton label="Previous" onClick={previous}>
            <SkipBack className="h-4 w-4 fill-current" />
          </IconButton>
          <button
            onClick={toggle}
            aria-label={playing ? "Pause" : "Play"}
            className="grid h-8 w-8 place-items-center rounded-full bg-white text-black transition hover:scale-105"
          >
            {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
          </button>
          <IconButton label="Next" onClick={next}>
            <SkipForward className="h-4 w-4 fill-current" />
          </IconButton>
          <IconButton label="Toggle repeat" onClick={toggleRepeat} className={cn(repeat !== "off" && "text-lime-300")}>
            <Repeat2 className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-8 text-right text-[10px] tabular-nums text-zinc-400">{formatTime(currentTime)}</span>
          <input
            aria-label="Playback position"
            type="range"
            min="0"
            max={duration || current.duration}
            step="1"
            value={currentTime}
            onChange={(event) => seek(Number(event.target.value))}
            style={{ background: `linear-gradient(to right, #d9f99d ${progress}%, #52525b ${progress}%)` }}
            className="h-1 w-full cursor-pointer appearance-none rounded-full accent-lime-300"
          />
          <span className="w-8 text-[10px] tabular-nums text-zinc-400">{formatTime(duration || current.duration)}</span>
        </div>
      </div>

      {/* Right: Visualizer, Lyrics, Volume, Settings */}
      <div className="flex items-center justify-end gap-1.5">
        {/* Mini Real-time Audio Visualizer */}
        <div className="hidden xl:flex items-center mr-2">
          <AudioVisualizer barCount={18} height={22} compact className="w-20" />
        </div>

        {/* 🎤 Synced Karaoke Lyrics Button */}
        {!current.isImported && (
          <IconButton label="Synced Lyrics" onClick={onOpenLyrics} className="text-zinc-400 hover:text-lime-300">
            <Mic2 className="h-4 w-4" />
          </IconButton>
        )}

        <button onClick={toggle} aria-label={playing ? "Pause" : "Play"} className="grid h-10 w-10 place-items-center rounded-full bg-lime-300 text-black sm:hidden">
          {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
        </button>
        <Volume2 className="hidden h-4 w-4 text-zinc-400 lg:block" />
        <input
          aria-label="Volume"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={(event) => setVolume(Number(event.target.value))}
          className="hidden h-1 w-20 cursor-pointer accent-white lg:block"
        />
        <IconButton label={`Crossfade Audio (${crossfadeDuration}s)`} onClick={onOpenSettings} className={cn(crossfadeDuration > 0 && "text-lime-300")}>
          <Sliders className="h-4 w-4" />
        </IconButton>

        {/* Radio Queue toggle — only show when radio is active */}
        {radioActive && (
          <IconButton
            label="Upcoming in Radio"
            onClick={onToggleQueue}
            active={queueOpen}
            className="hidden sm:grid"
          >
            <ListMusic className="h-4 w-4" />
          </IconButton>
        )}
      </div>

      {/* Radio Queue Panel — slides up above footer */}
      {radioActive && queueOpen && (
        <div className="absolute inset-x-0 bottom-full mb-1 mx-2 rounded-xl border border-white/10 bg-[#18181f]/95 shadow-2xl backdrop-blur-md">
          <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-white/[.07]">
            <div className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-lime-300" />
              <span className="text-sm font-bold">Up Next · Radio</span>
              {radioLoading && <span className="text-[10px] text-zinc-400 animate-pulse">Fetching…</span>}
            </div>
            <button onClick={onToggleQueue} className="text-zinc-500 hover:text-white p-1">
              <X className="h-4 w-4" />
            </button>
          </div>
          <ul className="max-h-56 overflow-y-auto py-1 hide-scrollbar">
            {queue.slice(queueIndex + 1, queueIndex + 8).map((song, i) => (
              <li key={`${song.id}-${i}`} className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-white/[.05] transition">
                <CoverArt art={song.cover} accent={song.accent} className="h-9 w-9 shrink-0 rounded" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-white">{song.title}</p>
                  <p className="truncate text-xs text-zinc-400">{song.artist}</p>
                </div>
                <span className="shrink-0 text-xs text-zinc-500">{formatTime(song.duration)}</span>
              </li>
            ))}
            {queue.slice(queueIndex + 1).length === 0 && (
              <li className="px-4 py-4 text-center text-xs text-zinc-500">Loading more tracks…</li>
            )}
          </ul>
        </div>
      )}
    </footer>
  );
}

function SettingsDialog({ close }: { close: () => void }) {
  const { crossfadeDuration, setCrossfadeDuration } = usePlayer();
  const [pushStatus, setPushStatus] = useState<"default" | "granted" | "denied">("default");

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setPushStatus(Notification.permission);
    }
  }, []);

  const enablePushNotifications = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    try {
      const perm = await Notification.requestPermission();
      setPushStatus(perm);
      if (perm === "granted" && "serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.ready;
        // Test notification
        reg.showNotification("Streamify Push Enabled", {
          body: "You'll be notified when your favorite artists drop new songs!",
          icon: "/icon-192.png",
        });
      }
    } catch {
      // Permission rejected
    }
  };

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#171717] p-6 shadow-2xl">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-black">App & Playback Preferences</h2>
            <p className="mt-1 text-xs text-zinc-400">Configure gapless playback, push alerts, and offline caching.</p>
          </div>
          <IconButton label="Close settings dialog" onClick={close}><X className="h-5 w-5" /></IconButton>
        </div>
        <div className="space-y-4">
          {/* Crossfade */}
          <div className="rounded-xl border border-white/10 bg-white/[.04] p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold text-white flex items-center gap-2">
                <Sliders className="h-4 w-4 text-lime-300" /> Crossfade Songs
              </span>
              <span className="font-mono text-xs font-bold text-lime-300">
                {crossfadeDuration === 0 ? "Off (Gapless)" : `${crossfadeDuration}s`}
              </span>
            </div>
            <p className="text-xs text-zinc-400 mb-4">
              Smoothly overlaps and fades between songs without pause.
            </p>
            <input
              type="range"
              min="0"
              max="12"
              step="1"
              value={crossfadeDuration}
              onChange={(e) => setCrossfadeDuration(Number(e.target.value))}
              className="w-full h-1.5 cursor-pointer appearance-none rounded-full bg-zinc-700 accent-lime-300"
            />
            <div className="flex justify-between text-[10px] text-zinc-500 font-mono mt-1.5">
              <span>0s (Gapless)</span>
              <span>4s (Default)</span>
              <span>8s</span>
              <span>12s</span>
            </div>
          </div>

          {/* Push Notifications */}
          <div className="rounded-xl border border-white/10 bg-white/[.04] p-4 flex items-center justify-between">
            <div>
              <span className="text-sm font-bold text-white flex items-center gap-2">
                <Bell className="h-4 w-4 text-lime-300" /> Push Notifications
              </span>
              <p className="text-xs text-zinc-400 mt-0.5">New releases from creators you follow (quiet hours 8am-10pm)</p>
            </div>
            <button
              onClick={enablePushNotifications}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-bold transition",
                pushStatus === "granted"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 cursor-default"
                  : "bg-lime-300 text-black hover:bg-lime-200"
              )}
            >
              {pushStatus === "granted" ? "Enabled" : "Turn On"}
            </button>
          </div>

          {/* Offline / PWA status */}
          <div className="rounded-xl border border-white/10 bg-white/[.04] p-4 flex items-center justify-between">
            <div>
              <span className="text-sm font-bold text-white flex items-center gap-2">
                <ArrowDownToLine className="h-4 w-4 text-lime-300" /> Offline Storage
              </span>
              <p className="text-xs text-zinc-400 mt-0.5">IndexedDB cache with 7-day automated license validation</p>
            </div>
            <span className="rounded-full bg-lime-300/10 px-2.5 py-0.5 text-[11px] font-bold text-lime-300 border border-lime-300/20">
              100 Song Cap
            </span>
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <button onClick={close} className="rounded-full bg-lime-300 px-5 py-2 text-sm font-bold text-[#172000]">Done</button>
        </div>
      </div>
    </div>
  );
}


interface LeaderboardEntry {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  points: number;
  uniqueSongs: number;
  rank: number;
  trophy?: string;
  completedAtMs?: number;
}

interface LeaderboardData {
  entries: LeaderboardEntry[];
}

interface UserTrophy {
  id: string;
  type: string;
  date: string;
}

interface UserStats {
  userId: string;
  today: {
    points: number;
    maxPoints: number;
    uniqueSongs: number;
    maxSongs: number;
    completedAtMs?: number;
  };
  lifetime: {
    totalPoints: number;
    daysActive: number;
    hasMillionMilestone: boolean;
    milestoneProgress: number;
  };
  trophies: UserTrophy[];
}

function LeaderboardView() {
  const [leaderboard, setLeaderboard] = useState<LeaderboardData | null>(null);
  const [myStats, setMyStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [leaderboardUnavailable, setLeaderboardUnavailable] = useState(false);
  const getApiToken = useApiToken();

  useEffect(() => {
    const leaderboardRequest = fetch("/api/leaderboard")
      .then(response => {
        if (!response.ok) {
          setLeaderboardUnavailable(true);
          return null;
        }
        return response.json();
      })
      .catch(() => {
        setLeaderboardUnavailable(true);
        return null;
      });
    const statsRequest = getApiToken()
      .then(token => fetch("/api/leaderboard/my-stats", {
        headers: token ? { "Authorization": `Bearer ${token}` } : undefined,
      }))
      .then(response => response.ok ? response.json() : null)
      .catch(() => null);

    Promise.all([
      leaderboardRequest,
      statsRequest,
    ])
    .then(([lb, stats]) => {
      // Load local client progress for instant feedback & demo/guest mode
      let localStats: { date?: string; playedIds?: string[]; playedSongIds?: string[]; points?: number } | null = null;
      try {
        const raw = window.localStorage.getItem(LOCAL_LEADERBOARD_STORAGE_KEY);
        if (raw) localStats = JSON.parse(raw);
      } catch {}

      // Today filter
      const todayStr = new Date().toISOString().slice(0, 10);
      if (localStats && localStats.date !== todayStr) { localStats = null; }
      const songsPlayed = localStats?.playedSongIds ?? localStats?.playedIds ?? [];
      const localUniqueCount = Math.min(10, songsPlayed.length);
      const localPoints = localStats?.points ?? (localUniqueCount * 100);

      const effectiveStats: UserStats = stats ?? {
        userId: "local-user",
        today: {
          points: localPoints,
          maxPoints: 1000,
          uniqueSongs: localUniqueCount,
          maxSongs: 10,
        },
        lifetime: {
          totalPoints: localPoints,
          daysActive: localUniqueCount > 0 ? 1 : 0,
          hasMillionMilestone: false,
          milestoneProgress: Math.min(100, (localPoints / 1000000) * 100),
        },
        trophies: [],
      };

      if (stats) {
        // Merge if local has recorded additional unique songs today
        if (localUniqueCount > stats.today.uniqueSongs) {
          effectiveStats.today.uniqueSongs = localUniqueCount;
          effectiveStats.today.points = Math.max(stats.today.points, localPoints);
        }
      }

      setMyStats(effectiveStats);

      // Hydrate leaderboard list: if empty or user not present, include local listener
      if (lb && lb.entries) {
        const hasUser = lb.entries.some((e: LeaderboardEntry) => e.userId === effectiveStats.userId || e.displayName === "You");
        if (!hasUser && effectiveStats.today.points > 0) {
          const userEntry: LeaderboardEntry = {
            userId: effectiveStats.userId,
            displayName: "You",
            points: effectiveStats.today.points,
            uniqueSongs: effectiveStats.today.uniqueSongs,
            rank: 1,
          };
          const merged = [...lb.entries, userEntry].sort((a, b) => b.points - a.points);
          merged.forEach((entry, idx) => { entry.rank = idx + 1; });
          setLeaderboard({ entries: merged });
        } else {
          setLeaderboard(lb);
        }
      } else if (effectiveStats.today.points > 0) {
        setLeaderboard({
          entries: [{
            userId: effectiveStats.userId,
            displayName: "You",
            points: effectiveStats.today.points,
            uniqueSongs: effectiveStats.today.uniqueSongs,
            rank: 1,
          }]
        });
      }
    })
    .finally(() => setLoading(false));
  }, [getApiToken]);

  if (loading) {
    return <div className="animate-pulse space-y-4 pt-10 px-4">
      <div className="h-8 bg-white/10 rounded w-1/3"></div>
      <div className="h-4 bg-white/10 rounded w-1/4"></div>
      <div className="h-64 bg-white/10 rounded"></div>
    </div>;
  }

  const trophies = {
    GOLD: "🥇",
    SILVER: "🥈",
    BRONZE: "🥉",
    MILESTONE_1M: "🏅"
  };

  return (
    <div className="pb-10 pt-4">
      <SectionHeading title="Daily Leaderboard" action="Today" />
      
      {myStats && (
        <div className="mb-10 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[.02] p-5">
            <h3 className="mb-4 text-sm font-bold text-zinc-400">Your Daily Progress</h3>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-3xl font-black text-lime-300">{myStats.today.points} <span className="text-sm font-bold text-zinc-500">pts</span></div>
                <div className="mt-1 text-xs text-zinc-400">{myStats.today.uniqueSongs} / {myStats.today.maxSongs} unique songs heard</div>
              </div>
              {myStats.today.completedAtMs && (
                <div className="text-right">
                  <div className="text-xs font-bold text-white bg-white/10 px-2 py-1 rounded">Fast Finish</div>
                  <div className="text-[10px] text-zinc-500 mt-1">{(myStats.today.completedAtMs / 1000 / 60).toFixed(0)}m from midnight</div>
                </div>
              )}
            </div>
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-black/50 border border-white/5">
              <div 
                className="h-full bg-lime-300 transition-all" 
                style={{ width: `${(myStats.today.points / myStats.today.maxPoints) * 100}%` }}
              />
            </div>
          </div>

          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[.02] p-5">
            <h3 className="mb-4 text-sm font-bold text-amber-500/70">Lifetime 1M Milestone</h3>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-2xl font-black text-amber-400">{myStats.lifetime.totalPoints.toLocaleString()} <span className="text-sm font-bold text-amber-500/50">pts</span></div>
                <div className="mt-1 text-xs text-amber-500/60">{myStats.lifetime.daysActive} days active</div>
              </div>
              {myStats.lifetime.hasMillionMilestone ? (
                <div className="text-4xl" title="1 Million Points Milestone">{trophies.MILESTONE_1M}</div>
              ) : (
                <div className="text-xl font-bold text-amber-400/80">{myStats.lifetime.milestoneProgress}%</div>
              )}
            </div>
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-black/50 border border-amber-500/10">
              <div 
                className="h-full bg-gradient-to-r from-amber-500 to-yellow-300 transition-all" 
                style={{ width: `${myStats.lifetime.milestoneProgress}%` }}
              />
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-white/[.02] overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-white/5 text-xs text-zinc-500 uppercase font-bold tracking-wider">
              <th className="px-5 py-3 font-medium w-16 text-center">Rank</th>
              <th className="px-5 py-3 font-medium">Listener</th>
              <th className="px-5 py-3 font-medium text-right">Points</th>
              <th className="px-5 py-3 font-medium text-right">Songs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {leaderboard?.entries.map((entry: LeaderboardEntry) => (
              <tr key={entry.userId} className={cn("transition hover:bg-white/[.03]", entry.userId === myStats?.userId && "bg-lime-300/5")}>
                <td className="px-5 py-4 text-center">
                  {entry.trophy ? (
                    <span className="text-xl" title={entry.trophy}>{trophies[entry.trophy as keyof typeof trophies]}</span>
                  ) : (
                    <span className="font-bold text-zinc-500">{entry.rank}</span>
                  )}
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    {entry.avatarUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={entry.avatarUrl} alt="" className="h-8 w-8 rounded-full bg-white/10 object-cover" />
                    ) : (
                      <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 text-xs font-bold text-white">
                        {entry.displayName.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className="font-bold text-zinc-200">{entry.displayName}</span>
                  </div>
                </td>
                <td className="px-5 py-4 text-right">
                  <span className="font-mono font-bold text-lime-300">{entry.points}</span>
                  {entry.completedAtMs && entry.points === 1000 && (
                    <span className="ml-2 text-[10px] text-zinc-500 inline-block bg-white/5 px-1.5 rounded py-0.5" title="Time from midnight">
                      {(entry.completedAtMs / 1000 / 60).toFixed(0)}m
                    </span>
                  )}
                </td>
                <td className="px-5 py-4 text-right font-bold text-zinc-400">
                  {entry.uniqueSongs}
                </td>
              </tr>
            ))}
            {(!leaderboard || leaderboard.entries.length === 0) && (
              <tr>
                <td colSpan={4} className="px-5 py-12 text-center text-sm text-zinc-500 font-bold">
                  {leaderboardUnavailable ? "Leaderboard is temporarily unavailable. Please try again later." : "No listeners today yet. Be the first!"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      
      {myStats && myStats.trophies.length > 0 && (
        <div className="mt-10">
          <h3 className="mb-4 text-lg font-bold text-white">Your Trophy Case</h3>
          <div className="flex flex-wrap gap-3">
            {myStats.trophies.map((t: UserTrophy) => (
              <div key={t.id} className="flex flex-col items-center justify-center p-4 rounded-xl border border-white/10 bg-white/[.02] min-w-[100px]">
                <div className="text-3xl mb-2">{trophies[t.type as keyof typeof trophies]}</div>
                <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">{new Date(t.date).toLocaleDateString("en-US", { month: 'short', day: 'numeric', timeZone: "UTC" })}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function StreamifyApp() {
  const [view, setView] = useState<View>("home");
  const [query, setQuery] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [catalogRefreshKey, setCatalogRefreshKey] = useState(0);
  const [remoteSongs, setRemoteSongs] = useState<Song[]>([]);
  const [userPlaylists, setUserPlaylists] = useState<UserPlaylist[]>([]);
  const [playlistsLoaded, setPlaylistsLoaded] = useState(false);
  const [createPlaylistOpen, setCreatePlaylistOpen] = useState(false);
  const [playlistName, setPlaylistName] = useState("");
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(USER_PLAYLISTS_STORAGE_KEY);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setUserPlaylists(parsed.filter((item): item is UserPlaylist =>
            Boolean(item)
            && typeof item.id === "string"
            && typeof item.title === "string"
            && Array.isArray(item.songIds)
            && item.songIds.every((id: unknown) => typeof id === "string")));
        }
      }
    } catch (error) {
      console.error("Failed to load saved playlists", error);
    } finally {
      setPlaylistsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!playlistsLoaded) return;
    try {
      window.localStorage.setItem(USER_PLAYLISTS_STORAGE_KEY, JSON.stringify(userPlaylists));
    } catch (error) {
      console.error("Failed to save playlists", error);
    }
  }, [playlistsLoaded, userPlaylists]);

  const { current, currentTime, seek, isOffline, userPlan, downloadsCount, downloadLimit, liked, setSubscriptionModalOpen } = usePlayer();
  const goSearch = () => setView("search");
  const createPlaylist = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = playlistName.trim();
    if (!title) return;
    const id = `playlist-${Date.now()}`;
    setUserPlaylists((currentPlaylists) => [...currentPlaylists, { id, title, songIds: [] }]);
    setSelectedPlaylistId(id);
    setPlaylistName("");
    setCreatePlaylistOpen(false);
    setView("library");
  };
  const addSongToPlaylist = (playlistId: string, song: Song) => {
    setUserPlaylists((currentPlaylists) => currentPlaylists.map((playlist) =>
      playlist.id === playlistId && !playlist.songIds.includes(song.id)
        ? { ...playlist, songIds: [...playlist.songIds, song.id] }
        : playlist));
  };
  const removeSongFromPlaylist = (playlistId: string, songId: string) => {
    setUserPlaylists((currentPlaylists) => currentPlaylists.map((playlist) =>
      playlist.id === playlistId
        ? { ...playlist, songIds: playlist.songIds.filter((id) => id !== songId) }
        : playlist));
  };

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchCatalogPages("/songs"),
      fetchCatalogPages("/imported-songs").catch((error: unknown) => {
        console.error("Failed to load the imported music catalog", error);
        return [];
      }),
    ])
      .then(([databaseSongs, importedSongs]) => {
        if (cancelled) return;
        setRemoteSongs([...databaseSongs, ...importedSongs].flatMap((item, index) => {
          const song = mapRemoteSong(item, index);
          return song ? [song] : [];
        }));
      })
      .catch((error: unknown) => console.error("Failed to load the music catalog", error));
    return () => { cancelled = true; };
  }, [catalogRefreshKey]);

  const catalogSongs = remoteSongs.length ? remoteSongs : songs;

  const displayedPlan = isHydrated ? userPlan : "FREE";
  const planBadgeColor = displayedPlan === "GOD" ? "border-amber-500/40 bg-amber-500/15 text-amber-300" : displayedPlan === "PRO" ? "border-lime-400/40 bg-lime-400/10 text-lime-300" : displayedPlan === "GOOD" ? "border-blue-500/40 bg-blue-500/10 text-blue-300" : "border-white/20 bg-white/5 text-zinc-400";
  const planIcon = displayedPlan === "GOD" ? <Flame className="h-3 w-3" /> : displayedPlan === "PRO" ? <Crown className="h-3 w-3" /> : displayedPlan === "GOOD" ? <Zap className="h-3 w-3" /> : null;
  const downloadsLabel = downloadLimit === null ? `${downloadsCount} downloads` : `${downloadsCount}/${downloadLimit} downloads`;

  return (
    <div className="min-h-screen bg-[#080808] pb-24">
      <aside className="fixed bottom-24 left-0 top-0 z-30 hidden w-[248px] flex-col border-r border-white/[.07] bg-[#0e0e0e] px-3 py-5 lg:flex">
        <div className="mb-7 flex items-center justify-between px-3">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-[10px] bg-lime-300 text-black shadow-[0_0_22px_rgba(190,242,100,.25)]">
              <Music2 className="h-5 w-5 stroke-[2.8]" />
            </div>
            <span className="text-xl font-black tracking-[-.05em]">streamify</span>
          </div>
          {isOffline && (
            <span title="Offline Mode" className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300 border border-amber-500/30">
              Offline
            </span>
          )}
        </div>
        <nav className="space-y-1">
          {nav.map(([id, Icon, label]) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-bold transition",
                view === id ? "bg-white/[.09] text-white" : "text-zinc-400 hover:bg-white/[.05] hover:text-white"
              )}
            >
              <Icon className="h-[19px] w-[19px]" />
              {label}
            </button>
          ))}
        </nav>
        <div className="mt-7 border-t border-white/[.08] pt-5">
          <p className="mb-2 px-3 text-[11px] font-bold uppercase tracking-[.15em] text-zinc-500">Playlists & Mixes</p>
          <button type="button" onClick={() => { setView("library"); setCreatePlaylistOpen(true); }} className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-bold text-zinc-400 hover:text-white">
            <CirclePlus className="h-[19px] w-[19px]" />Create playlist
          </button>
          <div className="mt-2 space-y-0.5">
            <button type="button" key="liked" onClick={() => { setSelectedPlaylistId("liked"); setView("library"); }} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-zinc-400 transition hover:bg-white/[.05] hover:text-white">
              <CoverArt art="liked" className="h-6 w-6 shrink-0 rounded-sm" /> <span className="truncate">Liked Songs{isHydrated ? ` · ${liked.size}` : ""}</span>
            </button>
            {userPlaylists.map((playlist, index) => (
              <button
                type="button"
                onClick={() => { setSelectedPlaylistId(playlist.id); setView("library"); }}
                key={playlist.id}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-zinc-400 transition hover:bg-white/[.05] hover:text-white"
              >
                <CoverArt art={["midnight", "focus", "discovery", "sunset"][index % 4]} className="h-6 w-6 shrink-0 rounded-sm" /> <span className="truncate">{playlist.title}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="mt-auto">
          <button
            onClick={() => setSubscriptionModalOpen(true)}
            className={cn("mb-3 flex w-full items-center justify-between rounded-md border px-3 py-2.5 text-left text-xs font-bold transition hover:brightness-125", planBadgeColor)}
          >
            <span className="flex items-center gap-1.5">{planIcon}{displayedPlan} Plan</span>
            <span className="text-[10px] opacity-80">{displayedPlan === "FREE" ? "Upgrade" : "Manage"}</span>
          </button>
          <button
            onClick={() => setView("creator")}
            className={cn(
              "mb-3 flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-bold transition",
              view === "creator" ? "bg-lime-300 text-[#172000]" : "bg-white/[.06] text-zinc-300 hover:bg-white/[.11] hover:text-white"
            )}
          >
            <Mic2 className="h-[18px] w-[18px]" />Creator Studio
          </button>
          <div className="flex items-center gap-2 border-t border-white/[.08] px-2 pt-4">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-amber-200 to-pink-500 text-xs font-black text-black">AK</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-bold">Aarav Kapoor</p>
              <p className="truncate text-[11px] text-zinc-500">Creator & Producer</p>
            </div>
            <Ellipsis className="h-4 w-4 text-zinc-500" />
          </div>
        </div>
      </aside>

      <main className="lg:ml-[248px]">
        <header className="sticky top-0 z-20 flex h-[70px] items-center justify-between gap-4 border-b border-white/[.06] bg-[#080808]/82 px-4 backdrop-blur-xl sm:px-7">
          <div className="flex items-center gap-3">
            <div className="flex lg:hidden items-center gap-2">
              <div className="grid h-8 w-8 place-items-center rounded-[10px] bg-lime-300 text-black">
                <Music2 className="h-5 w-5" />
              </div>
              <span className="text-lg font-black tracking-[-.05em]">streamify</span>
            </div>
            <div className="hidden items-center gap-1 sm:flex">
              <IconButton label="Go back"><ChevronLeft className="h-5 w-5" /></IconButton>
              <IconButton label="Go forward"><ChevronRight className="h-5 w-5" /></IconButton>
            </div>
            {isOffline && (
              <span className="flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-bold text-amber-300 border border-amber-500/25">
                <WifiOff className="h-3.5 w-3.5" /> Offline Mode
              </span>
            )}
          </div>
          <button onClick={goSearch} className="hidden h-10 max-w-[355px] flex-1 items-center gap-2.5 rounded-full bg-white/[.09] px-4 text-left text-sm text-zinc-400 transition hover:bg-white/[.13] sm:flex">
            <Search className="h-4 w-4" /><span>Search songs, artists, albums</span>
          </button>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSubscriptionModalOpen(true)}
              title={`${userPlan} plan — ${downloadsLabel}`}
              className={cn("hidden items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition hover:brightness-125 sm:flex", planBadgeColor)}
            >
              {planIcon}<span>{userPlan}</span><span className="hidden lg:inline opacity-75">· {downloadsLabel}</span>
            </button>
            <IconButton label="Notifications" className="hidden sm:grid" onClick={() => setSettingsOpen(true)}>
              <Bell className="h-[18px] w-[18px]" />
            </IconButton>
            <AuthControls />
            <IconButton label="Open settings" onClick={() => setSettingsOpen(true)}>
              <Settings2 className="h-[18px] w-[18px]" />
            </IconButton>
          </div>
        </header>

        <div className="mx-auto max-w-[1480px] px-4 py-7 sm:px-7 lg:px-9">
          {view === "home" && <HomeView onDiscover={goSearch} remoteSongs={remoteSongs} hydrated={isHydrated} />}
          {view === "search" && <SearchView query={query} setQuery={setQuery} catalogSongs={catalogSongs} />}
          {view === "library" && <LibraryView
            catalogSongs={catalogSongs}
            userPlaylists={userPlaylists}
            selectedPlaylistId={selectedPlaylistId}
            onSelectPlaylist={setSelectedPlaylistId}
            onCreatePlaylist={() => setCreatePlaylistOpen(true)}
            onAddSong={addSongToPlaylist}
            onRemoveSong={removeSongFromPlaylist}
          />}
          {view === "leaderboard" && <LeaderboardView />}
          {view === "neon" && <NeonBar catalogSongs={catalogSongs} onNavigate={(v) => setView(v)} />}
          {view === "creator" && <CreatorView onUpload={() => setUploadOpen(true)} catalogRefreshKey={catalogRefreshKey} />}
        </div>
      </main>

      <nav className="fixed bottom-[88px] left-0 right-0 z-30 flex h-14 items-center justify-around border-t border-white/[.08] bg-[#111]/95 px-3 backdrop-blur lg:hidden">
        {nav.map(([id, Icon, label]) => (
          <button onClick={() => setView(id)} key={id} className={cn("flex flex-col items-center gap-0.5 text-[10px] font-bold", view === id ? "text-lime-300" : "text-zinc-400")}>
            <Icon className="h-5 w-5" />{label.split(" ")[0]}
          </button>
        ))}
        <button onClick={() => setView("creator")} className={cn("flex flex-col items-center gap-0.5 text-[10px] font-bold", view === "creator" ? "text-lime-300" : "text-zinc-400")}>
          <Grid2X2 className="h-5 w-5" />Studio
        </button>
      </nav>

      {/* Floating Neon Alexa AI Orb (Accessible across all views when not already in Neon full view) */}
      {view !== "neon" && (
        <FloatingAlexaOrb
          catalogSongs={catalogSongs}
          onOpenFullNeon={() => setView("neon")}
        />
      )}

      <PlayerBar onOpenSettings={() => setSettingsOpen(true)} onOpenLyrics={() => setLyricsOpen(true)} />
      {createPlaylistOpen && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreatePlaylistOpen(false); }}>
          <form onSubmit={createPlaylist} role="dialog" aria-modal="true" aria-labelledby="create-playlist-title" className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950 p-6 shadow-2xl">
            <h2 id="create-playlist-title" className="text-xl font-black">Create a playlist</h2>
            <p className="mt-1 text-sm text-zinc-400">Give your playlist a name. You can add songs next.</p>
            <input autoFocus maxLength={60} value={playlistName} onChange={(event) => setPlaylistName(event.target.value)} placeholder="My playlist" className="mt-5 w-full rounded-lg border border-white/10 bg-white/[.06] px-4 py-3 text-sm text-white outline-none transition focus:border-lime-300/50 focus:ring-2 focus:ring-lime-300/20" />
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => { setCreatePlaylistOpen(false); setPlaylistName(""); }} className="rounded-full px-4 py-2 text-sm font-bold text-zinc-300 transition hover:bg-white/10">Cancel</button>
              <button type="submit" disabled={!playlistName.trim()} className="rounded-full bg-lime-300 px-5 py-2 text-sm font-black text-black transition hover:bg-lime-200 disabled:cursor-not-allowed disabled:opacity-40">Create</button>
            </div>
          </form>
        </div>
      )}
      {uploadOpen && <UploadDialog close={() => setUploadOpen(false)} onPublished={() => { setUploadOpen(false); setCatalogRefreshKey((key) => key + 1); }} />}
      {settingsOpen && <SettingsDialog close={() => setSettingsOpen(false)} />}
      <LyricsModal
        isOpen={lyricsOpen}
        song={current}
        currentTime={currentTime}
        onClose={() => setLyricsOpen(false)}
        onSeek={(time) => seek(time)}
      />
    </div>
  );
}
