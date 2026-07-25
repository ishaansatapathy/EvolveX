"use client";

import type { QueryClient } from "@tanstack/react-query";

type SignOutOptions = {
  logout: () => Promise<unknown>;
  resetAuth: () => void;
  queryClient: QueryClient;
};

/**
 * Clears the server session, drops all client query cache (stale auth.me was
 * keeping users "logged in" until a full refresh), then hard-navigates to
 * /signin so cookies and React state stay in sync.
 */
export async function signOutAndRedirect({ logout, resetAuth, queryClient }: SignOutOptions) {
  try {
    await logout();
  } catch {
    // Still evict client session if the API is unreachable — better logged-out
    // locally than stuck with a stale cached user.
  } finally {
    resetAuth();
    queryClient.clear();
    window.location.assign("/signin");
  }
}
