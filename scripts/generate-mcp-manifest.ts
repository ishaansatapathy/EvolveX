/**
 * Regenerates repo-root `mcp-server.json` from the single source of truth
 * (`AGENT_TOOLS` in packages/services/ai/agent-internals.ts) so the Thread
 * Agent and its documented MCP tool manifest never drift — enforced by
 * packages/services/ai/tool-parity.test.ts.
 *
 * Run after adding/removing/renaming a tool in agent-internals.ts:
 *   pnpm mcp:manifest
 */
import fs from "node:fs";
import path from "node:path";

import { AGENT_TOOLS } from "../packages/services/ai/agent-internals.ts";

const manifest = {
  name: "evolvex-thread-agent",
  description:
    "Evolvex Thread Agent — Gmail/Calendar assistant tools (Corsair-backed), exposed 1:1 with the OpenAI " +
    "tool-calling loop in packages/services/ai/agent.ts / agent-stream.ts. Generated file — do not hand-edit; " +
    "run `pnpm mcp:manifest` after changing packages/services/ai/agent-internals.ts.",
  generatedAt: new Date().toISOString(),
  tools: AGENT_TOOLS.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    inputSchema: tool.function.parameters,
  })),
};

const outPath = path.resolve(import.meta.dirname, "../mcp-server.json");
fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`Wrote ${outPath} (${manifest.tools.length} tools)`);
