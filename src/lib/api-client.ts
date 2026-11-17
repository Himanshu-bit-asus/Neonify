// API client with typed responses for TanStack Query
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api").replace(/\/$/, "");

export interface ApiSong {
  id: string;
  title: string;
  artistName: string;
  artist?: string;
  album?: string;
  genre: string;
  durationSeconds: number;
  coverArtUrl: string | null;
  coverArtKey?: string | null;
  playCount: string;
  likeCount?: number;
  status?: "PROCESSING" | "READY" | "FAILED";
  isPublished?: boolean;
  isExclusive?: boolean;
  tierRequired?: string;
}

export interface LibraryData {
  recommended: ApiSong[];
  likedSongs: ApiSong[];
  recentSongs: (ApiSong & { playedAt: string })[];
  trending: ApiSong[];
  playlists?: Array<{
    id: string;
    name: string;
    description: string | null;
    coverUrl: string | null;
    isMix: boolean;
    _count?: { songs: number };
  }>;
  recommendedStrategy?: string;
}

export interface SongsPage {
  data: ApiSong[];
  nextCursor: string | null;
}

async function apiFetch<T>(path: string, token?: string | null, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText })) as { message?: string };
    throw new Error(err.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  library: (token: string) =>
    apiFetch<LibraryData>("/me/library", token),

  likeSong: (songId: string, token: string) =>
    apiFetch<{ liked: true }>(`/songs/${encodeURIComponent(songId)}/like`, token, { method: "PUT" }),

  unlikeSong: (songId: string, token: string) =>
    apiFetch<{ liked: false }>(`/songs/${encodeURIComponent(songId)}/like`, token, { method: "DELETE" }),

  songs: (params: { q?: string; genre?: string; page?: number } = {}, token?: string) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.genre) qs.set("genre", params.genre);
    return apiFetch<SongsPage>(`/songs?${qs}`, token);
  },

  song: (id: string, token?: string) =>
    apiFetch<ApiSong & { status: string; isPublished: boolean }>(`/songs/${id}`, token),

  stream: (id: string, token: string, bitrate: "160" | "320" = "320") =>
    apiFetch<{ streamUrl: string; duration: number }>(`/songs/${id}/stream`, token, {
      headers: { "x-bitrate": bitrate },
    }),

  creatorSongs: (token: string) =>
    apiFetch<{ data: (ApiSong & { status: string; isPublished: boolean; createdAt: string })[] }>(
      "/creator/songs", token
    ),

  uploadUrl: (token: string, body: {
    title: string; artistName: string; album?: string; genre: string;
    tags: string[]; contentType: string; ext: string;
  }) =>
    apiFetch<{ songId: string; path: string; signedUrl: string; expiresIn: number }>(
      "/songs/upload-url", token, { method: "POST", body: JSON.stringify(body) }
    ),

  completeSong: (token: string, songId: string) =>
    apiFetch<{ songId: string; status: string; queued: boolean }>(
      `/songs/${songId}/complete`, token, { method: "POST" }
    ),

  listenEvent: (token: string, body: { songId: string; durationPlayed: number; completed: boolean }) =>
    apiFetch<{ accepted: boolean }>("/events/listen", token, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

export { API_URL };
