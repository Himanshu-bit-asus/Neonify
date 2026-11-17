"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

interface UseSongsParams {
  q?: string;
  genre?: string;
  enabled?: boolean;
}

export function useSongs(params: UseSongsParams = {}) {
  return useQuery({
    queryKey: ["songs", params],
    queryFn: () => api.songs(params),
    staleTime: 30_000,
    enabled: params.enabled !== false,
    retry: 2,
  });
}

export function useSongStatus(songId: string | null) {
  return useQuery({
    queryKey: ["song", songId],
    queryFn: () => api.song(songId!),
    enabled: !!songId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "READY" || status === "FAILED") return false;
      return 2000; // poll every 2s while processing
    },
    staleTime: 0,
  });
}

export function useInvalidateSongs() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["songs"] });
    void queryClient.invalidateQueries({ queryKey: ["library"] });
  };
}
