"use client";

import { useState } from "react";
import { Disc3, Heart, Music2, Sparkles, Waves, Radio, Zap, Flame, Headphones } from "lucide-react";
import { cn } from "@/lib/utils";

type CoverArtProps = {
  art?: string | null;
  accent?: string;
  className?: string;
  label?: string;
};

// Preset high-fidelity aesthetic visual styles for songs without custom uploaded covers
const PROCEDURAL_THEMES = [
  {
    bg: "from-fuchsia-600 via-purple-700 to-indigo-950",
    glow: "rgba(217, 70, 239, 0.45)",
    icon: Disc3,
    tag: "NEON",
  },
  {
    bg: "from-emerald-400 via-teal-600 to-slate-950",
    glow: "rgba(52, 211, 153, 0.45)",
    icon: Waves,
    tag: "WAVE",
  },
  {
    bg: "from-amber-400 via-rose-600 to-purple-950",
    glow: "rgba(251, 146, 60, 0.45)",
    icon: Flame,
    tag: "SUNSET",
  },
  {
    bg: "from-cyan-400 via-blue-600 to-slate-950",
    glow: "rgba(56, 189, 248, 0.45)",
    icon: Radio,
    tag: "CYBER",
  },
  {
    bg: "from-lime-300 via-emerald-600 to-zinc-950",
    glow: "rgba(190, 242, 100, 0.45)",
    icon: Zap,
    tag: "GROOVE",
  },
  {
    bg: "from-pink-500 via-rose-600 to-indigo-950",
    glow: "rgba(244, 63, 94, 0.45)",
    icon: Sparkles,
    tag: "VIBE",
  },
  {
    bg: "from-violet-500 via-indigo-600 to-slate-950",
    glow: "rgba(139, 92, 246, 0.45)",
    icon: Headphones,
    tag: "ECHO",
  },
  {
    bg: "from-sky-300 via-indigo-600 to-purple-950",
    glow: "rgba(125, 211, 252, 0.45)",
    icon: Music2,
    tag: "AUDIO",
  },
];

function stringHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function CoverArt({ art, accent, className, label }: CoverArtProps) {
  const [imgError, setImgError] = useState(false);

  // If a real image URL is present and hasn't errored out, render it
  if (art && (art.startsWith("http") || art.startsWith("/media")) && !imgError) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={art}
        alt={label ?? "Cover art"}
        className={cn("object-cover", className)}
        onError={() => setImgError(true)}
        loading="lazy"
      />
    );
  }

  // Playlist special covers
  if (art === "liked") {
    return (
      <div
        aria-label={label}
        className={cn(
          "grid place-items-center bg-gradient-to-br from-[#5539c7] via-[#7256e8] to-[#c1b4ff]",
          className
        )}
      >
        <Heart className="h-1/3 w-1/3 fill-white text-white" />
      </div>
    );
  }

  if (art && ["midnight", "focus", "discovery"].includes(art)) {
    return (
      <div
        aria-label={label}
        className={cn(
          "relative overflow-hidden bg-gradient-to-br",
          art === "midnight"
            ? "from-blue-900 via-violet-600 to-pink-500"
            : art === "focus"
            ? "from-emerald-600 via-teal-500 to-cyan-400"
            : "from-orange-400 via-pink-500 to-purple-700",
          className
        )}
      >
        <div className="absolute -bottom-1/4 -left-1/4 h-3/4 w-3/4 rounded-full bg-white/20 blur-xl" />
        <Sparkles className="absolute right-[18%] top-[16%] h-1/4 w-1/4 text-white/80" />
        <Music2 className="absolute bottom-[14%] left-[18%] h-1/2 w-1/2 text-white/90" />
      </div>
    );
  }

  // Keep the procedural fallback deterministic across SSR and hydration.
  // Use a normalized art/label key instead of dynamic values that can differ
  // between the server render and the hydrated client render.
  const visualKey = (art ?? label ?? "default")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "") || "default";
  const themeIndex = stringHash(visualKey) % PROCEDURAL_THEMES.length;
  const theme = PROCEDURAL_THEMES[themeIndex];
  const Icon = theme.icon;

  const gradientClass = accent || theme.bg;

  return (
    <div
      aria-label={label}
      className={cn(
        "relative isolate overflow-hidden select-none bg-gradient-to-br",
        gradientClass,
        className
      )}
    >
      {/* Vinyl record silhouette / concentric sound rings */}
      <div className="absolute -left-[20%] top-[15%] h-[80%] w-[75%] rotate-[28deg] rounded-[48%] border border-white/20 bg-black/25 shadow-[20px_12px_30px_rgba(0,0,0,.35)] backdrop-blur-[1px]" />
      <div className="absolute right-[9%] top-[9%] h-[42%] w-[42%] rounded-full border-[3px] border-white/30 bg-white/10 shadow-lg" />
      <div className="absolute right-[18%] top-[18%] h-[24%] w-[24%] rounded-full bg-black/70" />

      {/* Center glowing icon */}
      <Icon className="absolute bottom-[12%] right-[12%] h-[32%] w-[32%] text-white/85 drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]" />

      {/* Atmospheric lighting layers */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(circle at 75% 20%, ${theme.glow}, transparent 55%), linear-gradient(125deg, transparent 48%, rgba(255,255,255,0.14) 49%, transparent 54%)`,
        }}
      />
    </div>
  );
}
