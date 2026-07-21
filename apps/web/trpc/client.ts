import { createTRPCReact } from "@trpc/react-query";
import type { ServerRouter } from "@repo/trpc/client";

export const trpc = createTRPCReact<ServerRouter>();
