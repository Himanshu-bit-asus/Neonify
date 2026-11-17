import { songs, type Song } from "./catalog.ts";

export type NeonAction =
  | { type: "play_song"; title: string; artist?: string }
  | { type: "play_similar" }
  | { type: "play_by_mood"; mood: string }
  | { type: "play_bio_stress"; stressLevel: "low" | "medium" | "high" | "critical"; emotion: string; tempC?: number; environment?: string }
  | { type: "play_playlist"; name: string }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "next_track" }
  | { type: "previous_track" }
  | { type: "seek"; position: string }
  | { type: "set_volume"; level: number }
  | { type: "like_song" }
  | { type: "unlike_song" }
  | { type: "create_playlist"; name: string }
  | { type: "search_songs"; query: string }
  | { type: "what_is_playing" }
  | { type: "unknown"; message: string };

export type StressAnalysis = {
  stressScore: number; // 0 - 100
  stressLevel: "low" | "medium" | "high" | "critical";
  emotion: "calm" | "anxious" | "exhausted" | "angry" | "overwhelmed" | "focused" | "neutral";
  tempState: "normal" | "warm" | "feverish" | "chilly";
  environmentRecommendation: string;
  recommendedGenre: string;
  actionGuidance: string[];
};

const moodMap: Record<string, string[]> = {
  chill: ["chill", "lofi", "lo-fi", "ambient", "focus", "study", "rainy", "relax", "sleep", "soothing", "peaceful", "calm"],
  workout: ["workout", "gym", "energy", "upbeat", "dance", "run", "pump", "power"],
  party: ["party", "night", "dance", "club", "late-night", "after-hours", "groove"],
  sad: ["sad", "melancholy", "cry", "down", "slow", "heartbreak"],
  happy: ["happy", "sunny", "bright", "uplift", "joy", "cheerful"],
  romantic: ["romantic", "love", "soft", "dreamy", "affection"],
  relax: ["relax", "stress", "tense", "anxiety", "deep sleep", "meditation", "calm down", "breathe"],
};

const normalize = (value: string) => value.toLowerCase().trim();

export function analyzeStressSignals(signals: {
  heartRate?: number;
  bodyTemp?: number; // in Celsius (e.g. 36.5 - 38.5)
  stressInput?: number; // 0 - 100 slider
  userEmotion?: string; // e.g. "stressed", "anxious", "exhausted", "calm"
  environment?: string; // "noisy office", "study room", "late night bedroom", "outdoors"
}): StressAnalysis {
  let score = signals.stressInput ?? 40;

  // Physiological modulation: elevated heart rate
  if (signals.heartRate) {
    if (signals.heartRate > 105) score = Math.max(score, 85);
    else if (signals.heartRate > 88) score = Math.max(score, 65);
    else if (signals.heartRate < 68) score = Math.min(score, 30);
  }

  // Physiological modulation: body temp
  let tempState: StressAnalysis["tempState"] = "normal";
  if (signals.bodyTemp) {
    if (signals.bodyTemp >= 38.0) {
      tempState = "feverish";
      score = Math.min(100, score + 15);
    } else if (signals.bodyTemp >= 37.3) {
      tempState = "warm";
      score = Math.min(100, score + 8);
    } else if (signals.bodyTemp < 35.8) {
      tempState = "chilly";
    }
  }

  // Emotional signal parsing
  const em = (signals.userEmotion ?? "").toLowerCase();
  let detectedEmotion: StressAnalysis["emotion"] = "neutral";
  if (/anxi|panic|worry|freak|nervous/.test(em)) {
    detectedEmotion = "anxious";
    score = Math.max(score, 75);
  } else if (/tired|exhaust|burnout|drained|fatigue/.test(em)) {
    detectedEmotion = "exhausted";
    score = Math.max(score, 60);
  } else if (/anger|angry|frustrat|rage|irritat/.test(em)) {
    detectedEmotion = "angry";
    score = Math.max(score, 80);
  } else if (/overwhelm|pressure|deadline|chaos/.test(em)) {
    detectedEmotion = "overwhelmed";
    score = Math.max(score, 85);
  } else if (/focus|work|study|code/.test(em)) {
    detectedEmotion = "focused";
    score = Math.min(score, 35);
  } else if (/calm|peace|chill|good|happy/.test(em)) {
    detectedEmotion = "calm";
    score = Math.min(score, 20);
  }

  let stressLevel: StressAnalysis["stressLevel"] = "low";
  if (score >= 80) stressLevel = "critical";
  else if (score >= 60) stressLevel = "high";
  else if (score >= 35) stressLevel = "medium";

  // Environmental context
  const env = (signals.environment ?? "room").toLowerCase();
  let envRec = "Neutral acoustic setting";
  if (env.includes("office") || env.includes("noise") || env.includes("loud")) {
    envRec = "Apply 432Hz binaural masking to filter high-frequency environmental noise.";
  } else if (env.includes("bed") || env.includes("night") || env.includes("sleep")) {
    envRec = "Soft ambient acoustic frequencies below 60 BPM with slow decay.";
  } else if (env.includes("out") || env.includes("commute") || env.includes("traffic")) {
    envRec = "Stabilizing steady-beat soundscape to ground somatic agitation.";
  }

  // Guidance steps based on stress AI
  const guidance: string[] = [];
  if (stressLevel === "critical" || stressLevel === "high") {
    guidance.push("Inhale for 4s, hold for 4s, exhale slowly for 6s (Box Breathing).");
    if (tempState === "warm" || tempState === "feverish") {
      guidance.push("Body temperature is elevated — drink cold water and unclamp jaw tension.");
    }
    guidance.push("Lower volume to 45% and listen to slow melodic ambient / lo-fi frequencies.");
  } else if (stressLevel === "medium") {
    guidance.push("Take 3 deep shoulder drops and look away from screen for 60 seconds.");
    guidance.push("Transitioning to gentle acoustic indie / downtempo flow.");
  } else {
    guidance.push("Vitals in optimal resonance zone. Sustaining positive flow state.");
  }

  const recommendedGenre = stressLevel === "critical" || stressLevel === "high"
    ? "Ambient"
    : stressLevel === "medium"
    ? "Folk"
    : "Indie Pop";

  return {
    stressScore: Math.round(score),
    stressLevel,
    emotion: detectedEmotion,
    tempState,
    environmentRecommendation: envRec,
    recommendedGenre,
    actionGuidance: guidance,
  };
}

export function findSongByText(query: string, songCatalog: Song[] = songs) {
  const normalized = normalize(query).replace(/\b(song|track|play|that|this|it)\b/g, "").trim();
  if (!normalized) return songCatalog[0] ?? songs[0];

  const match = songCatalog.find((song) => {
    const haystacks = [song.title, song.artist, song.genre, song.album].map((value) => normalize(value));
    return haystacks.some((value) => value.includes(normalized));
  });

  return match ?? songCatalog.find((song) => normalize(song.title).includes(normalized.split(" ")[0])) ?? songCatalog[0] ?? songs[0];
}

export function findSongsByMood(mood: string, songCatalog: Song[] = songs) {
  const normalizedMood = normalize(mood);
  const keywords = moodMap[normalizedMood] ?? [normalizedMood];

  const scored = songCatalog
    .map((song) => {
      const haystack = [song.title, song.artist, song.genre, song.album].join(" ").toLowerCase();
      const score = keywords.reduce((total, keyword) => total + (haystack.includes(keyword) ? 2 : 0), 0);
      return { song, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ song }) => song);

  return scored.length ? scored : songCatalog.filter((song) => song.genre.toLowerCase().includes(normalizedMood));
}

export function findSongsForStressTherapy(analysis: StressAnalysis, songCatalog: Song[] = songs): Song[] {
  // If high or critical stress, strictly pick slow, peaceful, ambient or acoustic tracks
  if (analysis.stressLevel === "critical" || analysis.stressLevel === "high") {
    const relaxing = songCatalog.filter((s) => {
      const g = (s.genre || "").toLowerCase();
      const t = (s.title || "").toLowerCase();
      return g.includes("folk") || g.includes("ambient") || g.includes("chill") || g.includes("jazz") || t.includes("slow") || t.includes("moon") || t.includes("rain") || t.includes("mehram");
    });
    return relaxing.length > 0 ? relaxing : songCatalog.slice(0, 3);
  }

  // Medium stress: mellow indie/electronic
  if (analysis.stressLevel === "medium") {
    const mellow = songCatalog.filter((s) => {
      const g = (s.genre || "").toLowerCase();
      return g.includes("indie") || g.includes("pop") || g.includes("electronic") || g.includes("folk");
    });
    return mellow.length > 0 ? mellow : songCatalog.slice(0, 3);
  }

  // Low stress: whatever energizes or sustains calm
  return songCatalog;
}

export function parseNeonCommand(input: string): NeonAction {
  const text = input.trim();
  if (!text) {
    return { type: "unknown", message: "Ask me to search, play songs, or scan your stress and emotion." };
  }

  const cleaned = normalize(text)
    .replace(/^(?:hey|hi|ok|okay)\s+(?:neon|assistant|alexa)\s*,?\s*/, "")
    .replace(/^(?:neon|assistant|alexa)\s*,?\s*/, "");
  const normalized = cleaned || normalize(text);

  if (/(pause|stop)/.test(normalized)) return { type: "pause" };
  if (/(resume|continue|play again)/.test(normalized)) return { type: "resume" };
  if (/(next|skip)/.test(normalized)) return { type: "next_track" };
  if (/(previous|back)/.test(normalized)) return { type: "previous_track" };
  if (/(what\s+is\s+playing|what\s+song\s+is\s+this|what\s+am\s+i\s+listening\s+to|what's\s+playing|what\s+is\s+this\s+song)/.test(normalized)) return { type: "what_is_playing" };

  // Stress & Emotion Bio-Signals command recognition
  if (/(stress|anxious|anxiety|headache|temp|temperature|fever|exhausted|burnout|heart rate|calm me|relax me|body emotion)/i.test(normalized)) {
    const isCritical = /(very stressed|high stress|panic|burnout|fever|angry|racing heart)/i.test(normalized);
    const isMedium = /(medium|little stressed|tired|exhausted|work tension)/i.test(normalized);
    const level: "critical" | "high" | "medium" | "low" = isCritical ? "high" : isMedium ? "medium" : "low";
    return {
      type: "play_bio_stress",
      stressLevel: level,
      emotion: normalized,
      tempC: normalized.includes("hot") || normalized.includes("fever") ? 38.0 : undefined,
    };
  }

  if (/(^play\s+something\s+like\s+this|more\s+like\s+this|something\s+similar|start\s+radio|radio\s+(?:for\s+)?me|play\s+radio)/.test(normalized)) return { type: "play_similar" };
  if (/(unlike|remove like|dislike)/.test(normalized)) return { type: "unlike_song" };
  if (/(like\s+(?:this|that)|love\s+this|save\s+this|like\s+the\s+current|like\s+this\s+song|like\s+song|like\s+it)/.test(normalized)) return { type: "like_song" };

  const playlistMatch = /(?:make|create|build)\s+(?:me\s+)?(?:a\s+)?([a-z0-9\s-]+?)\s+(?:playlist|mix)/i.exec(text)
    ?? /(?:playlist|mix)\s+(?:called|named)\s+([a-z0-9\s-]+)/i.exec(text);
  if (playlistMatch || /(?:make|create|build)\s+.*(?:playlist|mix)/i.test(normalized)) {
    const nameMatch = playlistMatch?.[1] ?? "Neon Mix";
    const title = nameMatch.charAt(0).toUpperCase() + nameMatch.slice(1).trim();
    return { type: "create_playlist", name: title.endsWith("Mix") || title.endsWith("Playlist") ? title : `${title} Mix` };
  }

  const mood = Object.keys(moodMap).find((key) => normalized.includes(key) || moodMap[key].some((keyword) => normalized.includes(keyword)));
  if (mood) {
    return { type: "play_by_mood", mood };
  }

  if (/(search|find|google|look up)/.test(normalized)) {
    const query = normalized.replace(/^(search|find|google|look up)\s+(?:for\s+)?/i, "").trim();
    return { type: "search_songs", query: query || "top tracks" };
  }

  const songByArtistMatch = normalized.match(/^(?:play|start)\s+(?:a\s+)?(?:song|track|music)?\s+(?:by|from)\s+(.+)/i)
    ?? normalized.match(/^(?:play|start)\s+(?:a\s+)?(?:song|track|music)\s+(.+)/i);

  if (songByArtistMatch) {
    const candidate = songByArtistMatch[1].replace(/^(?:that|this|it|song|track)\s+/i, "").trim();
    if (candidate) {
      return { type: "play_song", title: candidate };
    }
  }

  const playMatch = normalized.match(/^play\s+(?:something\s+)?(?:for\s+)?(.+)/i)
    ?? normalized.match(/^start\s+(?:something\s+)?(?:for\s+)?(.+)/i);

  if (playMatch) {
    const candidate = playMatch[1].replace(/^(?:that|this|it|song|track)\s+/i, "").trim();
    if (!candidate) {
      return { type: "play_similar" };
    }
    return { type: "play_song", title: candidate };
  }

  // Any other direct phrase in Agent mode acts like an intelligent search & play query!
  if (text.length > 2) {
    return { type: "search_songs", query: text };
  }

  return { type: "unknown", message: "Tell Neon what you want to hear or scan your stress level." };
}
