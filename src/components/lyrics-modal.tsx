"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Mic2, X, Sparkles, Music } from "lucide-react";
import type { Song } from "@/lib/catalog";
import { parseLRC, findCurrentLyricIndex, DEMO_LYRICS, generateSmartKaraokeLyrics, type LyricLine } from "@/lib/lyrics";
import { CoverArt } from "@/components/cover-art";
import { cn } from "@/lib/utils";
import { useApiToken } from "@/components/auth-provider";

interface LyricsModalProps {
  song: Song | null;
  currentTime: number;
  isOpen: boolean;
  onClose: () => void;
  onSeek: (time: number) => void;
}

export function LyricsModal({ song, currentTime, isOpen, onClose, onSeek }: LyricsModalProps) {
  const [rawLyrics, setRawLyrics] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [authorizedToTranscribe, setAuthorizedToTranscribe] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState("");
  const activeLineRef = useRef<HTMLParagraphElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const getApiToken = useApiToken();

  useEffect(() => {
    if (!song || !isOpen) return;

    setRawLyrics("");
    setTranscriptionError("");
    setAuthorizedToTranscribe(false);
    if (DEMO_LYRICS[song.id]) {
      setRawLyrics(DEMO_LYRICS[song.id]);
      return;
    }

    // Match by title keywords for Bollywood / imported catalog
    const slug = song.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const matchedKey = Object.keys(DEMO_LYRICS).find((key) => slug.includes(key) || key.includes(slug));
    if (matchedKey && DEMO_LYRICS[matchedKey]) {
      setRawLyrics(DEMO_LYRICS[matchedKey]);
      return;
    }

    let active = true;
    setLoading(true);
    fetch(`/api/songs/${encodeURIComponent(song.id)}/lyrics`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data?.lyrics) {
          setRawLyrics(data.lyrics);
        } else if (active) {
          setRawLyrics(generateSmartKaraokeLyrics(song.title, song.artist));
        }
      })
      .catch(() => {
        if (active) setRawLyrics(generateSmartKaraokeLyrics(song.title, song.artist));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [song, isOpen]);

  const transcribeAudio = async () => {
    if (!song || transcribing) return;
    setTranscriptionError("");
    setTranscribing(true);
    try {
      const token = await getApiToken();
      if (!token) throw new Error("Sign in to transcribe audio from your upload.");
      const response = await fetch(`/api/songs/${encodeURIComponent(song.id)}/lyrics`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ authorizedToTranscribe }),
      });
      const responseText = await response.text();
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        throw new Error(`The transcription service returned an unexpected response (HTTP ${response.status}).`);
      }

      let data: { lyrics?: string; error?: string; message?: string };
      try {
        data = JSON.parse(responseText) as typeof data;
      } catch {
        throw new Error("The transcription service returned invalid JSON. Check the API server logs and try again.");
      }
      if (!response.ok) throw new Error(data.message ?? data.error ?? "Could not transcribe this audio.");
      setRawLyrics(data.lyrics ?? "");
    } catch (error) {
      setTranscriptionError(error instanceof Error ? error.message : "Could not transcribe this audio.");
    } finally {
      setTranscribing(false);
    }
  };

  const parsedLyrics = useMemo<LyricLine[]>(() => {
    return parseLRC(rawLyrics);
  }, [rawLyrics]);

  const activeIndex = useMemo(() => {
    if (!parsedLyrics.length) return -1;
    return findCurrentLyricIndex(parsedLyrics, currentTime);
  }, [parsedLyrics, currentTime]);

  // Smooth scroll active line into middle of view
  useEffect(() => {
    if (activeLineRef.current && scrollContainerRef.current) {
      activeLineRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [activeIndex]);

  if (!isOpen || !song) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xl p-4 sm:p-6"
    >
      <div className="relative flex h-[90vh] max-h-[820px] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-[#181824] to-[#0d0d12] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-lime-300 text-black shadow-lg shadow-lime-300/20">
              <Mic2 className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black text-white">{song.title}</h2>
                <span className="flex items-center gap-1 rounded-full bg-lime-300/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-lime-300 border border-lime-300/20">
                  <Sparkles className="h-2.5 w-2.5" /> Synced Karaoke
                </span>
              </div>
              <p className="text-xs text-zinc-400">{song.artist}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full text-zinc-400 transition hover:bg-white/10 hover:text-white"
            aria-label="Close lyrics"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="grid flex-1 grid-cols-1 md:grid-cols-[280px_minmax(0,1fr)] overflow-hidden">
          {/* Left panel: Album Artwork & Status */}
          <div className="hidden flex-col items-center justify-center border-r border-white/[.07] bg-black/20 p-6 md:flex">
            <CoverArt art={song.cover} accent={song.accent} className="mb-6 aspect-square w-48 rounded-2xl shadow-2xl" />
            <p className="text-center font-bold text-white">{song.title}</p>
            <p className="text-center text-xs text-zinc-400 mb-4">{song.album}</p>
            <div className="rounded-xl border border-white/10 bg-white/[.04] p-3 text-center text-[11px] text-zinc-400">
              Click any line to jump directly to that timestamp
            </div>
          </div>

          {/* Right panel: Synced karaoke lyrics scroll area */}
          <div
            ref={scrollContainerRef}
            className="hide-scrollbar flex-1 overflow-y-auto px-6 py-12 sm:px-12"
          >
            {loading ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-zinc-400">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-lime-300 border-t-transparent" />
                <p className="text-sm">Loading synchronized lyrics…</p>
              </div>
            ) : parsedLyrics.length > 0 ? (
              <div className="space-y-6">
                {parsedLyrics.map((line, idx) => {
                  const isActive = idx === activeIndex;
                  const isPast = idx < activeIndex;
                  return (
                    <p
                      key={idx}
                      ref={isActive ? activeLineRef : null}
                      onClick={() => onSeek(line.time)}
                      className={cn(
                        "cursor-pointer transition-all duration-300 font-extrabold text-balance select-none",
                        isActive
                          ? "scale-105 text-3xl sm:text-4xl text-lime-300 drop-shadow-[0_0_24px_rgba(190,242,100,0.35)]"
                          : isPast
                          ? "text-xl sm:text-2xl text-zinc-400 hover:text-white"
                          : "text-xl sm:text-2xl text-zinc-600 hover:text-zinc-300"
                      )}
                    >
                      {line.text}
                    </p>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-zinc-400">
                <Music className="h-10 w-10 text-zinc-600" />
                <p className="text-lg font-bold text-white">Transcribe audio</p>
                <label className="mt-2 flex max-w-sm items-start gap-2 text-left text-xs text-zinc-400">
                  <input
                    type="checkbox"
                    checked={authorizedToTranscribe}
                    onChange={(event) => setAuthorizedToTranscribe(event.target.checked)}
                    disabled={transcribing}
                    className="mt-0.5 accent-lime-300"
                  />
                  I have permission to transcribe this audio.
                </label>
                <button
                  type="button"
                  onClick={() => void transcribeAudio()}
                  disabled={!authorizedToTranscribe || transcribing}
                  className="mt-2 inline-flex items-center gap-2 rounded-full bg-lime-300 px-4 py-2 text-sm font-bold text-black transition hover:bg-lime-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {transcribing && <Loader2 className="h-4 w-4 animate-spin" />}
                  {transcribing ? "Transcribing audio…" : "Transcribe my audio"}
                </button>
                {transcriptionError && <p role="alert" className="max-w-sm text-xs text-rose-300">{transcriptionError}</p>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
