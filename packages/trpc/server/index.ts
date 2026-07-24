import { router } from "./trpc";

import { healthRouter } from "./routes/health/route";
import { authRouter } from "./routes/auth/route";
import { auditRouter } from "./routes/audit/route";
import { integrationsRouter } from "./routes/integrations/route";
import { investigationsRouter } from "./routes/investigations/route";
import { telemetryRouter } from "./routes/telemetry/route";

export const serverRouter = router({
  health: healthRouter,
  auth: authRouter,
  audit: auditRouter,
  integrations: integrationsRouter,
  investigations: investigationsRouter,
  telemetry: telemetryRouter,
});

export const openApiRouter = serverRouter;

export { createContext } from "./context";
export type ServerRouter = typeof serverRouter;
