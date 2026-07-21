import { router } from "./trpc";

import { healthRouter } from "./routes/health/route";
import { authRouter } from "./routes/auth/route";
import { investigationsRouter } from "./routes/investigations/route";

export const serverRouter = router({
  health: healthRouter,
  auth: authRouter,
  investigations: investigationsRouter,
});

export const openApiRouter = serverRouter;

export { createContext } from "./context";
export type ServerRouter = typeof serverRouter;
