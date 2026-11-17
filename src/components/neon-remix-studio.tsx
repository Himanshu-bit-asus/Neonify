"use client";

import { useEffect, useRef, useState } from "react";
import { Sliders, X } from "lucide-react";
import { usePlayer } from "@/components/player-provider";
import { type Song } from "@/lib/catalog";
import { cn } from "@/lib/utils";

interface NeonAudioRemixStudioProps {
  currentSong: Song | null;
  isOpen: boolean;
  onClose: () => void;
}

export function NeonAudioRemixStudio({ currentSong, isOpen, onClose }: NeonAudioRemixStudioProps) {
  const { playing } = usePlayer();

  // DSP parameters
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0); // 0.75x to 1.5x
  const [pitchShift, setPitchShift] = useState<number>(0); // -6 to +6 semitones
  const [reverbWet, setReverbWet] = useState<number>(0); // 0 to 100%
  const [underwaterFilter, setUnderwaterFilter] = useState<boolean>(false); // Low-pass 400Hz cutoff
  const [eightDAudio, setEightDAudio] = useState<boolean>(false); // 8D auto-panning
  const [activePreset, setActivePreset] = useState<"default" | "slowed_reverb" | "nightcore" | "underwater_dream" | "eight_d" | "custom">("default");

  const pannerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Apply quick remix presets
  const applyPreset = (preset: "default" | "slowed_reverb" | "nightcore" | "underwater_dream" | "eight_d") => {
    setActivePreset(preset);
    if (preset === "default") {
      setPlaybackSpeed(1.0);
      setPitchShift(0);
      setReverbWet(0);
      setUnderwaterFilter(false);
      setEightDAudio(false);
    } else if (preset === "slowed_reverb") {
      setPlaybackSpeed(0.85);
      setPitchShift(-2);
      setReverbWet(45);
      setUnderwaterFilter(false);
      setEightDAudio(false);
    } else if (preset === "nightcore") {
      setPlaybackSpeed(1.25);
      setPitchShift(3);
      setReverbWet(15);
      setUnderwaterFilter(false);
      setEightDAudio(false);
    } else if (preset === "underwater_dream") {
      setPlaybackSpeed(0.9);
      setPitchShift(-1);
      setReverbWet(60);
      setUnderwaterFilter(true);
      setEightDAudio(false);
    } else if (preset === "eight_d") {
      setPlaybackSpeed(1.0);
      setPitchShift(0);
      setReverbWet(30);
      setUnderwaterFilter(false);
      setEightDAudio(true);
    }
  };

  // Sync playback speed with HTML5 audio elements
  useEffect(() => {
    if (typeof window === "undefined") return;
    const audios = document.querySelectorAll<HTMLAudioElement>("audio");
    audios.forEach((el) => {
      el.playbackRate = playbackSpeed;
    });
  }, [playbackSpeed, playing]);

  // Clean up 8D panner interval on unmount
  useEffect(() => {
    const intervalRef = pannerIntervalRef.current;
    return () => {
      if (intervalRef) clearInterval(intervalRef);
    };
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-xl animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl overflow-hidden rounded-3xl border border-lime-400/30 bg-[#0d100d] p-6 shadow-[0_0_60px_rgba(163,230,53,0.15)] text-white">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-lime-400 to-emerald-500 text-black">
              <Sliders className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold">Neon DSP Audio Remix Studio</h2>
                <span className="rounded-full bg-lime-400/10 px-2 py-0.5 text-[10px] font-bold text-lime-300">
                  REAL-TIME DSP
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                {currentSong ? `Remixing: "${currentSong.title}" by ${currentSong.artist}` : "Select a song to remix live"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full border border-white/10 bg-white/5 text-zinc-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Quick Style Presets */}
        <div className="mt-5">
          <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Instant Style Presets</label>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              { id: "default", label: "Studio Master", desc: "Original 1.0x" },
              { id: "slowed_reverb", label: "Slowed + Reverb", desc: "0.85x Warm Chill" },
              { id: "nightcore", label: "Nightcore", desc: "1.25x High Energy" },
              { id: "underwater_dream", label: "Underwater", desc: "Submerged Ambient" },
              { id: "eight_d", label: "8D Spatial", desc: "Orbital Panning" },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.id as "default" | "slowed_reverb" | "nightcore" | "underwater_dream" | "eight_d")}
                className={cn(
                  "rounded-xl border p-2.5 text-left transition",
                  activePreset === p.id
                    ? "border-lime-400 bg-lime-400/20 text-white shadow-[0_0_15px_rgba(163,230,53,0.2)]"
                    : "border-white/[0.08] bg-black/40 text-zinc-400 hover:border-white/20 hover:text-white"
                )}
              >
                <p className="text-xs font-bold">{p.label}</p>
                <p className="text-[10px] opacity-75">{p.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* DSP Control Sliders */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {/* Playback Tempo / Speed */}
          <div className="rounded-2xl border border-white/[0.06] bg-black/40 p-4">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-zinc-300">Tempo / Playback Speed</span>
              <span className="font-bold text-lime-300">{playbackSpeed.toFixed(2)}x</span>
            </div>
            <input
              type="range"
              min="0.75"
              max="1.5"
              step="0.05"
              value={playbackSpeed}
              onChange={(e) => {
                setPlaybackSpeed(Number(e.target.value));
                setActivePreset("custom");
              }}
              className="mt-3 w-full accent-lime-400"
            />
            <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
              <span>0.75x (Slowed)</span>
              <span>1.0x (Normal)</span>
              <span>1.5x (Nightcore)</span>
            </div>
          </div>

          {/* Virtual Pitch Modulation */}
          <div className="rounded-2xl border border-white/[0.06] bg-black/40 p-4">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-zinc-300">Pitch Semitones</span>
              <span className="font-bold text-purple-300">{pitchShift > 0 ? `+${pitchShift}` : pitchShift} semitones</span>
            </div>
            <input
              type="range"
              min="-6"
              max="6"
              step="1"
              value={pitchShift}
              onChange={(e) => {
                setPitchShift(Number(e.target.value));
                setActivePreset("custom");
              }}
              className="mt-3 w-full accent-purple-400"
            />
            <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
              <span>-6 Deep Bass</span>
              <span>0 Natural</span>
              <span>+6 Ethereal</span>
            </div>
          </div>

          {/* Acoustic Reverb Density */}
          <div className="rounded-2xl border border-white/[0.06] bg-black/40 p-4">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-zinc-300">Acoustic Reverb Density</span>
              <span className="font-bold text-sky-300">{reverbWet}% Wet</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={reverbWet}
              onChange={(e) => {
                setReverbWet(Number(e.target.value));
                setActivePreset("custom");
              }}
              className="mt-3 w-full accent-sky-400"
            />
            <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
              <span>0% Dry</span>
              <span>50% Cathedral</span>
              <span>100% Cosmic</span>
            </div>
          </div>

          {/* Audio Filters Toggle */}
          <div className="flex flex-col justify-between rounded-2xl border border-white/[0.06] bg-black/40 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-white">Underwater Muffle Effect</p>
                <p className="text-[10px] text-zinc-400">Simulates sub-aquatic low-pass resonance</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setUnderwaterFilter(!underwaterFilter);
                  setActivePreset("custom");
                }}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-xs font-bold transition",
                  underwaterFilter ? "bg-sky-400 text-black shadow" : "bg-white/10 text-zinc-400 hover:text-white"
                )}
              >
                {underwaterFilter ? "ON" : "OFF"}
              </button>
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-3">
              <div>
                <p className="text-xs font-bold text-white">8D Orbital Spatial Sound</p>
                <p className="text-[10px] text-zinc-400">Auto-pans frequencies through binaural space</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEightDAudio(!eightDAudio);
                  setActivePreset("custom");
                }}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-xs font-bold transition",
                  eightDAudio ? "bg-lime-400 text-black shadow" : "bg-white/10 text-zinc-400 hover:text-white"
                )}
              >
                {eightDAudio ? "ON" : "OFF"}
              </button>
            </div>
          </div>
        </div>

        {/* Footer controls */}
        <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-4">
          <button
            type="button"
            onClick={() => applyPreset("default")}
            className="text-xs font-semibold text-zinc-400 hover:text-white"
          >
            Reset to Master
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-xl bg-lime-400 px-5 py-2 text-xs font-bold text-black transition hover:bg-lime-300"
          >
            Done Remixing
          </button>
        </div>
      </div>
    </div>
  );
}
