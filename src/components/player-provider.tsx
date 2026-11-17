"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import type { Song, PlanTier } from "@/lib/catalog";
import { songs as catalog } from "@/lib/catalog";
import { api } from "@/lib/api-client";
import { useApiToken, useRequireAuth } from "@/components/auth-provider";
import { SubscriptionModal } from "@/components/subscription-modal";
import {
  getOfflineSongBlob,
  saveSongToOffline,
  deleteOfflineSong,
  getDownloadedSongIds,
} from "@/lib/offline";

type RepeatMode = "off" | "all" | "one";
type PlayerContextValue = {
  current: Song | null;
  queue: Song[];
  playing: boolean;
  playbackError: string | null;
  radioActive: boolean;
  radioLoading: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  repeat: RepeatMode;
  shuffle: boolean;
  liked: Set<string>;
  crossfadeDuration: number;
  isOffline: boolean;
  downloadedIds: Set<string>;
  downloadingIds: Set<string>;
  userPlan: PlanTier;
  downloadsCount: number;
  downloadLimit: number | null;
  subscriptionModalOpen: boolean;
  setSubscriptionModalOpen: (open: boolean) => void;
  refreshUserProfile: () => Promise<void>;
  downloadSong: (song: Song) => Promise<void>;
  removeDownload: (songId: string) => Promise<void>;
  getAudioFrequencyData: () => Uint8Array | null;
  binauralPreset: "off" | "432hz" | "528hz" | "theta" | "delta";
  setBinauralPreset: (preset: "off" | "432hz" | "528hz" | "theta" | "delta") => void;
  binauralVolume: number;
  setBinauralVolume: (vol: number) => void;
  djNeonEnabled: boolean;
  setDjNeonEnabled: (enabled: boolean) => void;
  karaokeMode: boolean;
  setKaraokeMode: (enabled: boolean) => void;
  sleepTimer: number | null;
  setSleepTimerMinutes: (minutes: number | null) => void;
  soundPreset: "flat" | "bass_boost" | "vocal_boost" | "treble_boost" | "night_mode";
  setSoundPreset: (preset: "flat" | "bass_boost" | "vocal_boost" | "treble_boost" | "night_mode") => void;
  loudnessNormalization: boolean;
  setLoudnessNormalization: (enabled: boolean) => void;
  setCrossfadeDuration: (seconds: number) => void;
  play: (song?: Song) => void;
  pause: () => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
  toggleLike: (songId: string) => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  playQueue: (songs: Song[], shuffle?: boolean) => void;
  addToQueue: (song: Song) => void;
  startRadio: (seed?: Song) => void;
  stopRadio: () => void;
};

const PlayerContext = createContext<PlayerContextValue | null>(null);
const DEMO_AUDIO = "/api/audio/demo/stream";
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api").replace(/\/$/, "");
const RADIO_BATCH_SIZE = 20;
const RADIO_PREFETCH_THRESHOLD = 3;

type RadioPayload = { data?: unknown[] };

function asRadioSong(value: unknown, fallbackIndex: number): Song | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || typeof candidate.title !== "string") return null;

  const fallback = catalog[fallbackIndex % catalog.length];
  return {
    id: candidate.id,
    title: candidate.title,
    artist: typeof candidate.artist === "string" ? candidate.artist : typeof candidate.artistName === "string" ? candidate.artistName : "Unknown artist",
    album: typeof candidate.album === "string" ? candidate.album : "Single",
    duration: typeof candidate.duration === "number" ? candidate.duration : typeof candidate.durationSeconds === "number" ? candidate.durationSeconds : fallback.duration,
    genre: typeof candidate.genre === "string" ? candidate.genre : fallback.genre,
    plays: typeof candidate.plays === "string" ? candidate.plays : typeof candidate.playCount === "string" ? candidate.playCount : "New",
    cover: typeof candidate.cover === "string" ? candidate.cover : fallback.cover,
    accent: typeof candidate.accent === "string" ? candidate.accent : fallback.accent,
    audioUrl: typeof candidate.audioUrl === "string" ? candidate.audioUrl : undefined,
    isExclusive: candidate.isExclusive === true,
    tierRequired: candidate.tierRequired === "GOOD" || candidate.tierRequired === "PRO" || candidate.tierRequired === "GOD" ? candidate.tierRequired : "FREE",
  };
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const getApiToken = useApiToken();
  const requireAuth = useRequireAuth();

 // Dual audio elements for seamless crossfading (channel 0 = A, 1 = B)
 const audioA = useRef<HTMLAudioElement | null>(null);
 const audioB = useRef<HTMLAudioElement | null>(null);
 const [activeChannel, setActiveChannel] = useState<0 | 1>(0);
 const activeChannelRef = useRef<0 | 1>(0);

 const hlsA = useRef<Hls | null>(null);
 const hlsB = useRef<Hls | null>(null);

 const [current, setCurrent] = useState<Song | null>(catalog[0]);
 const [queue, setQueue] = useState<Song[]>(catalog);
 const [queueIndex, setQueueIndex] = useState(0);
 const [playing, setPlaying] = useState(false);
 const [playbackError, setPlaybackError] = useState<string | null>(null);
 const [radioActive, setRadioActive] = useState(false);
 const [radioLoading, setRadioLoading] = useState(false);
 const [currentTime, setCurrentTime] = useState(0);
 const [duration, setDuration] = useState(catalog[0].duration);
 const [volume, setVolumeState] = useState(0.72);
 const [repeat, setRepeat] = useState<RepeatMode>("off");
 const [shuffle, setShuffle] = useState(false);
 const [crossfadeDuration, setCrossfadeDuration] = useState<number>(4); // default 4s crossfade
 const [binauralPreset, setBinauralPreset] = useState<"off" | "432hz" | "528hz" | "theta" | "delta">("off");
 const [binauralVolume, setBinauralVolume] = useState<number>(0.18);
 const [djNeonEnabled, setDjNeonEnabled] = useState<boolean>(true);
 const [karaokeMode, setKaraokeMode] = useState<boolean>(false);
 const [sleepTimer, setSleepTimer] = useState<number | null>(null);
 const [soundPreset, setSoundPreset] = useState<"flat" | "bass_boost" | "vocal_boost" | "treble_boost" | "night_mode">("flat");
  const [loudnessNormalization, setLoudnessNormalization] = useState<boolean>(true);
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);
 const sleepTimerRef = useRef<NodeJS.Timeout | null>(null);

 const setSleepTimerMinutes = useCallback((minutes: number | null) => {
   if (sleepTimerRef.current) {
     clearTimeout(sleepTimerRef.current);
     sleepTimerRef.current = null;
   }
   setSleepTimer(minutes);
   if (minutes && minutes > 0) {
     sleepTimerRef.current = setTimeout(() => {
       const activeEl = activeChannelRef.current === 0 ? audioA.current : audioB.current;
       if (activeEl) activeEl.pause();
       setPlaying(false);
       setSleepTimer(null);
     }, minutes * 60 * 1000);
   }
 }, []);
 const djNeonRef = useRef(djNeonEnabled);
 useEffect(() => { djNeonRef.current = djNeonEnabled; }, [djNeonEnabled]);
 const binauralNodesRef = useRef<{ oscL?: OscillatorNode; oscR?: OscillatorNode; gain?: GainNode; merger?: ChannelMergerNode } | null>(null);
 const [liked, setLiked] = useState<Set<string>>(new Set(catalog.filter((song) => song.liked).map((song) => song.id)));
 const likedRef = useRef(liked);

 // Offline / Download & Subscription state
 const [isOffline, setIsOffline] = useState(false);
 const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());
 const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
 const [userPlan, setUserPlan] = useState<PlanTier>("FREE");
 const [downloadsCount, setDownloadsCount] = useState<number>(0);
 const [downloadLimit, setDownloadLimit] = useState<number | null>(10);
 const [subscriptionModalOpen, setSubscriptionModalOpen] = useState(false);

 useEffect(() => {
   likedRef.current = liked;
 }, [liked]);

 // Restore the signed-in user's likes so the playlist and heart buttons survive reloads.
 useEffect(() => {
   let cancelled = false;
   void (async () => {
     const token = await getApiToken();
     if (!token) return;
     try {
       const library = await api.library(token);
       if (cancelled) return;
       const next = new Set(library.likedSongs.map((song) => song.id));
       likedRef.current = next;
       setLiked(next);
     } catch {
       // The local catalog remains usable when the API is unavailable.
     }
   })();
   return () => { cancelled = true; };
 }, [getApiToken]);

 const refreshUserProfile = useCallback(async () => {
   try {
     const token = await getApiToken();
     if (!token) return;
     const res = await fetch(`${API_URL}/me`, {
       headers: { Authorization: `Bearer ${token}` },
     });
     if (res.ok) {
       const data = await res.json();
       if (data.plan) setUserPlan(data.plan);
       if (typeof data.downloadsCount === "number") setDownloadsCount(data.downloadsCount);
       if (data.downloadLimit === null || typeof data.downloadLimit === "number") setDownloadLimit(data.downloadLimit);
     }
   } catch (err) {
     if (err instanceof TypeError) {
       return;
     }
     console.error("Failed to refresh user profile:", err);
   }
 }, [getApiToken]);

 useEffect(() => {
   void refreshUserProfile();
 }, [refreshUserProfile]);

 const TIER_RANKS: Record<PlanTier, number> = useMemo(() => ({ FREE: 0, GOOD: 1, PRO: 2, GOD: 3 }), []);

 const isTrackLocked = useCallback((song: Song) => {
   if (!song.isExclusive || !song.tierRequired) return false;
   return TIER_RANKS[userPlan] < TIER_RANKS[song.tierRequired];
 }, [userPlan, TIER_RANKS]);

 // Web Audio visualizer refs
 const audioCtxRef = useRef<AudioContext | null>(null);
 const analyserRef = useRef<AnalyserNode | null>(null);
 const sourceARef = useRef<MediaElementAudioSourceNode | null>(null);
 const sourceBRef = useRef<MediaElementAudioSourceNode | null>(null);
 const freqDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

 const listeningEventSentFor = useRef<string | null>(null);
 const radioSession = useRef(0);
 const radioFetch = useRef<{ sessionId: number; promise: Promise<Song[]> } | null>(null);
 const crossfadeTimer = useRef<NodeJS.Timeout | null>(null);
 const playbackGenerationRef = useRef(0);
 const isTransitioningRef = useRef(false);
 const playbackAttemptRef = useRef(0);
 const lastPlaybackPositionRef = useRef(0);
 const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);



 // Sync offline downloads & online status
 useEffect(() => {
   getDownloadedSongIds().then(setDownloadedIds).catch(() => undefined);
   const updateOnlineStatus = () => setIsOffline(!navigator.onLine);
   setIsOffline(!navigator.onLine);
   window.addEventListener("online", updateOnlineStatus);
   window.addEventListener("offline", updateOnlineStatus);
   return () => {
     window.removeEventListener("online", updateOnlineStatus);
     window.removeEventListener("offline", updateOnlineStatus);
   };
 }, []);

 const setupAudioContext = useCallback(() => {
   if (typeof window === "undefined") return;
   try {
     if (!audioCtxRef.current) {
       const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
       if (!AudioCtx) return;
       const ctx = new AudioCtx();
       const analyser = ctx.createAnalyser();
       analyser.fftSize = 128;
       analyser.smoothingTimeConstant = 0.8;
       analyserRef.current = analyser;
       freqDataRef.current = new Uint8Array(analyser.frequencyBinCount);

       if (audioA.current && !sourceARef.current) {
         sourceARef.current = ctx.createMediaElementSource(audioA.current);
         sourceARef.current.connect(analyser);
       }
       if (audioB.current && !sourceBRef.current) {
         sourceBRef.current = ctx.createMediaElementSource(audioB.current);
         sourceBRef.current.connect(analyser);
       }
       const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.setValueAtTime(-24, ctx.currentTime);
        compressor.knee.setValueAtTime(30, ctx.currentTime);
        compressor.ratio.setValueAtTime(12, ctx.currentTime);
        compressor.attack.setValueAtTime(0.003, ctx.currentTime);
        compressor.release.setValueAtTime(0.25, ctx.currentTime);
        compressorRef.current = compressor;
        analyser.connect(compressor);
        compressor.connect(ctx.destination);
       audioCtxRef.current = ctx;
     }
     if (audioCtxRef.current?.state === "suspended") {
       void audioCtxRef.current.resume();
     }
   } catch {
     // AudioContext policy
   }
 }, []);

  const getAudioFrequencyData = useCallback(() => {
    if (!analyserRef.current || !freqDataRef.current) return null;
    analyserRef.current.getByteFrequencyData(freqDataRef.current);
    return freqDataRef.current;
  }, []);

  // Binaural Solfeggio / Theta-Delta Audio Generator
  useEffect(() => {
    if (typeof window === "undefined") return;
    setupAudioContext();
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    if (binauralNodesRef.current) {
      try {
        binauralNodesRef.current.oscL?.stop();
        binauralNodesRef.current.oscR?.stop();
        binauralNodesRef.current.oscL?.disconnect();
        binauralNodesRef.current.oscR?.disconnect();
        binauralNodesRef.current.gain?.disconnect();
        binauralNodesRef.current.merger?.disconnect();
      } catch {}
      binauralNodesRef.current = null;
    }

    if (binauralPreset === "off" || !playing) return;

    let freqL = 432;
    let freqR = 432;
    if (binauralPreset === "432hz") {
      freqL = 432;
      freqR = 432;
    } else if (binauralPreset === "528hz") {
      freqL = 528;
      freqR = 528;
    } else if (binauralPreset === "theta") {
      freqL = 432;
      freqR = 438;
    } else if (binauralPreset === "delta") {
      freqL = 216;
      freqR = 218.5;
    }

    try {
      const oscL = ctx.createOscillator();
      const oscR = ctx.createOscillator();
      const gain = ctx.createGain();
      const merger = ctx.createChannelMerger(2);

      oscL.type = "sine";
      oscR.type = "sine";
      oscL.frequency.setValueAtTime(freqL, ctx.currentTime);
      oscR.frequency.setValueAtTime(freqR, ctx.currentTime);

      gain.gain.setValueAtTime(Math.min(0.35, Math.max(0.02, binauralVolume)), ctx.currentTime);

      oscL.connect(merger, 0, 0);
      oscR.connect(merger, 0, 1);
      merger.connect(gain);
      gain.connect(ctx.destination);

      oscL.start();
      oscR.start();

      binauralNodesRef.current = { oscL, oscR, gain, merger };
    } catch {}

    return () => {
      if (binauralNodesRef.current) {
        try {
          binauralNodesRef.current.oscL?.stop();
          binauralNodesRef.current.oscR?.stop();
          binauralNodesRef.current.oscL?.disconnect();
          binauralNodesRef.current.oscR?.disconnect();
          binauralNodesRef.current.gain?.disconnect();
          binauralNodesRef.current.merger?.disconnect();
        } catch {}
        binauralNodesRef.current = null;
      }
    };
  }, [binauralPreset, binauralVolume, playing, setupAudioContext]);

 // Dynamic loudness normalization control (Spotify/Apple Music EBU R128 style)
  useEffect(() => {
    if (!audioCtxRef.current || !compressorRef.current) return;
    const comp = compressorRef.current;
    if (loudnessNormalization) {
      comp.threshold.setValueAtTime(-24, audioCtxRef.current.currentTime);
      comp.ratio.setValueAtTime(12, audioCtxRef.current.currentTime);
    } else {
      comp.threshold.setValueAtTime(0, audioCtxRef.current.currentTime);
      comp.ratio.setValueAtTime(1, audioCtxRef.current.currentTime);
    }
  }, [loudnessNormalization]);

  // Active audio element helper
 const getActiveAudio = useCallback(() => (activeChannelRef.current === 0 ? audioA.current : audioB.current), []);
 const getInactiveAudio = useCallback(() => (activeChannelRef.current === 0 ? audioB.current : audioA.current), []);
 const getActiveHlsRef = useCallback(() => (activeChannelRef.current === 0 ? hlsA : hlsB), []);
 const getInactiveHlsRef = useCallback(() => (activeChannelRef.current === 0 ? hlsB : hlsA), []);

 const radioTracksFor = useCallback(async (seed: Song) => {
   const token = await getApiToken();
   const path = `/songs/${encodeURIComponent(seed.id)}/radio?limit=${RADIO_BATCH_SIZE}`;
   const endpoint = token ? `${API_URL}${path}` : `/api${path}`;
   const response = await fetch(endpoint, {
     cache: "no-store",
     headers: token ? { Authorization: `Bearer ${token}` } : undefined,
   });
   if (!response.ok) throw new Error("Unable to load radio recommendations");
   const payload = await response.json() as RadioPayload;
   return (payload.data ?? [])
     .map((song, index) => asRadioSong(song, index))
     .filter((song): song is Song => Boolean(song && song.id !== seed.id));
 }, [getApiToken]);

 const sendListeningEvent = useCallback(async (song: Song, playDurationSeconds: number, completed: boolean) => {
    // Record locally immediately so daily leaderboard & progress reflect the play right away
    if (typeof window !== "undefined") {
      try {
        const today = new Date().toISOString().split("T")[0];
        const raw = localStorage.getItem("streamify-local-leaderboard-stats");
        let parsed: { date: string; playedSongIds: string[] } = { date: today, playedSongIds: [] };
        if (raw) {
          const stored = JSON.parse(raw);
          if (stored && stored.date === today && Array.isArray(stored.playedSongIds)) {
            parsed = stored;
          }
        }
        if (!parsed.playedSongIds.includes(song.id)) {
          parsed.playedSongIds.push(song.id);
          localStorage.setItem("streamify-local-leaderboard-stats", JSON.stringify(parsed));
          window.dispatchEvent(new CustomEvent("streamify-listening-updated", { detail: parsed }));
        }
      } catch {
        // ignore localStorage errors
      }
    }

    if (navigator.onLine === false) return;
    const token = await getApiToken();
    const endpoint = "/api/listening-events";
    await fetch(endpoint, {
      method: "POST",
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
      body: JSON.stringify({ songId: song.id, playDurationSeconds: Math.round(playDurationSeconds), completed }),
    }).catch(() => undefined);
  }, [getApiToken]);

 const reportPlayback = useCallback((song: Song, status: "ok" | "error" | "degraded" | "blocked", errorCode?: string, bitrate?: string, attempt = 0) => {
   const tokenPromise = getApiToken();
   void tokenPromise.then((token) => fetch(`${API_URL}/events/playback`, {
     method: "POST",
     headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
     body: JSON.stringify({ songId: song.id, status, errorCode, bitrate, attempt, bufferedMs: 0, userAgent: navigator.userAgent }),
   }).catch(() => undefined));
 }, [getApiToken]);

 const attachSourceToElement = useCallback(async (targetEl: HTMLAudioElement, hlsRef: React.MutableRefObject<Hls | null>, song: Song, bitrate: "160" | "320" = "320", generation?: number): Promise<boolean> => {
   const isCurrent = () => generation === undefined || playbackGenerationRef.current === generation;
   if (!isCurrent()) return false;

   hlsRef.current?.destroy();
   hlsRef.current = null;

   try {
     const cached = await getOfflineSongBlob(song.id);
     if (!isCurrent()) return false;
     if (cached?.blob) {
       targetEl.src = URL.createObjectURL(cached.blob);
       targetEl.load();
       return true;
     }
   } catch {
     // fallback to network
   }

  const isDemoPreview = song.audioUrl === DEMO_AUDIO || song.id.startsWith("demo-") || song.id === "cmg_demo_neon_song";
  let streamUrl = song.audioUrl ?? (isDemoPreview ? DEMO_AUDIO : undefined);

   if (!streamUrl && song.id.length > 20) {
     try {
       const token = await getApiToken();
       const response = await fetch(`${API_URL}/songs/${encodeURIComponent(song.id)}/stream`, {
         headers: token ? { Authorization: `Bearer ${token}` } : {},
         ...(bitrate === "160" ? { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "x-bitrate": bitrate } } : {}),
         redirect: "follow",
       });
       if (!isCurrent()) return false;
       if (!response.ok) {
         const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;
         throw new Error(payload?.message ?? payload?.error ?? `STREAM_${response.status}`);
       }
       const payload = await response.json() as { streamUrl?: string };
       if (!payload.streamUrl) throw new Error("STREAM_URL_MISSING");
       streamUrl = payload.streamUrl;
     } catch {
       if (!isCurrent()) return false;
       if (isDemoPreview) {
         streamUrl = DEMO_AUDIO;
       } else {
         setPlaybackError("This track is not ready for playback yet. Upload or import a real audio file before playing it.");
         setPlaying(false);
         return false;
       }
     }
   }

   if (!isCurrent()) return false;

   if (!streamUrl) {
     if (isDemoPreview) {
       streamUrl = DEMO_AUDIO;
     } else {
       setPlaybackError("This track is not ready for playback yet. Upload or import a real audio file before playing it.");
       setPlaying(false);
       return false;
     }
   }

   if (streamUrl.includes(".m3u8") && Hls.isSupported()) {
     const hls = new Hls({ enableWorker: true, backBufferLength: 90, maxBufferLength: 45 });
     hls.loadSource(streamUrl);
     hls.attachMedia(targetEl);
     hlsRef.current = hls;
   } else {
     targetEl.src = streamUrl;
     targetEl.load();
   }

   return true;
 }, [getApiToken]);

 const downloadSong = useCallback(async (song: Song) => {
   if (song.isImported || downloadingIds.has(song.id) || downloadedIds.has(song.id)) return;
   if (!requireAuth()) return;
   if (isTrackLocked(song) || (downloadLimit !== null && downloadsCount >= downloadLimit)) {
     setSubscriptionModalOpen(true);
     return;
   }
   setDownloadingIds((prev) => new Set(prev).add(song.id));
   try {
     const token = await getApiToken();
     if (!token) throw new Error("Sign in is required to download music.");
     const res = await fetch(`${API_URL}/downloads`, {
       method: "POST",
       headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
       body: JSON.stringify({ songId: song.id, bitrate: "320k" }),
     });
     if (res.status === 403) {
       setSubscriptionModalOpen(true);
       return;
     }
     if (!res.ok) {
       const error = await res.json().catch(() => null) as { message?: string } | null;
       throw new Error(error?.message ?? `Unable to authorize this download (HTTP ${res.status}).`);
     }
     const data = await res.json();
     if (!data.downloadUrl || !data.licenseExpiresAt) throw new Error("The download link is unavailable.");
     const downloadUrl = data.downloadUrl as string;
     const licenseExpiresAt = new Date(data.licenseExpiresAt).getTime();

     const audioRes = await fetch(downloadUrl);
     if (!audioRes.ok) throw new Error("Failed to fetch audio stream");
     const blob = await audioRes.blob();
     await saveSongToOffline(song, blob, "320k", licenseExpiresAt);
     setDownloadedIds((prev) => new Set(prev).add(song.id));
     void refreshUserProfile();
   } catch (err) {
     console.error("Offline download failed:", err);
   } finally {
     setDownloadingIds((prev) => {
       const next = new Set(prev);
       next.delete(song.id);
       return next;
     });
   }
 }, [downloadedIds, downloadingIds, downloadsCount, downloadLimit, isTrackLocked, getApiToken, refreshUserProfile, requireAuth]);

 const removeDownload = useCallback(async (songId: string) => {
   try {
     await deleteOfflineSong(songId);
     setDownloadedIds((prev) => {
       const next = new Set(prev);
       next.delete(songId);
       return next;
     });
   } catch (err) {
     console.error("Failed to remove download:", err);
   }
 }, []);

 const select = useCallback((song: Song, shouldPlay = true, position = 0, fade = false) => {
 if (isTrackLocked(song)) {
   setSubscriptionModalOpen(true);
   setPlaying(false);
   return;
 }
 const generation = ++playbackGenerationRef.current;
 setupAudioContext();
 if (crossfadeTimer.current) {
 clearInterval(crossfadeTimer.current);
 crossfadeTimer.current = null;
 }

 const currentEl = getActiveAudio();
 const nextEl = getInactiveAudio();
 const nextHlsRef = getInactiveHlsRef();
 const currentHlsRef = getActiveHlsRef();

 isTransitioningRef.current = false;
 nextEl?.pause();
 if (nextEl) nextEl.currentTime = 0;
 nextHlsRef.current?.destroy();
 nextHlsRef.current = null;

 setCurrent(song);
 setQueueIndex(position);
 setDuration(song.duration);
 setCurrentTime(0);
 setPlaybackError(null);
 playbackAttemptRef.current = 0;
 lastPlaybackPositionRef.current = 0;
 listeningEventSentFor.current = null;

 if (fade && crossfadeDuration > 0 && currentEl && nextEl && playing) {
 isTransitioningRef.current = true;
 nextEl.currentTime = 0;
 nextEl.volume = 0;
 void attachSourceToElement(nextEl, nextHlsRef, song, "320", generation)
   .then((attached) => {
     if (!attached || playbackGenerationRef.current !== generation) return undefined;
     return nextEl.play();
   })
   .then(() => {
      if (playbackGenerationRef.current !== generation) return;
     const steps = 20;
     const intervalTime = (crossfadeDuration * 1000) / steps;
     let step = 0;

       crossfadeTimer.current = setInterval(() => {
         if (playbackGenerationRef.current !== generation) {
           if (crossfadeTimer.current) clearInterval(crossfadeTimer.current);
           crossfadeTimer.current = null;
           return;
         }
       step += 1;
       const progress = Math.min(1, step / steps);
       if (currentEl) currentEl.volume = Math.max(0, volume * (1 - progress));
       nextEl.volume = Math.min(volume, volume * progress);

       if (step >= steps) {
         if (crossfadeTimer.current) clearInterval(crossfadeTimer.current);
         crossfadeTimer.current = null;
         if (currentEl) {
           currentEl.pause();
           currentEl.currentTime = 0;
         }
         currentHlsRef.current?.destroy();
         currentHlsRef.current = null;
          const nextChannel = activeChannelRef.current === 0 ? 1 : 0;
          activeChannelRef.current = nextChannel;
          setActiveChannel(nextChannel);
         isTransitioningRef.current = false;
       }
     }, intervalTime);
   })
   .catch(() => {
     if (playbackGenerationRef.current !== generation) return;
     isTransitioningRef.current = false;
     setPlaying(false);
   });
 } else {
 // Standard / Instant switch
 if (currentEl) {
 currentEl.pause();
 currentEl.currentTime = 0;
 }
 currentHlsRef.current?.destroy();
 currentHlsRef.current = null;

 if (nextEl) {
 nextEl.volume = volume;
 nextEl.currentTime = 0;
  void attachSourceToElement(nextEl, nextHlsRef, song, "320", generation)
    .then((attached) => {
      if (!attached || playbackGenerationRef.current !== generation || !shouldPlay) return undefined;
      return nextEl.play();
    })
    .catch(() => {
      if (playbackGenerationRef.current === generation) setPlaying(false);
    });
 }
 const nextChannel = activeChannelRef.current === 0 ? 1 : 0;
 activeChannelRef.current = nextChannel;
 setActiveChannel(nextChannel);
 isTransitioningRef.current = false;
 }

 setPlaying(shouldPlay);
  }, [attachSourceToElement, crossfadeDuration, getActiveAudio, getActiveHlsRef, getInactiveAudio, getInactiveHlsRef, isTrackLocked, playing, setupAudioContext, volume]);

 const play = useCallback((song?: Song) => {
 if (!requireAuth()) return;
 const targetSong = song ?? current;
 if (targetSong && isTrackLocked(targetSong)) {
   setSubscriptionModalOpen(true);
   return;
 }
 
 const activeEl = getActiveAudio();
 if (!activeEl?.src && targetSong) return select(targetSong, true, queueIndex, false);
 if (song && song.id !== current?.id) {
 if (radioActive) {
 radioSession.current += 1;
 radioFetch.current = null;
 setRadioActive(false);
 setRadioLoading(false);
 setQueue(catalog);
 }
 return select(song, true, Math.max(0, catalog.findIndex((item) => item.id === song.id)), false);
 }
 if (!activeEl) return;
 void activeEl.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
 }, [current, getActiveAudio, isTrackLocked, queueIndex, radioActive, select, requireAuth]);

 const playQueue = useCallback((tracks: Song[], shouldShuffle = false) => {
   if (!tracks.length || !requireAuth()) return;
   const nextQueue = shouldShuffle ? [...tracks].sort(() => Math.random() - 0.5) : tracks;
   setQueue(nextQueue);
   select(nextQueue[0], true, 0, false);
 }, [requireAuth, select]);

 const pause = useCallback(() => {
 playbackGenerationRef.current += 1;
 if (crossfadeTimer.current) {
 clearInterval(crossfadeTimer.current);
 crossfadeTimer.current = null;
 }
 isTransitioningRef.current = false;
 audioA.current?.pause();
 audioB.current?.pause();
 setPlaying(false);
 }, []);

 const toggle = useCallback(() => (playing ? pause() : play()), [pause, play, playing]);

 const next = useCallback((withFade = true) => {
 if (!current) return;
 const nextIndex = shuffle ? Math.floor(Math.random() * queue.length) : queueIndex + 1;
 const candidate = queue[nextIndex];
 if (candidate) select(candidate, true, nextIndex, withFade);
 }, [current, queue, queueIndex, select, shuffle]);

 const previous = useCallback(() => {
 const activeEl = getActiveAudio();
 if (currentTime > 3 && activeEl) {
 activeEl.currentTime = 0;
 return;
 }
 const previousIndex = (queueIndex - 1 + queue.length) % queue.length;
 const candidate = queue[previousIndex];
 if (candidate) select(candidate, true, previousIndex, true);
 }, [currentTime, getActiveAudio, queue, queueIndex, select]);

 const seek = useCallback((seconds: number) => {
 const activeEl = getActiveAudio();
 if (activeEl) activeEl.currentTime = seconds;
 setCurrentTime(seconds);
 }, [getActiveAudio]);

 const setVolume = useCallback((value: number) => {
 const normalized = Math.max(0, Math.min(1, value));
 const activeEl = getActiveAudio();
 if (activeEl && !isTransitioningRef.current) activeEl.volume = normalized;
 setVolumeState(normalized);
 }, [getActiveAudio]);

 const toggleLike = useCallback((songId: string) => {
   if (songId.startsWith("s3-")) return;
   if (!requireAuth()) return;

   const wasLiked = likedRef.current.has(songId);
   const shouldLike = !wasLiked;
   const optimistic = new Set(likedRef.current);
   if (shouldLike) optimistic.add(songId);
   else optimistic.delete(songId);
   likedRef.current = optimistic;
   setLiked(optimistic);

   void (async () => {
     const token = await getApiToken();
     // Keep the local demo behavior when authentication is not configured.
     if (!token) return;
     try {
       if (shouldLike) await api.likeSong(songId, token);
       else await api.unlikeSong(songId, token);
     } catch {
       // Roll back only if the user has not changed the state again meanwhile.
       if (likedRef.current.has(songId) !== shouldLike) return;
       const rolledBack = new Set(likedRef.current);
       if (wasLiked) rolledBack.add(songId);
       else rolledBack.delete(songId);
       likedRef.current = rolledBack;
       setLiked(rolledBack);
     }
   })();
 }, [getApiToken, requireAuth]);

 const toggleRepeat = useCallback(() => setRepeat((mode) => (mode === "off" ? "all" : mode === "all" ? "one" : "off")), []);
 const addToQueue = useCallback((song: Song) => {
   if (!requireAuth()) return;
   setQueue((old) => (old.some((item) => item.id === song.id) ? old : [...old, song]));
 }, [requireAuth]);

 const appendRadioTracks = useCallback((seed: Song, sessionId: number) => {
 if (radioFetch.current?.sessionId === sessionId) return radioFetch.current.promise;
 const promise = (async () => {
 setRadioLoading(true);
 try {
 const recommendations = await radioTracksFor(seed);
 if (radioSession.current !== sessionId) return [];
 setQueue((existing) => [...existing, ...recommendations]);
 return recommendations;
 } catch {
 if (radioSession.current !== sessionId) return [];
 const fallback = catalog.filter((song) => song.id !== seed.id);
 setQueue((existing) => [...existing, ...fallback]);
 return fallback;
 } finally {
 if (radioSession.current === sessionId) setRadioLoading(false);
 }
 })();
 radioFetch.current = { sessionId, promise };
 void promise.finally(() => {
 if (radioFetch.current?.promise === promise) radioFetch.current = null;
 });
 return promise;
 }, [radioTracksFor]);

 const startRadio = useCallback((seed = current ?? catalog[0]) => {
 if (!requireAuth()) return;
 if (!seed || seed.isImported) return;
 const sessionId = radioSession.current + 1;
 radioSession.current = sessionId;
 radioFetch.current = null;
 setRadioActive(true);
 setQueue([seed]);
 select(seed, true, 0, false);
 void appendRadioTracks(seed, sessionId);
 }, [appendRadioTracks, current, select, requireAuth]);

 const stopRadio = useCallback(() => {
 radioSession.current += 1;
 radioFetch.current = null;
 setRadioActive(false);
 setRadioLoading(false);
 setQueue((existing) => (current ? [current, ...catalog.filter((song) => song.id !== current.id)] : existing));
 setQueueIndex(0);
 }, [current]);

 // Handle active audio element listeners
 useEffect(() => {
 const element = activeChannel === 0 ? audioA.current : audioB.current;
 if (!element) return;

 if (!isTransitioningRef.current) {
 element.volume = volume;
 }

 const timeUpdate = () => {
 if (getActiveAudio() !== element) return;
 if (stallTimerRef.current) {
 clearTimeout(stallTimerRef.current);
 stallTimerRef.current = null;
 }
 const elapsed = element.currentTime;
 setCurrentTime(elapsed);
 const trackDuration = Number.isFinite(element.duration) && element.duration > 1 ? element.duration : current?.duration ?? 0;

 // Check for trigger of natural end-of-track crossfade
 if (
 crossfadeDuration > 0 &&
 trackDuration > crossfadeDuration &&
 trackDuration - elapsed <= crossfadeDuration &&
 !isTransitioningRef.current &&
 playing &&
 (queueIndex < queue.length - 1 || repeat === "all" || shuffle || radioActive)
 ) {
 next(true);
 return;
 }

 if (current && trackDuration > 0 && elapsed / trackDuration >= 0.8 && listeningEventSentFor.current !== current.id) {
 listeningEventSentFor.current = current.id;
 void sendListeningEvent(current, elapsed, false).catch(() => undefined);
 }
 };

 const metadata = () => {
   if (getActiveAudio() !== element) return;
   setDuration(Number.isFinite(element.duration) && element.duration > 1 ? element.duration : current?.duration ?? 0);
 };

 const onPlaying = () => {
   if (getActiveAudio() !== element) return;
   if (stallTimerRef.current) {
     clearTimeout(stallTimerRef.current);
     stallTimerRef.current = null;
   }
   setPlaybackError(null);
   setPlaying(true);
   if (current) reportPlayback(current, playbackAttemptRef.current > 0 ? "degraded" : "ok", undefined, playbackAttemptRef.current > 0 ? "160" : "320", playbackAttemptRef.current);
 };
 const onWaiting = () => {
   if (getActiveAudio() !== element) return;
   setPlaybackError(null);
   if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
   const stalledAt = element.currentTime;
   stallTimerRef.current = setTimeout(() => {
     stallTimerRef.current = null;
     if (!current || getActiveAudio() !== element || isTransitioningRef.current || playbackAttemptRef.current >= 3) return;
    if (element.seeking) return;
     if (element.currentTime > stalledAt) return;
     lastPlaybackPositionRef.current = element.currentTime;
     playbackAttemptRef.current += 1;
     const generation = playbackGenerationRef.current;
      const hlsRef = activeChannelRef.current === 0 ? hlsA : hlsB;
      void attachSourceToElement(element, hlsRef, current, "160", generation)
       .then((attached) => {
         if (!attached || playbackGenerationRef.current !== generation || getActiveAudio() !== element) return undefined;
         element.currentTime = lastPlaybackPositionRef.current;
         return element.play();
       })
       .catch(() => undefined);
   }, 8000);
 };
 const onError = () => {
   if (getActiveAudio() !== element) return;
   if (!current || isTransitioningRef.current) return;
   const position = element.currentTime || lastPlaybackPositionRef.current;
   lastPlaybackPositionRef.current = position;
   playbackAttemptRef.current += 1;
   if (playbackAttemptRef.current <= 3) {
     const retryBitrate = playbackAttemptRef.current >= 2 ? "160" : "320";
     const generation = playbackGenerationRef.current;
     const hlsRef = activeChannelRef.current === 0 ? hlsA : hlsB;
     void attachSourceToElement(element, hlsRef, current, retryBitrate, generation).then((attached) => {
       if (!attached || playbackGenerationRef.current !== generation || getActiveAudio() !== element) return undefined;
       element.currentTime = position;
       return element.play();
     }).catch(() => undefined);
     return;
   }
   setPlaying(false);
   setPlaybackError("This track could not be played. Check your connection and try again.");
   reportPlayback(current, "error", element.error ? `MEDIA_ERR_${element.error.code}` : "NETWORK", "160", playbackAttemptRef.current);
 };

 const playDjInterlude = (endedSong: Song, upcomingSong: Song, onDone: () => void) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      onDone();
      return;
    }
    const synth = window.speechSynthesis;
    synth.cancel();
    const intros = [
      "That was " + endedSong.title + " by " + endedSong.artist + ". Up next, rolling into " + upcomingSong.title + ".",
      "Vibing with Neon. Coming right up is " + upcomingSong.title + " by " + upcomingSong.artist + ".",
      "You are listening to Neon. Next track is " + upcomingSong.title + ". Stay locked in.",
    ];
    const phrase = intros[Math.floor(Math.random() * intros.length)];
    const utterance = new SpeechSynthesisUtterance(phrase);
    utterance.lang = "en-US";
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    utterance.onend = () => onDone();
    utterance.onerror = () => onDone();
    synth.speak(utterance);
  };

  const ended = () => {
    if (getActiveAudio() !== element) return;
    if (!current || isTransitioningRef.current) return;
    if (listeningEventSentFor.current !== current.id) {
      listeningEventSentFor.current = current.id;
      void sendListeningEvent(current, current.duration, true).catch(() => undefined);
    }
    if (repeat === "one") {
      element.currentTime = 0;
      void element.play();
      return;
    }
    const nextIndex = shuffle ? Math.floor(Math.random() * queue.length) : queueIndex + 1;
    const upcoming = queue[nextIndex];

    const proceedNext = () => {
      if (shuffle || repeat === "all" || queueIndex < queue.length - 1) next(false);
      else if (radioActive) {
        const sessionId = radioSession.current;
        void appendRadioTracks(current, sessionId).then((tracks) => {
          if (radioSession.current !== sessionId) return;
          const nextSong = tracks[0];
          if (nextSong) select(nextSong, true, queueIndex + 1, false);
          else setPlaying(false);
        });
      } else {
        setPlaying(false);
      }
    };

    if (djNeonRef.current && upcoming && Math.random() < 0.6) {
      playDjInterlude(current, upcoming, proceedNext);
    } else {
      proceedNext();
    }
  };

 element.addEventListener("timeupdate", timeUpdate);
 element.addEventListener("loadedmetadata", metadata);
 element.addEventListener("playing", onPlaying);
 element.addEventListener("waiting", onWaiting);
 element.addEventListener("stalled", onWaiting);
 element.addEventListener("error", onError);
 element.addEventListener("ended", ended);
 return () => {
 element.removeEventListener("timeupdate", timeUpdate);
 element.removeEventListener("loadedmetadata", metadata);
 element.removeEventListener("playing", onPlaying);
 element.removeEventListener("waiting", onWaiting);
 element.removeEventListener("stalled", onWaiting);
 element.removeEventListener("error", onError);
 element.removeEventListener("ended", ended);
 if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
 };
 }, [
 activeChannel,
 appendRadioTracks,
 attachSourceToElement,
 crossfadeDuration,
 current,
 getActiveAudio,
 next,
 playing,
 playbackError,
 queue.length,
 queueIndex,
 radioActive,
 repeat,
 select,
 sendListeningEvent,
 reportPlayback,
 shuffle,
 volume,
 ]);

 useEffect(() => {
 if (!radioActive || !current || radioLoading || queue.length - queueIndex - 1 > RADIO_PREFETCH_THRESHOLD) return;
 void appendRadioTracks(current, radioSession.current);
 }, [appendRadioTracks, current, queue.length, queueIndex, radioActive, radioLoading]);

 useEffect(() => {
    const currentHlsA = hlsA.current;
    const currentHlsB = hlsB.current;
    const timer = crossfadeTimer.current;
    return () => {
      currentHlsA?.destroy();
      currentHlsB?.destroy();
      if (timer) clearInterval(timer);
    };
  }, []);

 const value = useMemo(
 () => ({
 current,
 queue,
 playing,
 playbackError,
 radioActive,
 radioLoading,
 currentTime,
 duration,
 volume,
 repeat,
 shuffle,
 liked,
 crossfadeDuration,
 isOffline,
 downloadedIds,
 downloadingIds,
 userPlan,
 downloadsCount,
 downloadLimit,
 subscriptionModalOpen,
 setSubscriptionModalOpen,
 refreshUserProfile,
 downloadSong,
 removeDownload,
 getAudioFrequencyData,
 binauralPreset,
 setBinauralPreset,
 binauralVolume,
 setBinauralVolume,
 djNeonEnabled,
 setDjNeonEnabled,
 karaokeMode,
 setKaraokeMode,
 sleepTimer,
 setSleepTimerMinutes,
 soundPreset,
 setSoundPreset,
      loudnessNormalization,
      setLoudnessNormalization,
 setCrossfadeDuration,
 play,
 pause,
 toggle,
 next: () => next(true),
 previous,
 seek,
 setVolume,
 toggleLike,
 toggleShuffle: () => setShuffle((state) => !state),
 toggleRepeat,
 playQueue,
 addToQueue,
 startRadio,
 stopRadio,
 }),
 [
 addToQueue,
 crossfadeDuration,
 current,
 currentTime,
 playbackError,
 downloadSong,
 downloadedIds,
 downloadingIds,
 userPlan,
 downloadsCount,
 downloadLimit,
 subscriptionModalOpen,
 setSubscriptionModalOpen,
 refreshUserProfile,
 duration,
 getAudioFrequencyData,
 binauralPreset,
 setBinauralPreset,
 binauralVolume,
 setBinauralVolume,
 djNeonEnabled,
 setDjNeonEnabled,
 karaokeMode,
 setKaraokeMode,
 sleepTimer,
 setSleepTimerMinutes,
 soundPreset,
 setSoundPreset,
      loudnessNormalization,
      setLoudnessNormalization,
 isOffline,
 liked,
 next,
 pause,
 play,
 playQueue,
 playing,
 previous,
 queue,
 radioActive,
 radioLoading,
 removeDownload,
 repeat,
 seek,
 setCrossfadeDuration,
 setVolume,
 shuffle,
 startRadio,
 stopRadio,
 toggle,
 toggleLike,
 toggleRepeat,
 volume,
 ]
 );

 return (
 <PlayerContext.Provider value={value}>
 <audio ref={audioA} preload="metadata" crossOrigin="anonymous" />
 <audio ref={audioB} preload="metadata" crossOrigin="anonymous" />
 <>{children}</>
 <SubscriptionModal
   isOpen={subscriptionModalOpen}
   onClose={() => setSubscriptionModalOpen(false)}
   currentPlan={userPlan}
   onSuccess={(newPlan) => {
     setUserPlan(newPlan);
     void refreshUserProfile();
   }}
 />
 </PlayerContext.Provider>
 );
}

export function usePlayer() {
 const context = useContext(PlayerContext);
 if (!context) throw new Error("usePlayer must be used inside PlayerProvider");
 return context;
}
