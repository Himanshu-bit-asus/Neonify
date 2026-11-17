"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  Brain,
  Check,
  Compass,
  Cpu,
  Heart,
  Loader2,
  Mic,
  Music,
  Play,
  Radio,
  Search,
  Sparkles,
  Thermometer,
  Volume2,
  WandSparkles,
  Wind,
  X,
} from "lucide-react";
import { usePlayer } from "@/components/player-provider";
import { songs, type Song } from "@/lib/catalog";
import { cn } from "@/lib/utils";
import {
  analyzeStressSignals,
  findSongByText,
  findSongsByMood,
  findSongsForStressTherapy,
  parseNeonCommand,
  type StressAnalysis,
} from "@/lib/neon";
import { CoverArt } from "@/components/cover-art";
import { BiometricPulseScanner } from "@/components/biometric-pulse-scanner";
import { CyberpunkSphereVisualizer } from "@/components/cyberpunk-sphere-visualizer";
import { NeonAudioRemixStudio } from "@/components/neon-remix-studio";

type NeonMemory = {
  mood: string | null;
  lastSongId: string | null;
  lastIntent: string | null;
  lastAnalysis: StressAnalysis | null;
};

type NeonTask = {
  command: string;
  result: string;
  completedAt: string;
  success: boolean;
};

export function NeonBar({
  catalogSongs = songs,
}: {
  catalogSongs?: Song[];
  onNavigate?: (view: "home" | "search" | "library") => void;
}) {
  // Mode selection: "simple" (compact floating/card music control) vs "agent" (Full-screen takeover agent)
  const [mode, setMode] = useState<"simple" | "agent">("simple");

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [lastTask, setLastTask] = useState<NeonTask | null>(null);
  const [memory, setMemory] = useState<NeonMemory>({
    mood: null,
    lastSongId: null,
    lastIntent: null,
    lastAnalysis: null,
  });

  // Physiological / Stress AI inputs
  const [stressLevelSlider, setStressLevelSlider] = useState(55);
  const [heartRate, setHeartRate] = useState(86);
  const [bodyTempC, setBodyTempC] = useState(37.2);
  const [emotionInput, setEmotionInput] = useState<"calm" | "anxious" | "exhausted" | "overwhelmed" | "focused">("anxious");
  const [environment, setEnvironment] = useState("Noisy Office / Workstation");

  // Search results rendered inside Neon Agent Mode
  const [agentSearchResults, setAgentSearchResults] = useState<Song[]>([]);
  const [agentStatusText, setAgentStatusText] = useState<string>("Neon Agent is online and monitoring bio-acoustic signals.");

  // Remix Studio modal
  const [remixOpen, setRemixOpen] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  const {
    current,
    play,
    pause,
    next,
    previous,
    toggleLike,
    liked,
    startRadio,
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
  } = usePlayer();

  const speak = (text: string) => {
    if (typeof window === "undefined") return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 1.05;
    utterance.pitch = 1;
    synth.speak(utterance);
  };

  const executeStressTherapy = (signals?: {
    stressInput?: number;
    heartRate?: number;
    bodyTemp?: number;
    userEmotion?: string;
    environment?: string;
  }) => {
    setBusy(true);
    const analysis = analyzeStressSignals({
      stressInput: signals?.stressInput ?? stressLevelSlider,
      heartRate: signals?.heartRate ?? heartRate,
      bodyTemp: signals?.bodyTemp ?? bodyTempC,
      userEmotion: signals?.userEmotion ?? emotionInput,
      environment: signals?.environment ?? environment,
    });

    const therapeuticTracks = findSongsForStressTherapy(analysis, catalogSongs);
    const selectedSong = therapeuticTracks[0] ?? catalogSongs[0] ?? songs[0];

    // Auto-tune healing binaural frequencies according to stress severity
    if (analysis.stressLevel === "critical" || analysis.stressLevel === "high") {
      setBinauralPreset("theta"); // 432Hz - 438Hz theta wave for acute anxiety/stress release
      setBinauralVolume(0.22);
    } else if (analysis.tempState === "warm" || analysis.tempState === "feverish") {
      setBinauralPreset("432hz"); // 432Hz universal cellular cooling/harmonic relaxation
      setBinauralVolume(0.18);
    } else if (analysis.emotion === "exhausted") {
      setBinauralPreset("delta"); // 2Hz restorative sleep/recharge delta wave
      setBinauralVolume(0.18);
    } else {
      setBinauralPreset("528hz"); // 528Hz Solfeggio clarity & focus
      setBinauralVolume(0.15);
    }

    play(selectedSong);
    setMemory((prev) => ({
      ...prev,
      lastIntent: "stress_therapy",
      lastSongId: selectedSong.id,
      lastAnalysis: analysis,
    }));

    const responseMsg = `Stress level is ${analysis.stressLevel.toUpperCase()} (${analysis.stressScore}/100) with ${analysis.tempState} body temp. Queued relaxing ${analysis.recommendedGenre} track: "${selectedSong.title}". ${analysis.actionGuidance[0] || ""}`;
    setAgentStatusText(responseMsg);
    setLastTask({
      command: `Biometric Analysis (Heart: ${signals?.heartRate ?? heartRate}bpm, Temp: ${signals?.bodyTemp ?? bodyTempC}Â°C, Mood: ${signals?.userEmotion ?? emotionInput})`,
      result: responseMsg,
      completedAt: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
      success: true,
    });
    setBusy(false);
    speak(`Analyzing your body emotions and temperature. Playing a soothing track: ${selectedSong.title}.`);
  };

  const applyAction = (action: ReturnType<typeof parseNeonCommand>) => {
    let reply = "Iâ€™m ready for your next command.";

    switch (action.type) {
      case "pause":
        pause();
        reply = "Paused playback. Tell me when you're ready to continue.";
        break;
      case "resume":
        if (current) {
          play(current);
          reply = `Resuming ${current.title}.`;
        } else {
          const fallback = catalogSongs[0] ?? songs[0];
          play(fallback);
          reply = `Playing ${fallback.title}.`;
        }
        break;
      case "next_track":
        next();
        reply = "Skipped to the next track.";
        break;
      case "previous_track":
        previous();
        reply = "Returned to previous track.";
        break;
      case "like_song": {
        const target = current ?? catalogSongs[0] ?? songs[0];
        toggleLike(target.id);
        reply = liked.has(target.id) ? `${target.title} is in your likes.` : `Added ${target.title} to your library.`;
        setMemory((prev) => ({ ...prev, lastSongId: target.id, lastIntent: "like" }));
        break;
      }
      case "unlike_song": {
        const target = current ?? catalogSongs[0] ?? songs[0];
        toggleLike(target.id);
        reply = `Removed ${target.title} from likes.`;
        setMemory((prev) => ({ ...prev, lastSongId: target.id, lastIntent: "unlike" }));
        break;
      }
      case "play_song": {
        const target = findSongByText(action.title, catalogSongs);
        play(target);
        setMemory((prev) => ({ ...prev, lastSongId: target.id, lastIntent: "play" }));
        reply = `Found and playing "${target.title}" by ${target.artist}.`;
        setAgentSearchResults([target]);
        break;
      }
      case "play_similar": {
        const seed = current ?? catalogSongs[0] ?? songs[0];
        startRadio(seed);
        setMemory((prev) => ({ ...prev, lastSongId: seed.id, lastIntent: "radio" }));
        reply = `Started infinite smart radio seeded from "${seed.title}".`;
        break;
      }
      case "play_by_mood": {
        const matches = findSongsByMood(action.mood, catalogSongs);
        const target = matches[0] ?? catalogSongs[0] ?? songs[0];
        play(target);
        setMemory((prev) => ({ ...prev, mood: action.mood, lastSongId: target.id, lastIntent: "mood" }));
        reply = `I've calibrated a ${action.mood} acoustic vibe with "${target.title}".`;
        setAgentSearchResults(matches.slice(0, 4));
        break;
      }
      case "play_bio_stress": {
        executeStressTherapy({
          userEmotion: action.emotion,
          stressInput: action.stressLevel === "high" || action.stressLevel === "critical" ? 85 : 45,
          bodyTemp: action.tempC,
        });
        return;
      }
      case "search_songs": {
        const query = action.query.toLowerCase();
        const matches = catalogSongs.filter((s) => {
          const t = `${s.title} ${s.artist} ${s.genre} ${s.album}`.toLowerCase();
          return query.split(" ").some((w) => w.length > 2 && t.includes(w));
        });
        const target = matches[0] ?? findSongByText(action.query, catalogSongs);
        play(target);
        setAgentSearchResults(matches.length ? matches.slice(0, 6) : [target]);
        setMemory((prev) => ({ ...prev, lastSongId: target.id, lastIntent: "search" }));
        reply = `Search engine matched "${action.query}". Playing "${target.title}" by ${target.artist}.`;
        break;
      }
      case "what_is_playing":
        reply = current ? `Currently playing "${current.title}" by ${current.artist}.` : "No track is playing right now.";
        break;
      case "unknown":
        reply = action.message;
        break;
      default:
        reply = "Neon Agent is ready.";
        break;
    }

    setAgentStatusText(reply);
    if (typeof window !== "undefined" && "speechSynthesis" in window && reply) {
      speak(reply);
    }
    return reply;
  };

  useEffect(() => {
    if (!current) return;
    setMemory((prev) => ({ ...prev, lastSongId: current.id }));
  }, [current]);

  const runTask = (message: string) => {
    const trimmed = message.trim();
    if (!trimmed) return;

    setInput("");
    setBusy(true);

    const action = parseNeonCommand(trimmed);
    const response = applyAction(action);

    if (action.type !== "play_bio_stress") {
      setLastTask({
        command: trimmed,
        result: response ?? "Done",
        completedAt: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
        success: action.type !== "unknown",
      });
    }
    setBusy(false);
  };

  const startVoice = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognition = (window as any)?.SpeechRecognition ?? (window as any)?.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setLastTask({
        command: "Voice input",
        result: "SpeechRecognition API is not available in this browser. Please type your command.",
        completedAt: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
        success: false,
      });
      return;
    }

    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
      setListening(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-IN";
    recognition.interimResults = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      if (transcript.trim()) {
        setInput(transcript);
        runTask(transcript);
      }
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };
    recognition.start();
    recognitionRef.current = recognition;
    setListening(true);
  };

  // Quick prompt presets
  const quickPresets = [
    { label: "Lower my stress & anxiety", icon: Brain, action: () => executeStressTherapy({ userEmotion: "anxious", stressInput: 80, bodyTemp: 37.8 }) },
    { label: "High Body Temp (Relaxing cooling sound)", icon: Thermometer, action: () => executeStressTherapy({ bodyTemp: 38.2, stressInput: 75, userEmotion: "exhausted" }) },
    { label: "Noisy Office Calm Mode", icon: Wind, action: () => executeStressTherapy({ environment: "Noisy Office", stressInput: 65, userEmotion: "overwhelmed" }) },
    { label: "Play something chill", icon: Play, action: () => runTask("play something chill") },
    { label: "Search & play Bollywood / Punjabi", icon: Search, action: () => runTask("search Sanam Teri Kasam") },
    { label: "Start infinite radio", icon: Radio, action: () => runTask("start radio") },
  ];

  /* ------------------------------------------------------------- */

  /* ------------------------------------------------------------- */
  /* Render: Agent Mode â€” Amazon Music / Alexa Premium UI          */
  /* ------------------------------------------------------------- */
  if (mode === "agent") {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-[#07090a] text-white overflow-hidden animate-in fade-in duration-300">

        {/* Slim Top Nav */}
        <div className="relative z-10 flex items-center justify-between border-b border-white/[0.05] bg-black/70 px-6 py-3 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-lime-400 to-emerald-500 shadow-[0_0_20px_rgba(163,230,53,0.5)]">
              <Sparkles className="h-4 w-4 text-black stroke-[2.5]" />
              <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-lime-500" />
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-black tracking-widest text-white uppercase">Neon</span>
              <span className="rounded-full border border-lime-400/30 bg-lime-400/10 px-2 py-0.5 text-[9px] font-bold tracking-widest text-lime-300 uppercase">Agent Mode</span>
            </div>
          </div>

          <div className="flex items-center gap-6">
            {current && (
              <div className="hidden items-center gap-2.5 md:flex">
                <CoverArt art={current.cover} accent={current.accent} className="h-7 w-7 rounded-lg" />
                <div className="text-xs leading-none">
                  <p className="font-semibold text-white">{current.title}</p>
                  <p className="mt-0.5 text-zinc-500">{current.artist}</p>
                </div>
                <span className="ml-1 h-1.5 w-1.5 rounded-full bg-lime-400 shadow-[0_0_8px_rgba(163,230,53,0.9)] animate-pulse" />
              </div>
            )}
            <button
              type="button"
              onClick={() => setMode("simple")}
              className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-semibold text-zinc-300 transition hover:bg-white/10 hover:text-white"
            >
              <X className="h-3.5 w-3.5" /> Exit
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">

          {/* Hero â€” Alexa-style Orb + Voice + Search */}
          <div className="relative flex flex-col items-center px-6 py-10">
            {/* Ambient background glow */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
              <div className={cn(
                "h-[500px] w-[500px] rounded-full blur-[140px] transition-all duration-1000",
                listening ? "bg-cyan-500/15" : "bg-lime-500/8"
              )} />
            </div>

            {/* Concentric pulse rings */}
            <div className="relative mb-8 flex items-center justify-center">
              {[1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={cn(
                    "absolute rounded-full border transition-all duration-700",
                    listening ? "border-cyan-400/25 animate-ping" : "border-lime-400/[0.07]"
                  )}
                  style={{
                    width: `${96 + i * 52}px`,
                    height: `${96 + i * 52}px`,
                    animationDelay: `${i * 0.35}s`,
                    animationDuration: "1.6s",
                  }}
                />
              ))}
              <span className={cn(
                "absolute h-28 w-28 rounded-full border-2 transition-all duration-500",
                listening ? "border-cyan-400/50" : "border-lime-400/25"
              )} />

              {/* Core orb */}
              <button
                type="button"
                aria-label={listening ? "Stop listening" : "Speak to Neon"}
                onClick={startVoice}
                disabled={busy}
                className={cn(
                  "relative z-10 flex h-24 w-24 items-center justify-center rounded-full transition-all duration-300 hover:scale-105 disabled:opacity-60",
                  listening
                    ? "bg-gradient-to-br from-cyan-400 to-blue-500 shadow-[0_0_60px_rgba(34,211,238,0.6)]"
                    : "bg-gradient-to-br from-lime-400 via-emerald-400 to-cyan-500 shadow-[0_0_40px_rgba(163,230,53,0.4)]"
                )}
              >
                {busy
                  ? <Loader2 className="h-9 w-9 text-black animate-spin" />
                  : <Mic className="h-9 w-9 text-black stroke-[2]" />
                }
              </button>
            </div>

            {/* Status text */}
            <p className={cn(
              "max-w-lg text-center text-sm leading-relaxed transition-all duration-300",
              listening ? "font-semibold text-cyan-200" : "text-zinc-500"
            )}>
              {listening ? "ðŸŽ™ Listeningâ€¦ speak your command" : busy ? "Processingâ€¦" : agentStatusText}
            </p>

            {/* Search bar */}
            <form
              className="mt-6 flex w-full max-w-2xl items-center gap-3"
              onSubmit={(e) => { e.preventDefault(); runTask(input); }}
            >
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder='Try: "search Arijit Singh", "lower my stress", "play gym beats"â€¦'
                  className="h-13 w-full rounded-2xl border border-white/[0.07] bg-white/[0.04] py-3.5 pl-11 pr-4 text-sm text-white backdrop-blur-sm outline-none transition placeholder:text-zinc-600 focus:border-lime-400/40 focus:bg-white/[0.06] focus:ring-1 focus:ring-lime-400/15"
                />
              </div>
              <button
                type="submit"
                disabled={!input.trim() || busy}
                className="flex shrink-0 items-center gap-2 rounded-2xl bg-lime-400 px-5 py-3.5 text-sm font-black text-black transition hover:bg-lime-300 disabled:opacity-40"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cpu className="h-4 w-4" />}
                Ask
              </button>
            </form>

            {/* Quick preset chips */}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {quickPresets.map((preset) => {
                const Icon = preset.icon;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={preset.action}
                    className="flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.02] px-3.5 py-1.5 text-xs font-medium text-zinc-500 transition hover:border-lime-400/25 hover:bg-lime-400/[0.06] hover:text-white"
                  >
                    <Icon className="h-3.5 w-3.5 text-lime-400" />
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Content Grid */}
          <div className="mx-auto grid max-w-7xl gap-4 px-6 pb-10 lg:grid-cols-[1fr_380px]">

            {/* LEFT: Stress AI + Audio Controls */}
            <div className="space-y-3">

              {/* Stress AI Card */}
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-5 backdrop-blur-sm">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-500/10">
                      <Activity className="h-4 w-4 text-rose-400" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white">Stress AI & Biometric Radar</p>
                      <p className="text-[11px] text-zinc-600">Emotion Â· Heart Rate Â· Body Temp Â· Environment</p>
                    </div>
                  </div>
                  <span className="flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/[0.07] px-2.5 py-1 text-[10px] font-bold text-emerald-400">
                    <Brain className="h-3 w-3" /> LIVE
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {/* Stress Level */}
                  <div className="rounded-xl border border-white/[0.05] bg-black/30 p-3.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-zinc-400"><Brain className="h-3.5 w-3.5 text-purple-400" /> Stress Score</span>
                      <span className={cn("font-bold tabular-nums", stressLevelSlider > 70 ? "text-rose-400" : stressLevelSlider > 40 ? "text-amber-400" : "text-emerald-400")}>{stressLevelSlider}/100</span>
                    </div>
                    <input type="range" min="10" max="100" value={stressLevelSlider} onChange={(e) => setStressLevelSlider(Number(e.target.value))} className="mt-2.5 w-full accent-purple-400" />
                    <div className="mt-1 flex justify-between text-[10px] text-zinc-700"><span>Zen</span><span>Tense</span><span>Burnout</span></div>
                  </div>

                  {/* Heart Rate */}
                  <div className="rounded-xl border border-white/[0.05] bg-black/30 p-3.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-zinc-400"><Heart className="h-3.5 w-3.5 text-rose-400" /> Heart Rate</span>
                      <span className="font-bold tabular-nums text-rose-300">{heartRate} BPM</span>
                    </div>
                    <input type="range" min="55" max="140" value={heartRate} onChange={(e) => setHeartRate(Number(e.target.value))} className="mt-2.5 w-full accent-rose-400" />
                    <div className="mt-1 flex justify-between text-[10px] text-zinc-700"><span>60</span><span>90</span><span>120+</span></div>
                  </div>

                  {/* Biometric Scanner */}
                  <div className="sm:col-span-2">
                    <BiometricPulseScanner onBpmDetected={(detected) => { setHeartRate(detected); executeStressTherapy({ heartRate: detected }); }} />
                  </div>

                  {/* Body Temp */}
                  <div className="rounded-xl border border-white/[0.05] bg-black/30 p-3.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-zinc-400"><Thermometer className="h-3.5 w-3.5 text-amber-400" /> Body Temp</span>
                      <span className="font-bold tabular-nums text-amber-300">{bodyTempC.toFixed(1)}Â°C</span>
                    </div>
                    <input type="range" min="35.5" max="39.5" step="0.1" value={bodyTempC} onChange={(e) => setBodyTempC(Number(e.target.value))} className="mt-2.5 w-full accent-amber-400" />
                    <div className="mt-1 flex justify-between text-[10px] text-zinc-700"><span>36.0Â°</span><span>37.0Â°</span><span>38.5Â°+</span></div>
                  </div>

                  {/* Emotion */}
                  <div className="rounded-xl border border-white/[0.05] bg-black/30 p-3.5">
                    <label className="text-xs font-medium text-zinc-400">Emotion State</label>
                    <select
                      value={emotionInput}
                      onChange={(e) => setEmotionInput(e.target.value as typeof emotionInput)}
                      className="mt-2 w-full rounded-lg border border-white/[0.06] bg-black/50 px-3 py-2 text-xs text-white outline-none focus:border-lime-400/40"
                    >
                      <option value="anxious">Anxious / Overthinking</option>
                      <option value="exhausted">Exhausted / Low Energy</option>
                      <option value="overwhelmed">Overwhelmed / High Pressure</option>
                      <option value="focused">Productive / Flow State</option>
                      <option value="calm">Calm &amp; Centered</option>
                    </select>
                  </div>
                </div>

                {/* Environment */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-zinc-600">
                    <Compass className="h-3.5 w-3.5 text-lime-500" /> Environment:
                  </span>
                  {["Noisy Office / Workstation", "Late Night Bedroom", "Commute / Transit", "Study / Library"].map((env) => (
                    <button
                      key={env}
                      type="button"
                      onClick={() => setEnvironment(env)}
                      className={cn(
                        "rounded-full px-3 py-1 text-[11px] font-semibold transition",
                        environment === env ? "bg-lime-400 text-black" : "bg-white/[0.04] text-zinc-500 hover:bg-white/[0.08] hover:text-white"
                      )}
                    >
                      {env}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => executeStressTherapy()}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-lime-400 to-emerald-500 py-3 text-sm font-black text-black shadow-[0_0_30px_rgba(163,230,53,0.2)] transition hover:brightness-110"
                >
                  <Brain className="h-4 w-4" /> Calibrate &amp; Play Healing Track
                </button>
              </div>

              {/* Audio Controls Card */}
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-5 backdrop-blur-sm">
                <p className="mb-4 text-[10px] font-bold uppercase tracking-widest text-zinc-600">Audio Controls</p>

                {/* Binaural Generator */}
                <div className="mb-3 rounded-xl border border-lime-400/15 bg-lime-950/15 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-2 w-2 animate-pulse rounded-full bg-lime-400" />
                      <span className="text-xs font-bold text-white">Binaural Wave Generator</span>
                      <span className="rounded bg-lime-400/15 px-1.5 py-0.5 text-[10px] font-bold text-lime-400">432Hz / 528Hz</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-zinc-600">
                      Vol:
                      <input type="range" min="0.05" max="0.4" step="0.01" value={binauralVolume} onChange={(e) => setBinauralVolume(Number(e.target.value))} className="w-16 accent-lime-400" />
                      <span className="font-bold text-lime-400">{Math.round(binauralVolume * 100)}%</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-5 gap-1.5">
                    {[
                      { id: "off", label: "Off", desc: "None" },
                      { id: "432hz", label: "432 Hz", desc: "Calm" },
                      { id: "528hz", label: "528 Hz", desc: "Balance" },
                      { id: "theta", label: "Theta", desc: "Release" },
                      { id: "delta", label: "Delta", desc: "Sleep" },
                    ].map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setBinauralPreset(p.id as typeof binauralPreset)}
                        className={cn(
                          "rounded-xl border p-2 text-center text-xs transition",
                          binauralPreset === p.id
                            ? "border-lime-400 bg-lime-400/15 text-white"
                            : "border-white/[0.05] bg-black/30 text-zinc-600 hover:border-white/20 hover:text-white"
                        )}
                      >
                        <p className="font-bold">{p.label}</p>
                        <p className="text-[10px] opacity-75">{p.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Toggle rows */}
                <div className="space-y-2">
                  {/* DJ Neon */}
                  <div className="flex items-center justify-between rounded-xl border border-white/[0.05] bg-black/20 px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <Radio className="h-4 w-4 text-lime-400" />
                      <div>
                        <p className="text-xs font-semibold text-white">DJ Neon Radio Host</p>
                        <p className="text-[10px] text-zinc-600">Personalized track transitions &amp; intros</p>
                      </div>
                    </div>
                    <button type="button" onClick={() => setDjNeonEnabled(!djNeonEnabled)}
                      className={cn("min-w-[64px] rounded-lg px-3 py-1.5 text-[11px] font-bold transition", djNeonEnabled ? "bg-lime-400 text-black" : "bg-white/[0.05] text-zinc-500 hover:text-white")}>
                      {djNeonEnabled ? "ACTIVE" : "MUTED"}
                    </button>
                  </div>

                  {/* Karaoke */}
                  <div className="flex items-center justify-between rounded-xl border border-white/[0.05] bg-black/20 px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <Mic className="h-4 w-4 text-purple-400" />
                      <div>
                        <p className="text-xs font-semibold text-white">AI Karaoke Mode</p>
                        <p className="text-[10px] text-zinc-600">Vocal suppression for sing-along</p>
                      </div>
                    </div>
                    <button type="button" onClick={() => setKaraokeMode(!karaokeMode)}
                      className={cn("min-w-[64px] rounded-lg px-3 py-1.5 text-[11px] font-bold transition", karaokeMode ? "bg-purple-400 text-black shadow-[0_0_15px_rgba(192,132,252,0.4)]" : "bg-white/[0.05] text-zinc-500 hover:text-white")}>
                      {karaokeMode ? "ON" : "OFF"}
                    </button>
                  </div>

                  {/* EQ + Sleep */}
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.05] bg-black/20 px-4 py-3">
                    <div>
                      <p className="text-xs font-semibold text-white">DSP EQ &amp; Sleep Timer</p>
                      <p className="text-[10px] text-zinc-600">Auto-fade with harmonic EQ profiles</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <select value={soundPreset} onChange={(e) => setSoundPreset(e.target.value as typeof soundPreset)}
                        className="rounded-lg border border-white/[0.06] bg-black/50 px-2 py-1.5 text-xs font-bold text-lime-400 outline-none">
                        <option value="flat">Studio Flat</option>
                        <option value="bass_boost">Bass Boost</option>
                        <option value="vocal_boost">Vocal Clarity</option>
                        <option value="treble_boost">Air &amp; Treble</option>
                        <option value="night_mode">Night Somatic</option>
                      </select>
                      <div className="flex gap-1">
                        {[15, 30, 45, 60].map((m) => (
                          <button key={m} type="button" onClick={() => setSleepTimerMinutes(sleepTimer === m ? null : m)}
                            className={cn("rounded-md px-2 py-1 text-[11px] font-bold transition", sleepTimer === m ? "bg-amber-400 text-black" : "bg-white/[0.04] text-zinc-600 hover:text-white")}>
                            {m}m
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Loudness Normalization (EBU R128 Smart Leveller) */}
                  <div className="flex items-center justify-between rounded-xl border border-white/[0.05] bg-black/20 px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <Volume2 className="h-4 w-4 text-emerald-400" />
                      <div>
                        <p className="text-xs font-semibold text-white">Loudness Normalization</p>
                        <p className="text-[10px] text-zinc-600">Dynamic peak limiter &amp; studio leveling (EBU R128 / -24dB)</p>
                      </div>
                    </div>
                    <button type="button" onClick={() => setLoudnessNormalization(!loudnessNormalization)}
                      className={cn("min-w-[64px] rounded-lg px-3 py-1.5 text-[11px] font-bold transition", loudnessNormalization ? "bg-emerald-400 text-black shadow-[0_0_12px_rgba(52,211,153,0.3)]" : "bg-white/[0.05] text-zinc-500 hover:text-white")}>
                      {loudnessNormalization ? "ON" : "OFF"}
                    </button>
                  </div>

                  {/* Remix Studio */}
                  <div className="flex items-center justify-between rounded-xl border border-cyan-500/15 bg-cyan-950/10 px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <Music className="h-4 w-4 text-cyan-400" />
                      <div>
                        <p className="text-xs font-semibold text-white">Audio Remix Studio</p>
                        <p className="text-[10px] text-zinc-600">Slowed+Reverb Â· Nightcore Â· 8D Â· Pitch</p>
                      </div>
                    </div>
                    <button type="button" onClick={() => setRemixOpen(true)}
                      className="rounded-lg border border-cyan-500/25 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-bold text-cyan-400 transition hover:bg-cyan-500/20">
                      OPEN
                    </button>
                  </div>
                </div>
              </div>

              {/* Last Task */}
              {lastTask && (
                <div className={cn("rounded-2xl border p-4", lastTask.success ? "border-lime-400/15 bg-lime-950/15" : "border-amber-400/15 bg-amber-950/15")}>
                  <div className={cn("mb-1.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider", lastTask.success ? "text-lime-400" : "text-amber-400")}>
                    {lastTask.success ? <Check className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                    {lastTask.success ? "Task complete" : "Could not complete"}
                    <span className="ml-auto font-normal normal-case text-zinc-600">{lastTask.completedAt}</span>
                  </div>
                  <p className="text-sm font-semibold text-white">{lastTask.command}</p>
                  <p className="mt-1 text-xs text-zinc-500">{lastTask.result}</p>
                </div>
              )}
            </div>

            {/* RIGHT: Now Playing + Visualizer + Agent Matches */}
            <div className="space-y-4">

              {/* Now Playing */}
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-5 backdrop-blur-sm">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Now Streaming</span>
                  <div className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-lime-400 shadow-[0_0_6px_rgba(163,230,53,0.9)]" />
                    <Volume2 className="h-3.5 w-3.5 text-zinc-600" />
                  </div>
                </div>
                {current ? (
                  <div className="flex items-center gap-3">
                    <CoverArt art={current.cover} accent={current.accent} className="h-16 w-16 rounded-xl shadow-lg" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-black text-white">{current.title}</p>
                      <p className="truncate text-sm text-zinc-500">{current.artist}</p>
                      <span className="mt-1 inline-block rounded-md bg-lime-400/10 px-2 py-0.5 text-[10px] font-bold text-lime-400">{current.genre}</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.03]">
                      <Volume2 className="h-5 w-5 text-zinc-700" />
                    </div>
                    <p className="text-xs text-zinc-600">Agent ready â€” speak a command to stream.</p>
                  </div>
                )}
              </div>

              {/* 3D Visualizer */}
              <CyberpunkSphereVisualizer />

              {/* Agent Diagnostics */}
              <div className="rounded-2xl border border-lime-400/15 bg-lime-950/15 p-4">
                <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-lime-400">
                  <Cpu className="h-3.5 w-3.5" /> Agent Diagnostics
                </div>
                <p className="text-xs leading-relaxed text-zinc-500">{agentStatusText}</p>
                {memory.lastAnalysis && (
                  <div className="mt-3 space-y-1 border-t border-lime-400/15 pt-3">
                    <p className="text-[11px] font-bold text-lime-300">Guidance:</p>
                    {memory.lastAnalysis.actionGuidance.map((g, i) => (
                      <p key={i} className="text-[11px] text-zinc-600">â€¢ {g}</p>
                    ))}
                    <p className="mt-1 text-[11px] font-semibold text-lime-400/70">Soundscape: {memory.lastAnalysis.environmentRecommendation}</p>
                  </div>
                )}
              </div>

              {/* Agent Search Matches */}
              {agentSearchResults.length > 0 && (
                <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4">
                  <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-zinc-600">Agent Matches</p>
                  <div className="space-y-1">
                    {agentSearchResults.map((song) => (
                      <button
                        key={song.id}
                        type="button"
                        onClick={() => play(song)}
                        className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition hover:bg-white/[0.05]"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-white">{song.title}</p>
                          <p className="truncate text-xs text-zinc-600">{song.artist}</p>
                        </div>
                        <Play className="ml-3 h-3.5 w-3.5 shrink-0 text-lime-400" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Remix Studio Modal */}
        <NeonAudioRemixStudio currentSong={current} isOpen={remixOpen} onClose={() => setRemixOpen(false)} />
      </div>
    );
  }

  /* ------------------------------------------------------------- */
  /* Render: Simple Mode â€” Amazon Music / Alexa Compact UI         */
  /* ------------------------------------------------------------- */
  return (
    <section className="mx-auto max-w-4xl">

      {/* Header */}
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-lime-400 shadow-[0_0_8px_rgba(163,230,53,0.8)]" />
            <p className="text-[11px] font-bold uppercase tracking-[.22em] text-lime-400">Music Assistant</p>
          </div>
          <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">
            Hey, I&apos;m{" "}
            <span className="bg-gradient-to-r from-lime-400 to-emerald-400 bg-clip-text text-transparent">Neon.</span>
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            Speak a command, search any song, or switch to Agent Mode for full AI control.
          </p>
        </div>

        {/* Mode Switcher */}
        <div className="flex items-center gap-1 rounded-2xl border border-white/[0.06] bg-black/50 p-1.5 backdrop-blur-sm">
          <button
            type="button"
            onClick={() => setMode("simple")}
            className={cn("rounded-xl px-4 py-2 text-xs font-bold transition", mode === "simple" ? "bg-white/10 text-white shadow" : "text-zinc-600 hover:text-white")}
          >
            Simple
          </button>
          <button
            type="button"
            onClick={() => setMode("agent")}
            className="flex items-center gap-1.5 rounded-xl bg-lime-400/10 px-4 py-2 text-xs font-bold text-lime-400 transition hover:bg-lime-400/20"
          >
            <Sparkles className="h-3.5 w-3.5" /> Agent Mode
          </button>
        </div>
      </div>

      {/* Main 2-col layout */}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">

        {/* Left: Orb + Input */}
        <div className="rounded-2xl border border-white/[0.06] bg-black/40 p-6 backdrop-blur-sm">

          {/* Orb */}
          <div className="mb-6 flex flex-col items-center">
            <div className="relative mb-5 flex items-center justify-center">
              {[1, 2].map((i) => (
                <span
                  key={i}
                  className={cn("absolute rounded-full border transition-all duration-700",
                    listening ? "border-cyan-400/20 animate-ping" : "border-lime-400/[0.07]"
                  )}
                  style={{ width: `${80 + i * 44}px`, height: `${80 + i * 44}px`, animationDelay: `${i * 0.4}s`, animationDuration: "2s" }}
                />
              ))}
              <span className={cn("absolute h-24 w-24 rounded-full border-2 transition-all duration-500", listening ? "border-cyan-400/40" : "border-lime-400/20")} />

              <button
                type="button"
                aria-label={listening ? "Stop" : "Speak to Neon"}
                onClick={startVoice}
                disabled={busy}
                className={cn(
                  "relative z-10 flex h-20 w-20 items-center justify-center rounded-full transition-all duration-300 hover:scale-105 disabled:opacity-60",
                  listening
                    ? "bg-gradient-to-br from-cyan-400 to-blue-500 shadow-[0_0_50px_rgba(34,211,238,0.5)]"
                    : "bg-gradient-to-br from-lime-400 to-emerald-500 shadow-[0_0_30px_rgba(163,230,53,0.3)]"
                )}
              >
                {busy ? <Loader2 className="h-8 w-8 text-black animate-spin" /> : <Mic className="h-8 w-8 text-black stroke-[2]" />}
              </button>
            </div>

            <p className="text-sm font-semibold text-white">
              {listening ? "ðŸŽ™ Listeningâ€¦" : busy ? "Working on itâ€¦" : "Tap to speak"}
            </p>
            <p className="mt-1 text-xs text-zinc-600">
              {listening ? "Speak your command clearly" : "Or type a command below"}
            </p>
          </div>

          {/* Text input */}
          <form
            className="flex gap-2"
            onSubmit={(e) => { e.preventDefault(); runTask(input); }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Search a song, artist, mood, or commandâ€¦"
              aria-label="Task for Neon"
              className="h-12 min-w-0 flex-1 rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 text-sm text-white outline-none placeholder:text-zinc-700 focus:border-lime-400/40 focus:bg-white/[0.06] transition"
            />
            <button
              type="submit"
              disabled={!input.trim() || busy}
              className="flex h-12 items-center gap-2 rounded-xl bg-lime-400 px-5 text-sm font-black text-black transition hover:bg-lime-300 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
            </button>
          </form>

          {/* Quick preset chips */}
          <div className="mt-4 flex flex-wrap gap-2">
            {quickPresets.slice(0, 4).map(({ label, icon: Icon, action }) => (
              <button
                key={label}
                type="button"
                onClick={action}
                className="flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-xs text-zinc-500 transition hover:border-lime-400/25 hover:bg-lime-400/[0.06] hover:text-white"
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-lime-400" />
                <span className="max-w-[160px] truncate">{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Right: Now Playing + Quick Tasks */}
        <div className="flex flex-col gap-4">

          {/* Now Playing */}
          <div className="rounded-2xl border border-white/[0.06] bg-black/40 p-5 backdrop-blur-sm">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[.2em] text-zinc-600">Now Playing</span>
              {current && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-lime-400 shadow-[0_0_6px_rgba(163,230,53,0.8)]" />}
            </div>
            {current ? (
              <div className="flex items-center gap-3">
                <CoverArt art={current.cover} accent={current.accent} className="h-14 w-14 rounded-xl shadow-md" label={`${current.title} cover art`} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-white">{current.title}</p>
                  <p className="truncate text-xs text-zinc-500">{current.artist}</p>
                  <span className="mt-1 inline-block rounded-md bg-lime-400/10 px-1.5 py-0.5 text-[10px] font-bold text-lime-400">{current.genre}</span>
                </div>
              </div>
            ) : (
              <p className="py-5 text-center text-xs text-zinc-700">Nothing playing yet â€” give Neon a command!</p>
            )}
          </div>

          {/* Quick Tasks */}
          <div className="rounded-2xl border border-white/[0.06] bg-black/40 p-5 backdrop-blur-sm">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-[.2em] text-zinc-600">Quick Tasks</p>
            <div className="space-y-1.5">
              {quickPresets.slice(0, 4).map(({ label, icon: Icon, action }) => (
                <button
                  key={label}
                  type="button"
                  onClick={action}
                  className="flex w-full items-center gap-3 rounded-xl border border-white/[0.04] bg-white/[0.02] px-3 py-2.5 text-left text-xs font-semibold text-zinc-400 transition hover:border-lime-400/20 hover:bg-lime-400/[0.05] hover:text-white"
                >
                  <Icon className="h-4 w-4 shrink-0 text-lime-400" />
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Last Task Response */}
      {lastTask && (
        <div className={cn("mt-4 rounded-2xl border p-4", lastTask.success ? "border-lime-400/15 bg-lime-950/15" : "border-amber-400/15 bg-amber-950/15")}>
          <div className={cn("mb-1.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider", lastTask.success ? "text-lime-400" : "text-amber-400")}>
            {lastTask.success ? <Check className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
            {lastTask.success ? "Done" : "Couldn't complete"}
            <span className="ml-auto font-normal normal-case text-zinc-600">{lastTask.completedAt}</span>
          </div>
          <p className="text-sm font-semibold text-white">{lastTask.command}</p>
          <p className="mt-1 text-xs text-zinc-500">{lastTask.result}</p>
        </div>
      )}

      {/* Remix Studio Modal */}
      <NeonAudioRemixStudio currentSong={current} isOpen={remixOpen} onClose={() => setRemixOpen(false)} />
    </section>
  );
}
