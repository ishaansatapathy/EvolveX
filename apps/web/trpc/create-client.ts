import { httpLink } from "@trpc/client";

const TRPC_URL = process.env.NEXT_PUBLIC_API_URL ?? "/trpc";

export const createTRPCHttpBatchClientClient = () =>
  httpLink({
    url: TRPC_URL,
    fetch(url, options) {
      const timeoutSignal = AbortSignal.timeout(90_000);
      const signal =
        options?.signal && typeof AbortSignal.any === "function"
          ? AbortSignal.any([options.signal, timeoutSignal])
          : timeoutSignal;

      const headers = new Headers(options?.headers);
      headers.set("Accept-Encoding", "identity");
      if (options?.method && options.method !== "GET" && options.method !== "HEAD") {
        headers.set("x-evolvex-csrf", "1");
      }

      return fetch(url, {
        ...options,
        headers,
        credentials: "include",
        signal,
      });
    },
  });
