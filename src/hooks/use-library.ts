"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApiToken } from "@/components/auth-provider";
import { api, type LibraryData } from "@/lib/api-client";

export function useLibrary() {
  const getApiToken = useApiToken();

  return useQuery<LibraryData, Error>({
    queryKey: ["library"],
    queryFn: async () => {
      const token = await getApiToken();
      if (!token) throw new Error("Not authenticated");
      return api.library(token);
    },
    staleTime: 60_000, // 1 minute
    gcTime: 5 * 60_000,
    retry: 2,
  });
}

export function useInvalidateLibrary() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["library"] });
    void queryClient.invalidateQueries({ queryKey: ["songs"] });
  };
}
