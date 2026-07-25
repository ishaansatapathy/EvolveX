# SigNoz MCP Server — connecting AI clients to Evolvex's telemetry

Evolvex is an investigation layer on top of SigNoz. The [SigNoz MCP server](https://github.com/SigNoz/signoz-mcp-server)
(Model Context Protocol) lets Cursor, Claude, Codex, or any MCP client query the **exact same** traces,
logs, metrics, alerts, and dashboards Evolvex reads — in plain English, without leaving your editor.

This doc covers all three ways to connect it to the SigNoz instance Evolvex is wired to.

## Why this matters for Evolvex

Evolvex's investigation pipeline already queries SigNoz's Query API v5 programmatically
(`packages/services/signoz/client.ts`) to build timelines, pinpoint root cause, and correlate deploys.
The MCP server exposes that **same backend** conversationally — so during development or a demo you can
ask an agent things like:

> "Show me the p99 latency for `payments-svc` in the last hour."
> "List all active alerts."
> "Search error traces for the checkout flow from the last 30 minutes."

...and get answers sourced from the identical ClickHouse-backed Query Builder v5 engine that powers
Evolvex's `/investigations` UI — full-circle observability, not a separate integration.

## Option A — SigNoz Cloud hosted MCP (production, zero install)

Evolvex production points at SigNoz Cloud (`SIGNOZ_INGESTION_URL=https://ingest.in2.signoz.cloud`, region `in2`).
SigNoz Cloud hosts the MCP server for you — no binary, no Docker.

Add to `.cursor/mcp.json` (copy `.cursor/mcp.json.example` in this repo):

```json
{
  "mcpServers": {
    "signoz": {
      "url": "https://mcp.in2.signoz.cloud/mcp"
    }
  }
}
```

Match `in2` to your SigNoz Cloud region (Settings → Ingestion in the SigNoz UI). The client opens a
browser OAuth flow on first use and asks for your SigNoz instance URL + an API key
(Settings → API Keys, Admin role required).

## Option B — Self-hosted via Foundry (`casting.yaml`, hackathon reproducibility)

This repo's `casting.yaml` deploys the whole SigNoz stack with `foundryctl cast -f casting.yaml`
(see [README.md](../README.md)). The MCP molding is **enabled**:

```yaml
spec:
  mcp:
    spec:
      enabled: true
```

Re-running `foundryctl cast -f casting.yaml` adds a `signoz-mcp` container on port 8000, pointed at the
co-located SigNoz API automatically (`SIGNOZ_URL=http://signoz-signoz-0:8080`, `TRANSPORT_MODE=http`).
Nothing secret lives in `casting.yaml` — the API key stays on the client.

Verify it's up:

```bash
curl -fsS localhost:8000/livez && echo " OK"
```

Create a SigNoz API key (`http://localhost:8080` → Settings → API Keys → Admin role), then connect:

```json
{
  "mcpServers": {
    "signoz-local": {
      "url": "http://localhost:8000/mcp",
      "headers": {
        "SIGNOZ-API-KEY": "<your-api-key>"
      }
    }
  }
}
```

Verify the connection with `/mcp` in Claude Code or Cursor's MCP panel.

## Option C — Self-hosted binary (no Docker)

```bash
# macOS / Linux — download the release binary
curl -L https://github.com/SigNoz/signoz-mcp-server/releases/latest/download/signoz-mcp-server_linux_amd64.tar.gz | tar xz
```

Stdio mode (simplest, works with Claude Desktop / Cursor without running an HTTP server):

```json
{
  "mcpServers": {
    "signoz": {
      "command": "/absolute/path/to/signoz-mcp-server",
      "args": [],
      "env": {
        "SIGNOZ_URL": "https://your-signoz-instance.com",
        "SIGNOZ_API_KEY": "your-api-key-here",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

## `.cursor/mcp.json` setup for this repo

1. Copy the example: `cp .cursor/mcp.json.example .cursor/mcp.json`
2. Pick **one** server block (Cloud or local) and fill in your real API key.
3. `.cursor/mcp.json` is git-ignored — never commit real keys. Only `.cursor/mcp.json.example`
   (placeholders only) is tracked.
4. Restart Cursor / run `/mcp` to verify `signoz` shows as connected.

## Available tools (what the agent can actually do)

The server ships 30+ tools; the ones most relevant to Evolvex's investigation domain:

| Tool | Use during Evolvex development/demo |
|------|--------------------------------------|
| `signoz_list_services` | Confirm `evolvex-api` / `payments-svc` are emitting traces before a demo |
| `signoz_search_traces` / `signoz_get_trace_details` | Inspect the exact trace an Evolvex investigation cites |
| `signoz_aggregate_traces` | Compute p99/error-rate breakdowns Evolvex's pipeline also computes, for spot-checking |
| `signoz_search_logs` / `signoz_aggregate_logs` | Same log data Evolvex's timeline pulls via `signozClient.searchLogs` |
| `signoz_list_alert_rules` / `signoz_get_alert` | Inspect the alert rule that will fire the `/webhooks/signoz` webhook |
| `signoz_get_alert_history` | State-transition history — same data `scripts/signoz-postmortem-pack.ts` compiles (see below) |
| `signoz_create_alert` / `signoz_update_alert` | Author alert rules conversationally instead of clicking through the UI |
| `signoz_list_dashboards` / `signoz_create_dashboard` / `signoz_import_dashboard` | Spin up a service dashboard in seconds |
| `signoz_execute_builder_query` | Raw Query Builder v5 JSON for anything the dedicated tools can't express |

Full tool + resource reference: [SigNoz MCP Server docs](https://signoz.io/docs/ai/signoz-mcp-server/).

## Ops workflows Evolvex implements natively (MCP-equivalent, via SigNoz REST API)

The MCP server's `signoz_create_alert`, alert-history, and dashboard tools wrap SigNoz's public
`/api/v2/rules`, `/api/v1/channels`, and `/api/v1/dashboards` APIs. Evolvex ships the same capability as
Node scripts *and* first-class product UI — useful in CI, in the demo script, or anywhere a Go MCP binary
isn't available:

| Evolvex script | Mirrors MCP tool | What it does |
|----------------|------------------|--------------|
| `pnpm signoz:alert-setup` | `signoz_create_alert` | Verifies notification channels, then creates a p99-latency + an error-rate `threshold_rule` for the default service |
| `pnpm signoz:postmortem-pack` | `signoz_get_alert_history` + `signoz_search_traces`/`signoz_search_logs` | Compiles alert state history + top error/slow traces + sample logs into a markdown postmortem pack |
| `pnpm signoz:dashboard-setup` | `signoz_create_dashboard` | Creates a request-rate/error-rate/p99-latency dashboard for one service |

`signoz:alert-setup` / `signoz:postmortem-pack` use `packages/services/signoz/ops-api.ts`, which talks to
the same `/api/v2/rules` and `/api/v1/channels` endpoints the MCP server calls — same schema
(`schemaVersion: v2alpha1`, `threshold_rule`), same channel-verification-before-create safety check.
`signoz:dashboard-setup` uses `packages/services/signoz/dashboards-api.ts` against `/api/v1/dashboards`
(the same route Terraform's `signoz_dashboard` resource and `signoz_create_dashboard` use).

```bash
pnpm signoz:alert-setup -- --channel slack-oncall
pnpm signoz:postmortem-pack -- --service payments-svc --window 60
pnpm signoz:dashboard-setup -- --service payments-svc
```

See `--help` on either script for all flags. Output of the postmortem pack lands in
`postmortems/<timestamp>-<service>.md` (git-ignored — these are point-in-time artifacts, not source).

Dashboard creation is also one click in the product: open an investigation → **Export** menu →
**Create SigNoz dashboard**. It scopes the dashboard to the case's primary service, opens it in a new tab,
and logs a timeline entry + audit event — no terminal needed.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `signoz` shows disconnected in Cursor | Check `.cursor/mcp.json` exists (copied from `.example`) and the URL/key are correct |
| `401` from hosted MCP | Wrong region — match `mcp.<region>.signoz.cloud` to Settings → Ingestion |
| `curl localhost:8000/livez` fails | Re-run `foundryctl cast -f casting.yaml`; confirm `mcp.spec.enabled: true` in `casting.yaml` |
| `signoz_create_alert` / `pnpm signoz:alert-setup` rejects with "channel not found" | Create a notification channel first: SigNoz UI → Settings → Alerts → Notification Channels |
| Alert-rule tools return 404 | Self-hosted SigNoz must be v0.120.0+ (alert-rule CRUD) / v0.118.0+ (history) |
| `pnpm signoz:alert-setup` fails with `403 authz_forbidden` | Confirmed against SigNoz Cloud: listing channels/rules works with any API key role, but **creating** a rule requires an Editor or Admin key. Generate one in SigNoz → Settings → API Keys. |
| `pnpm signoz:dashboard-setup` / "Create SigNoz dashboard" fails with 403 | Same Editor+ key requirement as alert creation — creating dashboards needs Editor or Admin, not Viewer. |
