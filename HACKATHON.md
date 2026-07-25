# Evolvex × SigNoz — hackathon judging guide

Evolvex is not "a dashboard that reads SigNoz." It is an **investigation OS built directly on top of
SigNoz's data plane** — every signal Evolvex correlates (traces, logs, metrics, alerts, service maps,
eBPF) comes from SigNoz, live, with zero mock data anywhere in the product (see
[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — "zero-fake-data policy").

This doc is the single map from **every SigNoz capability** to **where Evolvex uses it**, for judges
short on time. For the live walkthrough script, see [DEMO.md](./DEMO.md).

## 1. SigNoz capability → Evolvex usage (the full map)

| SigNoz capability | Evolvex usage | Where |
|---|---|---|
| **OTLP ingestion (traces)** | `evolvex-api` self-instruments via OTel SDK; load generator emits realistic checkout-flow spans | `packages/services/signoz/register-otel.ts`, `otel-ingest.ts` |
| **OTLP ingestion (metrics)** | Runtime metrics (event loop, GC, heap, HTTP histograms) exported alongside traces | `register-otel.ts` — `PeriodicExportingMetricReader` |
| **OTLP ingestion (logs)** | Demo log batches + real API logs ingested for correlation | `otel-ingest.ts` (`ingestLogs`) |
| **Query API v5 (Query Builder)** | Every investigation timeline, error/slow-trace search, and log search hits `/api/v5/query_range` directly | `packages/services/signoz/client.ts` |
| **Service Map API** | Live dependency graph (cross-service RCA) — no synthetic edges | `packages/services/signoz/service-map.ts` |
| **Alerts + Alertmanager webhooks** | `POST /webhooks/signoz` triggers automatic investigation creation on every fired alert | `apps/api` webhook route → `InvestigationService.handleSignozWebhook` |
| **Alert-rule API (`/api/v2/rules`)** | Programmatic alert creation/history — `pnpm signoz:alert-setup`, `pnpm signoz:postmortem-pack` | `packages/services/signoz/ops-api.ts` |
| **Notification channels API** | Verified before alert creation (same safety check the SigNoz MCP server documents) | `ops-api.ts::listNotificationChannels` |
| **Service accounts / API keys** | `SIGNOZ_API_KEY` auth on every API call; `SIGNOZ_INGESTION_KEY` scoped separately for OTLP | `.env.example`, `signoz-env.ts` |
| **SigNoz MCP server** | Enabled in `casting.yaml`; `.cursor/mcp.json.example` wired for both self-host and SigNoz Cloud | [docs/SIGNOZ-MCP.md](./docs/SIGNOZ-MCP.md) |
| **Foundry (`casting.yaml`)** | One-command reproducible self-host for judges — the modern install path SigNoz recommends over the legacy install script | repo-root `casting.yaml` / `casting.yaml.lock` |
| **ClickHouse-backed percentiles (p50/p95/p99)** | Evolvex never computes percentiles itself — every p99 shown is SigNoz's own aggregation | `client.ts` (raw span rows only), `ops-api.ts` alert thresholds |
| **eBPF / OpenTelemetry eBPF Instrumentation (OBI)** | Kernel-level metrics bridged into investigations as first-class evidence | `docs/EBPF-OBI.md`, `docker-compose.obi.yml`, `scripts/obi-anomaly-bridge.ts` |
| **Webhooks as the alerting contract** | SigNoz is the *only* alert source of truth — Evolvex never polls or re-implements alerting | `/webhooks/signoz` |
| **Kubernetes / Helm** | `evolvex-agent` Helm chart ships a collector config generated per-org for K8s deployments | `helm/evolvex-agent/` |
| **Deep health probes against SigNoz** | `/health` verifies live SigNoz API connectivity, not just "key is set" | `packages/services/signoz/client.ts::testConnection` |
| **Self-observability / dogfooding** | Evolvex's own `Traces`/`Logs` pages show Evolvex's own production traffic, queried from SigNoz like any other service | `docs/adr/0007-self-observability-dogfooding.md` |

## 2. Reproducibility judges can actually run

```bash
# 1. Stand up SigNoz + MCP with one file, one command
foundryctl cast -f casting.yaml

# 2. Point Evolvex at it (.env)
SIGNOZ_CLOUD_URL=http://localhost:8080
SIGNOZ_API_KEY=<Settings → API Keys>
SIGNOZ_INGESTION_KEY=<Settings → Ingestion, optional>

# 3. Run Evolvex
pnpm install && pnpm dev
```

`casting.yaml` + `casting.yaml.lock` are config-as-code — a judge reruns the exact stack we tested against,
not "trust us, it works." MCP is turned on by default (`spec.mcp.spec.enabled: true`) so the same judge can
immediately query the instance conversationally without any extra setup.

## 3. The MCP loop: querying Evolvex's own telemetry conversationally

Connect `.cursor/mcp.json` (copy `.cursor/mcp.json.example`, see [docs/SIGNOZ-MCP.md](./docs/SIGNOZ-MCP.md)),
then, live, in front of judges:

```
"List services with trace activity in the last hour."
"What's the p99 latency for payments-svc?"
"Search error traces for checkout-api from the last 30 minutes."
"Show me the alert rules configured for this instance."
```

Every answer is sourced from the same ClickHouse-backed Query Builder v5 engine Evolvex's own
`/investigations` pipeline queries — full-circle proof that Evolvex isn't a separate system bolted onto
SigNoz, it's built *on* it.

## 4. Ops workflows normally reserved for the MCP server, implemented natively

The SigNoz MCP server's `signoz_create_alert` and `signoz_get_alert_history` tools wrap public SigNoz REST
endpoints (`/api/v2/rules`, `/api/v1/channels`). Evolvex ships the same workflows as first-class scripts —
useful anywhere a Go MCP binary isn't the right shape (CI, the demo script, org onboarding):

```bash
pnpm signoz:alert-setup -- --channel slack-oncall        # creates p99-latency + error-rate alert rules
pnpm signoz:postmortem-pack -- --service payments-svc     # alert history + evidence → markdown pack
```

See `packages/services/signoz/ops-api.ts` (unit-tested payload builder, no live SigNoz needed to verify
schema correctness) and [docs/SIGNOZ-MCP.md](./docs/SIGNOZ-MCP.md) for the tool-to-script mapping.

## 5. What we deliberately did **not** reimplement, and why

Consistent with the zero-fake-data policy, we'd rather say "we use SigNoz's version of this" than fake a
parallel implementation:

- **SigNoz UI dashboards/query builder** — used directly in the SigNoz web UI (`localhost:8080` or SigNoz
  Cloud) for ad-hoc exploration; Evolvex's own UI is for *investigations*, not a second dashboard builder.
  `signoz_import_dashboard` / `signoz_create_dashboard` via MCP cover judge-driven dashboard creation
  without Evolvex needing to re-implement the Query Builder.
- **`demo-lite` sample app** — Evolvex's own `evolvex-api` (self-instrumented, real business logic) plus
  `pnpm signoz:loadgen` / `signoz:p99` / `demo:incident` serve the same "generate realistic telemetry"
  purpose, against a real product instead of a toy service.
- **Docker Swarm / SELinux install guides** — legacy self-host paths from SigNoz's older install script.
  Foundry (`casting.yaml`) is SigNoz's own recommended replacement for that script, and it's what this repo
  standardizes on for reproducibility; Swarm/SELinux are alternate infra targets, not additional product
  surface, so we didn't fork the demo across them.

## 6. Everything else already shipped (the product itself)

The full 45-feature production build — deep health checks, Redis-backed rate limiting, hardened cookies,
distributed tracing, AI root-cause summaries, GitHub pinpoint, postmortem export, Kubernetes/eBPF ingestion,
and more — is enumerated live at `/settings` (Integration Health) and `Settings → Production Engineering`
in the running app, and walked through in [DEMO.md](./DEMO.md).

## Quick links

| Doc | Purpose |
|---|---|
| [DEMO.md](./DEMO.md) | 5-minute judge script |
| [docs/SIGNOZ-MCP.md](./docs/SIGNOZ-MCP.md) | MCP setup (Cloud / Foundry / binary) + tool reference |
| [docs/WIRING.md](./docs/WIRING.md) | Env var checklist to get to 80%+ integration health |
| [docs/EBPF-OBI.md](./docs/EBPF-OBI.md) | eBPF / OBI kernel-level signal setup |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Production design + zero-fake-data policy |
