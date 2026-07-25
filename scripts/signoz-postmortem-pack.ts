import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

import { getAlertRuleHistory, listAlertRules } from "../packages/services/signoz/ops-api.ts";
import { signozClient } from "../packages/services/signoz/client.ts";
import { getDefaultServiceName, getSignozConfig } from "../packages/services/signoz-env.ts";
import type { SignozLogRow, SignozTraceRow } from "../packages/services/signoz/types.ts";

function parseArgs() {
  const args = process.argv.slice(2);
  let serviceName: string | undefined;
  let ruleId: string | undefined;
  let windowMinutes = 60;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--service" && args[i + 1]) {
      serviceName = args[++i];
    } else if (arg === "--rule" && args[i + 1]) {
      ruleId = args[++i];
    } else if (arg === "--window" && args[i + 1]) {
      windowMinutes = Number.parseInt(args[++i]!, 10);
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  return { serviceName, ruleId, windowMinutes };
}

function printUsage() {
  console.log(`Usage: pnpm signoz:postmortem-pack -- [options]

Compiles a markdown postmortem evidence pack for a service from live SigNoz
data: alert-rule state history (if --rule or a matching rule is found),
top error traces, top slow traces, and sample logs — the same evidence the
signoz_get_alert_history + signoz_search_traces/logs MCP tools surface.
Output: postmortems/<timestamp>-<service>.md (git-ignored).

Options:
  --service <name>   Service name (default: SIGNOZ_DEFAULT_SERVICE_NAME / payments-svc)
  --rule <id>        SigNoz alert rule UUID (skips auto-lookup by alert name)
  --window <minutes> Evidence window in minutes (default: 60)
  --help             Show this help
`);
}

function formatTrace(row: SignozTraceRow) {
  const durationMs = row.durationMs ? `${row.durationMs.toFixed(1)}ms` : "n/a";
  return `- \`${row.traceId ?? "unknown"}\` — ${row.name ?? "unnamed span"} — ${durationMs}${
    row.hasError ? " — **error**" : ""
  } (${row.timestamp ?? "n/a"})`;
}

function formatLog(row: SignozLogRow) {
  const body = (row.body ?? "").replace(/\s+/g, " ").slice(0, 200);
  return `- [${row.severityText ?? "?"}] ${row.timestamp ?? "n/a"} — ${body}`;
}

async function findRuleIdForService(serviceName: string): Promise<string | null> {
  try {
    const rules = await listAlertRules();
    const match = rules.find((rule) => {
      const r = rule as { id?: string; alert?: string };
      return typeof r.alert === "string" && r.alert.toLowerCase().includes(serviceName.toLowerCase());
    }) as { id?: string } | undefined;
    return match?.id ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const { serviceName, ruleId, windowMinutes } = parseArgs();
  const config = getSignozConfig();
  if (!config) {
    throw new Error("SIGNOZ_CLOUD_URL and SIGNOZ_API_KEY must be set (see .env.example).");
  }

  const service = serviceName ?? getDefaultServiceName();
  const endMs = Date.now();
  const startMs = endMs - windowMinutes * 60_000;

  console.log(`Compiling postmortem pack for "${service}" (last ${windowMinutes}m) …`);

  const resolvedRuleId = ruleId ?? (await findRuleIdForService(service));

  const [alertHistory, errorTraces, slowTraces, logs] = await Promise.all([
    resolvedRuleId
      ? getAlertRuleHistory(resolvedRuleId, { startMs, endMs, limit: 20 }).catch((err) => ({
          error: err instanceof Error ? err.message : String(err),
        }))
      : Promise.resolve(null),
    signozClient.searchErrorTraces({ serviceName: service, startMs, endMs, limit: 10 }).catch(() => []),
    signozClient.searchSlowTraces({ serviceName: service, startMs, endMs, limit: 10 }).catch(() => []),
    signozClient.searchLogs({ serviceName: service, startMs, endMs, limit: 20 }).catch(() => []),
  ]);

  const generatedAt = new Date(endMs).toISOString();
  const lines: string[] = [];

  lines.push(`# Postmortem evidence pack — ${service}`);
  lines.push("");
  lines.push(`Generated: ${generatedAt}`);
  lines.push(`Window: ${new Date(startMs).toISOString()} → ${new Date(endMs).toISOString()} (${windowMinutes}m)`);
  lines.push(`SigNoz instance: ${config.cloudUrl}`);
  lines.push("");

  lines.push("## Alert rule history");
  if (resolvedRuleId && alertHistory && !(alertHistory as { error?: string }).error) {
    lines.push(`Rule ID: \`${resolvedRuleId}\``);
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(alertHistory, null, 2));
    lines.push("```");
  } else if (resolvedRuleId) {
    lines.push(`Rule ID: \`${resolvedRuleId}\` — history lookup failed: ${(alertHistory as { error?: string })?.error}`);
  } else {
    lines.push(
      "No matching alert rule found automatically. Pass `--rule <id>` (see `pnpm signoz:alert-setup` or SigNoz → Alerts → Rule ID).",
    );
  }
  lines.push("");

  lines.push(`## Top error traces (${errorTraces.length})`);
  lines.push(...(errorTraces.length ? errorTraces.map(formatTrace) : ["_No error traces in this window._"]));
  lines.push("");

  lines.push(`## Top slow traces (${slowTraces.length})`);
  lines.push(...(slowTraces.length ? slowTraces.map(formatTrace) : ["_No slow traces above threshold in this window._"]));
  lines.push("");

  lines.push(`## Sample logs (${logs.length})`);
  lines.push(...(logs.length ? logs.map(formatLog) : ["_No logs matched in this window._"]));
  lines.push("");

  lines.push("## Next steps");
  lines.push("- Cross-reference with the matching Evolvex investigation: http://localhost:3000/investigations");
  lines.push(
    "- For a conversational version of this evidence pull, ask an MCP-connected agent (see docs/SIGNOZ-MCP.md): " +
      `"Compile a postmortem for ${service} covering the last ${windowMinutes} minutes."`,
  );
  lines.push("");

  const outDir = path.resolve(process.cwd(), "postmortems");
  fs.mkdirSync(outDir, { recursive: true });
  const fileName = `${new Date(endMs).toISOString().replace(/[:.]/g, "-")}-${service}.md`;
  const outPath = path.join(outDir, fileName);
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");

  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
