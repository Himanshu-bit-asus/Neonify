export type PlanTier = "FREE" | "GOOD" | "PRO" | "GOD";

export type Song = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  genre: string;
  plays: string;
  liked?: boolean;
  added?: string;
  cover: string;
  accent: string;
  audioUrl?: string;
  isImported?: boolean;
  isExclusive?: boolean;
  tierRequired?: PlanTier;
};

export const songs: Song[] = [
  { id: "night-drive", title: "Night Drive", artist: "Nova Lane", album: "Afterglow", duration: 221, genre: "Electronic", plays: "2.4M", liked: true, cover: "orbital", accent: "from-indigo-700 via-violet-500 to-fuchsia-400" },
  { id: "golden-hour", title: "Golden Hour", artist: "Milo Rae", album: "Soft Focus", duration: 194, genre: "Indie Pop", plays: "1.8M", cover: "sunset", accent: "from-amber-300 via-orange-500 to-rose-500" },
  { id: "velvet-rope", title: "Velvet Rope", artist: "KIRA", album: "Nocturne", duration: 238, genre: "R&B", plays: "983K", liked: true, cover: "velvet", accent: "from-fuchsia-800 via-purple-800 to-slate-950", isExclusive: true, tierRequired: "GOOD" },
  { id: "glasshouse", title: "Glasshouse", artist: "The Wild Form", album: "Outside In", duration: 206, genre: "Alternative", plays: "726K", cover: "glass", accent: "from-sky-400 via-cyan-600 to-blue-950" },
  { id: "over-you", title: "Over You", artist: "Amara", album: "Blue Bloom", duration: 183, genre: "Pop", plays: "4.1M", liked: true, cover: "bloom", accent: "from-pink-300 via-rose-500 to-red-600" },
  { id: "westside", title: "Westside", artist: "Juno Park", album: "City / Sleep", duration: 212, genre: "Hip-Hop", plays: "1.2M", cover: "west", accent: "from-lime-300 via-emerald-500 to-green-950", isExclusive: true, tierRequired: "PRO" },
  { id: "slow-burn", title: "Slow Burn", artist: "Sage Wilder", album: "Room 29", duration: 257, genre: "Folk", plays: "548K", cover: "slow", accent: "from-orange-200 via-stone-500 to-stone-900" },
  { id: "meteor-shower", title: "Meteor Shower", artist: "coastline", album: "Pacific", duration: 228, genre: "Electronic", plays: "1.0M", cover: "meteor", accent: "from-cyan-300 via-indigo-700 to-slate-950", isExclusive: true, tierRequired: "GOD" },
  { id: "paper-planes", title: "Paper Planes", artist: "Hana Tsu", album: "Letters", duration: 201, genre: "Indie Pop", plays: "664K", cover: "paper", accent: "from-yellow-100 via-amber-300 to-orange-600" },
  { id: "blue-moon", title: "Blue Moon", artist: "Léon", album: "Ultraviolet", duration: 235, genre: "Jazz", plays: "390K", cover: "moon", accent: "from-blue-200 via-indigo-700 to-slate-950" },
];

export const playlists = [
  { id: "liked", title: "Liked Songs", subtitle: "48 songs", art: "liked" },
  { id: "midnight", title: "Midnight Mix", subtitle: "Nova Lane, KIRA, coastline", art: "midnight" },
  { id: "focus", title: "Focus Flow", subtitle: "Dreamy instrumentals", art: "focus" },
  { id: "discovery", title: "Discovery Weekly", subtitle: "Made for you", art: "discovery" },
];

export const genres = [
  ["Electronic", "from-[#116466] to-[#0b2527]"],
  ["Indie", "from-[#6d375f] to-[#30172b]"],
  ["Hip-Hop", "from-[#845c1d] to-[#312105]"],
  ["R&B", "from-[#4a3f87] to-[#211c46]"],
  ["Chill", "from-[#2d5f8f] to-[#102b46]"],
  ["Rock", "from-[#7a3030] to-[#330f11]"],
] as const;
