import { router } from "./trpc";

import { healthRouter } from "./routes/health/route";
import { authRouter } from "./routes/auth/route";
import { investigationsRouter } from "./routes/investigations/route";
import { telemetryRouter } from "./routes/telemetry/route";

export const serverRouter = router({
  health: healthRouter,
  auth: authRouter,
  investigations: investigationsRouter,
  telemetry: telemetryRouter,
});

export const openApiRouter = serverRouter;

export { createContext } from "./context";
export type ServerRouter = typeof serverRouter;
