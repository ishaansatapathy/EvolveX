"use client";

import { trpc } from "~/trpc/client";

export function useEvolvexUser() {
  return trpc.auth.me.useQuery({}, {
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}
