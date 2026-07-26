# Evolvex — Production Investigation OS

> **Policy: zero fake data in production.** Every timeline entry, metric, eBPF signal, and deploy event must originate from a real source (SigNoz API, webhook, or OpenTelemetry ingestion). Development-only fallbacks are gated by `NODE_ENV !== 'production'`.

## What Evolvex Is

Evolvex is the **investigation layer** on top of observability. SigNoz (and OpenTelemetry) are the **telemetry source**. PostgreSQL is the **investigation database** — the place where alerts, traces, logs, deploys, K8s events, feature-flag toggles, CI/CD stages, and kernel signals are correlated into a single incident context, isolated **per organization/workspace**.

```
┌───────┐ ┌────────┐ ┌───────────┐ ┌─────────┐ ┌──────────────┐ ┌──────────┐
│SigNoz │ │ GitHub │ │Kubernetes │ │eBPF Agent│ │Feature Flags │ │ CI / CD  │
│alerts/│ │ push/  │ │ events    │ │(Hubble/  │ │(LaunchDarkly/│ │(Actions/ │
│traces │ │ deploy │ │           │ │ Pixie/OBI│ │ Flagsmith)   │ │ Circle)  │
└───┬───┘ └───┬────┘ └─────┬─────┘ └────┬─────┘ └──────┬───────┘ └────┬─────┘
    │         │            │            │              │              │
    ▼         ▼            ▼            ▼              ▼              ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                      Evolvex API (Express + tRPC + REST)                   │
│ /webhooks/signoz  /webhooks/github     /webhooks/kubernetes                │
│ /webhooks/ebpf    /webhooks/feature-flags   /webhooks/cicd                 │
│ /webhooks/plugins /api/v1/sdk          /telemetry-intelligence             │
│ /integrations/slack (OAuth)            /openapi.json  /health  /health/deep│
│                                                                              │
│  Multi-tenant resolution: org-scoped vault (organization_integrations)     │
│  → indexed secret_hash lookup (webhooks) or per-workspace API keys (SigNoz,│
│  GitHub, Slack, PagerDuty, Jira) → env-var fallback for single-tenant/dev  │
└───────────────────────────────────────┬────────────────────────────────────┘
                                         │
                                         ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                    PostgreSQL — Investigation Database                     │
│ organizations · organization_members · organization_integrations (vault)  │
│ investigations · investigation_timeline_entries · evidence                │
│ change_events · runtime_signals · services · service_dependencies         │
│ investigation_notes · investigation_summaries · investigation_pipeline_cache│
│ audit_events · telemetry_sampling_policies · plugin_installations         │
└───────────────────────────────────────┬────────────────────────────────────┘
                                         │
                                         ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                          React UI (Next.js)                                │
│ Investigations · Service Map · Logs · Traces · Dashboards                 │
│ Settings (Connect integrations, Signal webhooks, Plugins,                 │
│           Production Engineering, Integration Health)                     │
└────────────────────────────────────────────────────────────────────────────┘
```

## Multi-Tenancy Model

Every workspace is an `organizations` row. Members join via `organization_members` (owner/admin/member RBAC).
Two isolation mechanisms, matched to the integration type (see [ADR-0005](./adr/0005-org-integration-vault.md)):

| Integration type | Isolation mechanism |
|---|---|
| SigNoz API, GitHub, Slack, PagerDuty, Jira (per-workspace API key/token) | AES-256-GCM encrypted secret in `organization_integrations`, resolved by `organizationId` |
| SigNoz alerts, Kubernetes, eBPF, feature-flag, CI/CD (shared-secret webhooks) | Per-workspace secret + indexed `secret_hash` (SHA-256) column — an inbound webhook resolves its owning org in O(1) without decrypting every row. Rotation keeps `previous_secret_hash` valid for 24h so in-flight agents/CI runners never hard-fail mid-rotation. SigNoz uses Basic-auth password as the secret |
| Legacy/dev/single-tenant | Global `*_WEBHOOK_SECRET` / `INVESTIGATION_OWNER_EMAIL` — only used when a workspace hasn't connected via Settings |

Resolution order everywhere is **workspace vault → environment fallback**, never the reverse — a connected
workspace's own secret always wins.

## Data Sources (Real Only)

| Source | Ingestion | Stored As |
|--------|-----------|-----------|
| SigNoz alerts | `POST /webhooks/signoz` | Investigation + ALERT timeline |
| SigNoz traces/logs | SigNoz Query API v5 | TRACE/LOG timeline + runtime_signals |
| SigNoz metrics (incl. eBPF-derived) | SigNoz Query API v5 | METRIC/EBPF timeline |
| SigNoz alert rules/channels/dashboards | SigNoz REST API v1/v2 | Created via `ops-api.ts` / `dashboards-api.ts`, not stored locally |
| GitHub push | `POST /webhooks/github` | DEPLOY + change_events (commit) |
| Kubernetes | `POST /webhooks/kubernetes` | CHANGE + change_events (kubernetes) |
| eBPF agent | `POST /webhooks/ebpf` | EBPF timeline + evidence |
| Feature flags | `POST /webhooks/feature-flags` | CHANGE timeline + change_events (feature_flag) |
| CI/CD pipeline | `POST /webhooks/cicd` | DEPLOY/CHANGE timeline + change_events (cicd) |
| Custom plugins | `POST /webhooks/plugins` | CHANGE timeline, scoped to the installing plugin |
| Evolvex SDK | `POST /api/v1/sdk/*` | Server-side custom events, Bearer-authenticated |

## Investigation Pipeline

1. **Alert ingested** — SigNoz webhook creates `investigations` row with incident window.
2. **Evidence enrichment** — async pipeline queries SigNoz for slow/error traces, logs, and kernel/network metrics; results cached in `investigation_pipeline_cache` (fingerprint + pipeline version, 24h TTL — see [ADR-0004](./adr/0004-investigation-pipeline-cache.md)).
3. **Change correlation** — GitHub/K8s/feature-flag/CI-CD webhooks attach deploy/change events to open investigations within the incident time window.
4. **Service graph** — built from SigNoz service map API + trace-derived dependencies (never hardcoded).
5. **LLM summary** — OpenAI generates markdown from the assembled evidence package only — never calls SigNoz/GitHub directly (see [ADR-0003](./adr/0003-evidence-first-ai.md)) — stored in `investigation_summaries`.
6. **Actions** — from any investigation: create a Jira issue, page on-call via PagerDuty, post to Slack, or one-click **create a SigNoz dashboard** (`POST /api/v1/dashboards`) scoped to the case's service — each action logs a timeline entry + `audit_events` row.

## API Surfaces

| Surface | Purpose |
|---|---|
| `/trpc/*` | Primary RPC contract consumed by the Next.js web app (React Query) |
| `/api/*` | The same tRPC procedures exposed as plain REST (`trpc-to-openapi`) for external clients/CI |
| `/openapi.json` | Generated OpenAPI 3 document for the `/api` surface — path params must match input schema keys exactly, or generation throws (regression-tested in `apps/api/src/openapi-document.test.ts`) |
| `/health` | Liveness — DB ping only, used by Railway |
| `/health/deep` | Dependency-aware health (SigNoz, Redis, OpenAI, DB pool) — used by `pnpm deploy:smoke` and Settings → Production Engineering |
| `/webhooks/*` | Inbound events from external systems (see table above) |
| `/integrations/slack/*` | Slack "Add to Slack" OAuth authorize/callback |

## Environment Requirements (Production)

```bash
# Required
DATABASE_URL=
JWT_SECRET=
JWT_REFRESH_SECRET=
SIGNOZ_CLOUD_URL=
SIGNOZ_API_KEY=
GITHUB_WEBHOOK_SECRET=
OPENAI_API_KEY=

# Multi-tenant vault encryption (falls back to JWT_SECRET in dev only)
INTEGRATION_SECRETS_KEY=

# Preferred SigNoz alert routing: Settings → Connect SigNoz → Generate webhook credentials
# (per-workspace Basic-auth password, indexed secret_hash lookup — see ADR-005).
# These two remain single-tenant/dev fallbacks only:
# INVESTIGATION_OWNER_EMAIL=
# SIGNOZ_WEBHOOK_SECRET=

# Single-tenant/dev fallback secrets — a connected workspace's own vault secret
# always takes priority over these (see Multi-Tenancy Model above)
KUBERNETES_WEBHOOK_SECRET=
EBPF_WEBHOOK_SECRET=
FEATURE_FLAG_WEBHOOK_SECRET=
CICD_WEBHOOK_SECRET=

# Bearer tokens for machine-to-machine ingestion
EVOLVEX_API_KEY=            # /api/v1/sdk
EVOLVEX_COLLECTOR_KEY=      # /telemetry-intelligence

# Distributed rate limiting across instances (falls back to in-process otherwise)
REDIS_URL=

# Webhook public URLs (Railway)
SIGNOZ_WEBHOOK_PUBLIC_URL=https://your-api.railway.app/webhooks/signoz
# GitHub: https://your-api.railway.app/webhooks/github
# K8s event exporter: https://your-api.railway.app/webhooks/kubernetes
# eBPF agent: https://your-api.railway.app/webhooks/ebpf
# Feature flags: https://your-api.railway.app/webhooks/feature-flags
# CI/CD: https://your-api.railway.app/webhooks/cicd
```

See `.env.example` for the full annotated list (Slack OAuth, PagerDuty, Jira, ClickHouse direct-read,
telemetry-intelligence sampling knobs, OBI bridge thresholds).

## Kubernetes Integration

Point [kubernetes-event-exporter](https://github.com/resmo/kubernetes-event-exporter) or ArgoCD/Flux webhook at `/webhooks/kubernetes`. In production, Settings generates a scoped webhook secret plus a ready-to-run `helm/evolvex-agent` install command per workspace — the collector reports a heartbeat that flips the Settings panel to "✅ Cluster connected" automatically.

Supported event types: `Deployment`, `Pod`, `ReplicaSet`, `HorizontalPodAutoscaler`, OOMKilled, CrashLoopBackOff.

## eBPF Integration

Two real paths (both supported):

1. **SigNoz metrics** — if your cluster sends eBPF/network metrics to SigNoz (TCP retransmits, connection latency, **OBI** `obi_stat_*` metrics), Evolvex queries them via the metrics API during investigation enrichment.
2. **Direct webhook** — Cilium Hubble, Pixie, **OBI anomaly bridge** (`pnpm obi:bridge`), or custom eBPF collector POSTs structured events to `/webhooks/ebpf`.

**OpenTelemetry eBPF Instrumentation (OBI):** run OBI on Linux → OTLP export to SigNoz → Evolvex reads real kernel/network metrics. See [EBPF-OBI.md](./EBPF-OBI.md).

No synthetic kernel evidence is ever generated.

## Feature-Flag and CI/CD Integration

Same shared-secret webhook pattern as Kubernetes/eBPF, multi-tenant from day one:

- **Feature flags** — LaunchDarkly, Flagsmith, or any OpenFeature-compatible source POSTs flag toggle events to `/webhooks/feature-flags`; Evolvex attaches them as CHANGE timeline entries so "did a flag flip right before this alert fired?" is answerable without leaving the investigation.
- **CI/CD** — GitHub Actions, CircleCI, or Jenkins POSTs pipeline-stage events to `/webhooks/cicd`, correlated the same way GitHub push deploys are — a bad deploy pipeline run shows up next to the alert it likely caused.

Try either locally with `pnpm feature-flag:webhook-demo` / `pnpm cicd:webhook-demo`.

## Telemetry Intelligence Layer

`/telemetry-intelligence` lets a collector agent (Bearer `EVOLVEX_COLLECTOR_KEY`) fetch and sync
adaptive-sampling policy per service — baseline/elevated/incident sample rates (`TI_*` env vars), with a
"change boost" window that raises sampling right after a deploy and an "incident window" that samples at
100% while an investigation is open. Optionally emits collector config using a Go
`evolvexattributesprocessor` (`TI_USE_GO_PROCESSOR=true`, see `collector/evolvexattributesprocessor/`).

## Extensibility: Plugins and SDK

- **Plugins** (Settings → Plugins) — third-party integrations install with a generated webhook secret and
  POST custom events to `/webhooks/plugins`; scoped to the installing workspace and plugin ID.
- **Evolvex SDK** (`/api/v1/sdk/*`, Bearer `EVOLVEX_API_KEY`) — server-side event ingestion for teams that
  want to push custom application events into an investigation without a webhook integration. Try it with
  `pnpm sdk:demo`.

## Security

- All webhooks require secrets in production (`NODE_ENV=production`); shared-secret webhooks (Kubernetes/eBPF/feature-flag/CI-CD) resolve per-workspace via indexed `secret_hash`, never a decrypt-every-row scan.
- GitHub: `X-Hub-Signature-256` HMAC-SHA256 verification.
- JWT (access + refresh) + CSRF (`x-evolvex-csrf` header + trusted-origin check) on authenticated routes; hardened, `httpOnly` cookies.
- Rate limiting on webhooks and tRPC — Redis-backed distributed counters when `REDIS_URL` is set, in-process fallback otherwise (see [ADR-0006](./adr/0006-rate-limiting-abuse-protection.md)).
- `helmet` security headers on every response; strict CORS to `CLIENT_URL` with credentials.
- Integration secrets encrypted at rest (AES-256-GCM, `INTEGRATION_SECRETS_KEY`) — never logged, never returned in plaintext after save.
- All privileged mutations (integration changes, secret rotation, dashboard/Jira/PagerDuty actions) write an `audit_events` row with actor, action, and resource.

## Deploy Automation

`pnpm deploy:preflight` (env/secret completeness + pending migrations), `pnpm deploy:smoke <url>` (HTTP
probes against `/health`, `/health/deep`, `/openapi.json`, webhook routes), and `pnpm deploy:check`
(combined, used in CI gates) — see [ADR-0008](./adr/0008-production-deploy-automation.md). Settings →
**Production Engineering** surfaces the same checks live for operators.

## Related Docs

- [DEMO.md](../DEMO.md) — 5-minute judge walkthrough
- [HACKATHON.md](../HACKATHON.md) — full SigNoz capability → Evolvex usage map
- [docs/WIRING.md](./WIRING.md) — env var checklist to reach 80%+ integration health
- [docs/SIGNOZ-MCP.md](./SIGNOZ-MCP.md) — MCP server setup + Evolvex's native MCP-equivalent scripts
- [docs/EBPF-OBI.md](./EBPF-OBI.md) — eBPF/OBI kernel-signal setup
- [docs/adr/](./adr/) — architecture decision records, one per major subsystem
