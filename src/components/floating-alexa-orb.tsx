"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Mic, MicOff, Volume2, Sparkles, X, ChevronRight, Waves } from "lucide-react";
import { usePlayer } from "@/components/player-provider";
import { type Song } from "@/lib/catalog";
import { cn } from "@/lib/utils";

interface FloatingAlexaOrbProps {
  catalogSongs?: Song[];
  onOpenFullNeon?: () => void;
}

export function FloatingAlexaOrb({ catalogSongs = [], onOpenFullNeon }: FloatingAlexaOrbProps) {
  const { current, playing, play, pause, next, previous } = usePlayer();
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const responseTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  }, []);

  const handleVoiceCommand = useCallback((cmd: string) => {
    const text = cmd.toLowerCase().trim();
    let reply = "";

    if (text.includes("pause") || text.includes("stop")) {
      pause();
      reply = "Paused music.";
    } else if (text.includes("play") || text.includes("resume")) {
      if (current) {
        play(current);
        reply = `Resuming ${current.title}.`;
      } else if (catalogSongs.length > 0) {
        play(catalogSongs[0]);
        reply = `Playing ${catalogSongs[0].title}.`;
      } else {
        reply = "No song available to play.";
      }
    } else if (text.includes("next") || text.includes("skip")) {
      next();
      reply = "Skipped to next song.";
    } else if (text.includes("previous") || text.includes("back")) {
      previous();
      reply = "Playing previous track.";
    } else if (text.includes("what is playing") || text.includes("which song")) {
      reply = current ? `Currently playing ${current.title} by ${current.artist}.` : "Nothing is playing right now.";
    } else {
      // Search by keyword in catalog
      const cleanQuery = text.replace(/play|search|song/gi, "").trim();
      const match = catalogSongs.find(
        (s) =>
          s.title.toLowerCase().includes(cleanQuery) ||
          s.artist.toLowerCase().includes(cleanQuery) ||
          s.genre.toLowerCase().includes(cleanQuery)
      );

      if (match) {
        play(match);
        reply = `Playing ${match.title} by ${match.artist}.`;
      } else {
        reply = `I heard: "${cmd}". Tap to open full Neon Agent.`;
      }
    }

    setAiResponse(reply);
    speak(reply);

    if (responseTimeoutRef.current) clearTimeout(responseTimeoutRef.current);
    responseTimeoutRef.current = setTimeout(() => {
      setAiResponse(null);
    }, 6000);
  }, [catalogSongs, current, next, pause, play, previous, speak]);

  const toggleListening = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognition = (window as any)?.SpeechRecognition ?? (window as any)?.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setAiResponse("Voice recognition is not supported in this browser.");
      return;
    }

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
      setIsListening(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = "en-IN";
      recognition.interimResults = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition.onresult = (e: any) => {
        const text = e.results[0]?.[0]?.transcript ?? "";
        if (text) {
          setTranscript(text);
          handleVoiceCommand(text);
        }
      };
      recognition.onend = () => {
        setIsListening(false);
        recognitionRef.current = null;
      };
      recognition.onerror = () => {
        setIsListening(false);
        recognitionRef.current = null;
      };

      recognition.start();
      recognitionRef.current = recognition;
      setIsListening(true);
      setIsExpanded(true);
      setTranscript("Listening...");
    } catch {
      setIsListening(false);
    }
  };

  useEffect(() => {
    return () => {
      if (responseTimeoutRef.current) clearTimeout(responseTimeoutRef.current);
      if (recognitionRef.current) recognitionRef.current.stop();
    };
  }, []);

  return (
    <aside aria-label="Neon AI floating assistant" className="fixed bottom-24 right-6 z-40 flex flex-col items-end gap-2 selection:bg-lime-400 selection:text-black">
      {/* Speech / Response Bubble */}
      {(isExpanded || aiResponse || isListening) && (
        <div className="relative mb-2 max-w-xs animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="rounded-2xl border border-lime-400/30 bg-[#0c0e10]/95 p-3.5 shadow-[0_0_30px_rgba(163,230,53,0.15)] backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-lime-400" />
                <span className="text-[11px] font-black uppercase tracking-wider text-lime-300">Neon Alexa AI</span>
              </div>
              <button
                type="button"
                aria-label="Close assistant panel"
                onClick={() => {
                  setIsExpanded(false);
                  setAiResponse(null);
                }}
                className="text-zinc-500 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mt-2 text-xs leading-relaxed text-zinc-200">
              {isListening ? (
                <div className="flex items-center gap-2 text-cyan-300">
                  <Waves className="h-4 w-4 animate-pulse" />
                  <span className="font-semibold">{transcript || "Listening for command..."}</span>
                </div>
              ) : aiResponse ? (
                <p className="text-lime-200">{aiResponse}</p>
              ) : (
                <div className="space-y-1">
                  <p className="font-medium text-white">Ask anything:</p>
                  <p className="text-[11px] text-zinc-400">&ldquo;Pause music&rdquo; · &ldquo;Play next&rdquo; · &ldquo;What is playing?&rdquo;</p>
                </div>
              )}
            </div>

            {onOpenFullNeon && (
              <button
                type="button"
                onClick={onOpenFullNeon}
                className="mt-3 flex w-full items-center justify-between rounded-lg bg-lime-400/10 px-2.5 py-1.5 text-[11px] font-bold text-lime-300 transition hover:bg-lime-400/20"
              >
                <span>Open Full Neon Takeover</span>
                <ChevronRight className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Floating Orb Button with Concentric Alexa Waves */}
      <div className="relative flex items-center justify-center">
        {/* Pulsing Alexa Rings */}
        {isListening && (
          <>
            <span className="absolute h-20 w-20 animate-ping rounded-full border border-cyan-400/40" />
            <span className="absolute h-16 w-16 animate-pulse rounded-full border-2 border-cyan-300/60" />
          </>
        )}
        {playing && !isListening && (
          <span className="absolute h-16 w-16 animate-pulse rounded-full border border-lime-400/30" />
        )}

        <button
          type="button"
          onClick={toggleListening}
          aria-label={isListening ? "Stop listening" : "Talk to Neon Alexa AI"}
          className={cn(
            "relative flex h-14 w-14 items-center justify-center rounded-full shadow-2xl transition-all duration-300 hover:scale-110 active:scale-95",
            isListening
              ? "bg-gradient-to-br from-cyan-400 via-sky-500 to-blue-600 shadow-[0_0_35px_rgba(34,211,238,0.6)]"
              : "bg-gradient-to-br from-lime-400 via-emerald-400 to-teal-500 shadow-[0_0_25px_rgba(163,230,53,0.4)]"
          )}
        >
          {isListening ? (
            <Mic className="h-6 w-6 text-black stroke-[2.5]" />
          ) : playing ? (
            <Volume2 className="h-6 w-6 text-black stroke-[2.5]" />
          ) : (
            <MicOff className="h-6 w-6 text-black/70 stroke-[2.5]" />
          )}

          {/* Online badge */}
          <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-black">
            <span className={cn("h-2 w-2 rounded-full", isListening ? "bg-cyan-400" : "bg-lime-400")} />
          </span>
        </button>
      </div>
    </aside>
  );
}
