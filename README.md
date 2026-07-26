# Evolvex

> **Note:** AI Assistants Used: ChatGPT and Cursor AI for development assistance, debugging, and
> documentation. Final implementation was completed by me.

**AI-powered, multi-tenant Investigation OS** on top of SigNoz. Correlates alerts, traces, logs, deploys, Kubernetes events, eBPF signals, feature-flag toggles, and CI/CD pipeline stages into a single incident context stored in PostgreSQL — every workspace/organization isolated with its own encrypted integration vault and scoped webhook secrets.

## Architecture

```
SigNoz / GitHub / K8s / eBPF  →  Evolvex API  →  PostgreSQL  →  React UI
```

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the full production design and zero-fake-data policy.

**Judges:** start with [SETUP.md](./SETUP.md) for the full hosted onboarding flow (OTel → SigNoz → Evolvex → integrations).

For **OpenTelemetry eBPF Instrumentation (OBI)** setup, see [docs/EBPF-OBI.md](./docs/EBPF-OBI.md).

## Prerequisites

- Node.js 20+
- pnpm 9+
- **Neon Postgres** (recommended) or Docker for local PostgreSQL
- Docker (for self-hosted SigNoz via Foundry)
- [foundryctl](https://github.com/SigNoz/foundry) (SigNoz Foundry CLI)
- OpenAI API key (optional — for LLM summaries)

## Reproducible SigNoz deployment (hackathon requirement)

This repo includes `casting.yaml` and `casting.yaml.lock` at the repo root. Judges can reproduce the self-hosted SigNoz stack with Foundry:

```bash
# Install foundryctl: https://github.com/SigNoz/foundry#installation
pnpm signoz:local:up      # foundryctl cast -f casting.yaml — gauge + forge + deploy in one command
pnpm signoz:local:status  # docker compose ps for the generated stack
pnpm signoz:local:logs    # tail the signoz container
pnpm signoz:local:down    # docker compose down (data volumes untouched)
```

SigNoz UI: http://localhost:8080 · OTLP: http://localhost:4318

Then point Evolvex at the local SigNoz instance in `.env`:

```bash
SIGNOZ_CLOUD_URL=http://localhost:8080
SIGNOZ_API_KEY=<from SigNoz Settings → API Keys>
SIGNOZ_INGESTION_KEY=<optional, for OTLP ingest>
```

Run Evolvex separately (`pnpm dev` — see below). Foundry deploys **SigNoz only**; Evolvex is the application layer on top.

`casting.yaml` also enables SigNoz's **MCP server** (`spec.mcp.spec.enabled: true`), so any MCP client
(Cursor, Claude, Codex) can query the same traces/logs/metrics/alerts Evolvex investigates, in plain
English. See [docs/SIGNOZ-MCP.md](./docs/SIGNOZ-MCP.md) for connecting `.cursor/mcp.json` to it (local or
SigNoz Cloud), and for `pnpm signoz:alert-setup` / `pnpm signoz:postmortem-pack` / `pnpm signoz:dashboard-setup`
— Node equivalents of the MCP server's alert-creation, postmortem-evidence, and dashboard-creation workflows.

## Local setup

```bash
pnpm install
cp .env.example .env
# Fill: DATABASE_URL (+ DATABASE_URL_UNPOOLED for Neon), JWT_SECRET, INTEGRATION_SECRETS_KEY,
# SIGNOZ_* (ingestion + API), OPENAI_API_KEY. See docs/WIRING.md (operator) or SETUP.md (judges).

pnpm db:migrate    # applies schema to Neon or local Postgres
pnpm db:check      # verify connection
pnpm dev
```

- Web: http://localhost:3000
- API: http://localhost:8000
- Health: http://localhost:8000/health

## Database (Neon — recommended)

1. Create a project at [neon.tech](https://neon.tech)
2. Copy **two** connection strings from the Neon dashboard:
   - **Pooled** → `DATABASE_URL` (app runtime; hostname has `-pooler`)
   - **Direct** → `DATABASE_URL_UNPOOLED` (migrations only)
3. Paste both into `.env` (and Railway env vars on deploy)
4. Run:

```bash
pnpm db:migrate
pnpm db:check
```

SSL and pool sizing for Neon are handled automatically in `packages/database/pg.ts`.

**Local Postgres (optional):** `pnpm db:up` then use `postgresql://postgres:postgres@localhost:5432/evolvex`

## SigNoz integration

1. Settings → Connect SigNoz (cloud URL + API key), or set `SIGNOZ_*` in `.env` for single-tenant demos
2. Click **Generate webhook credentials** and copy the URL + Basic-auth password
3. Create a SigNoz alert (e.g. p99 latency > 800ms for `payments-svc`) and point its Notification
   Channel webhook at those credentials — cases route to *your* workspace automatically
4. Legacy single-tenant fallback: `SIGNOZ_WEBHOOK_SECRET` + `INVESTIGATION_OWNER_EMAIL` still work

## Webhooks

| Endpoint | Source |
|----------|--------|
| `POST /webhooks/signoz` | SigNoz alerts |
| `POST /webhooks/github` | GitHub push (HMAC verified) |
| `POST /webhooks/kubernetes` | K8s event exporter / ArgoCD / Flux |
| `POST /webhooks/ebpf` | Cilium Hubble / Pixie / OBI bridge / custom agent |
| `POST /webhooks/feature-flags` | LaunchDarkly / Flagsmith / OpenFeature flag toggles |
| `POST /webhooks/cicd` | GitHub Actions / CircleCI / Jenkins pipeline stages |
| `POST /webhooks/plugins` | Third-party plugin custom events (Settings → Plugins) |
| `POST /integrations/slack/*` | Slack "Add to Slack" OAuth callback |
| `POST /api/v1/sdk/*` | Evolvex SDK — server-side event ingestion (Bearer `EVOLVEX_API_KEY`) |
| `POST /telemetry-intelligence/*` | Collector agent sampling policy sync (Bearer `EVOLVEX_COLLECTOR_KEY`) |

SigNoz, Kubernetes, eBPF, feature-flag, and CI/CD webhooks are **multi-tenant**: each workspace gets
its own scoped secret from Settings (indexed `secret_hash` lookup, 24h dual-secret rotation window).
The `*_WEBHOOK_SECRET` / `INVESTIGATION_OWNER_EMAIL` env vars are only a single-tenant/dev fallback —
see [docs/adr/0005-org-integration-vault.md](./docs/adr/0005-org-integration-vault.md).

## API docs

- `GET /openapi.json` — full OpenAPI 3 document generated from the tRPC router (`trpc-to-openapi`) —
  every procedure with `.meta({ openapi: ... })` is both an RPC call under `/trpc` and a plain REST route
  under `/api`.
- `GET /health` — liveness (DB ping only).
- `GET /health/deep` — dependency-aware health (SigNoz, Redis, OpenAI, DB pool) used by `pnpm deploy:smoke`.

## Telemetry (dogfooding)

When `SIGNOZ_INGESTION_KEY` is set, the API auto-instruments with OpenTelemetry as service `evolvex-api`,
exporting all three pillars — **traces**, runtime **metrics**, and `@repo/logger` **logs** (trace-correlated) —
to SigNoz. Visitor traffic appears live in **Traces**, **Logs**, and **Dashboards** pages, no mock data.
Opt out of a single pillar with `OTEL_METRICS_EXPORTER=none` / `OTEL_LOGS_EXPORTER=none`.

## Scripts

```bash
pnpm signoz:local:up          # foundryctl cast — one-command self-hosted SigNoz (+ MCP) via Docker
pnpm signoz:local:down        # Tear down the Foundry-generated stack (volumes kept)
pnpm signoz:loadgen   # Send real traces to SigNoz
pnpm signoz:p99       # Tail latency load for p99 alerts
pnpm signoz:alert-setup       # Create p99-latency + error-rate alert rules via SigNoz API
pnpm signoz:postmortem-pack   # Compile a markdown postmortem from live SigNoz evidence
pnpm signoz:dashboard-setup   # Create a service-overview dashboard via SigNoz dashboards API
pnpm clickhouse:apply-mvs     # Apply direct-ClickHouse materialized views (self-hosted only)
pnpm investigation:seed  # Seed a real investigation via webhook handler
pnpm obi:up             # OBI eBPF demo (Docker Linux only) → SigNoz OTLP
pnpm obi:bridge         # Poll OBI metrics in SigNoz → Evolvex eBPF webhook
pnpm db:seed          # Seed auth demo user
```

### Production ops scripts

```bash
pnpm wiring:secrets     # Generate random values for every *_WEBHOOK_SECRET / JWT_SECRET
pnpm wiring:check       # Verify required env vars + live connectivity before deploy
pnpm deploy:preflight   # Pre-deploy checklist (migrations pending, secrets set, build passes)
pnpm deploy:smoke       # Post-deploy smoke test against /health/deep on a live URL
pnpm deploy:check       # Combined preflight + smoke, used in CI/CD gates
pnpm org:backfill       # Backfill organization_id on rows created before multi-tenancy shipped
```

See [docs/adr/0008-production-deploy-automation.md](./docs/adr/0008-production-deploy-automation.md).

### Self-service integrations (no repo cloning, no manual webhook hunting)

Settings → **Connect integrations** lets a workspace owner wire up SigNoz, GitHub, Slack, PagerDuty, Jira,
and Kubernetes entirely from the browser — paste-a-key for most, real OAuth for Slack:

- **Slack — "Add to Slack" OAuth**: set `SLACK_CLIENT_ID`/`SLACK_CLIENT_SECRET` (create a Slack App at
  [api.slack.com/apps](https://api.slack.com/apps) with the `incoming-webhook` bot scope and redirect URL
  `<BASE_URL>/integrations/slack/callback`) and the Settings page shows a one-click **Add to Slack** button —
  no webhook URL to find or paste. Falls back to manual webhook-URL entry when unset.
- **SigNoz / GitHub / PagerDuty / Jira**: paste an API key/token/URL directly in Settings — encrypted at
  rest per workspace, same UX as the SigNoz Cloud key.
- **Kubernetes**: Settings generates a scoped webhook secret + ready-to-run Helm command; once your cluster's
  collector reports in, the panel flips to a live "✅ Cluster connected" status automatically (no SaaS ever
  needs your cluster credentials — you run one Helm command in your own cluster, the same trust model as
  Datadog/New Relic agents).
- **eBPF / feature flags / CI-CD**: Settings → **Connect signal webhooks** generates a per-workspace secret +
  ready-to-paste URL/curl example for each source (OBI/Hubble/Pixie, LaunchDarkly/Flagsmith, GitHub
  Actions/CircleCI/Jenkins). Each workspace's secret is isolated — an indexed `secret_hash` lookup resolves
  the owning organization per request, and "Rotate secret" keeps the old one valid for 24h so an in-flight
  agent/CI runner never breaks mid-rotation. No shared global secret across tenants.

## Deploy (Railway + Vercel + Neon)

- **API:** Railway (`railway.toml`) — set `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `INTEGRATION_SECRETS_KEY`, `JWT_*`, `OPENAI_API_KEY`, `BASE_URL`, `SIGNOZ_WEBHOOK_PUBLIC_URL`, Google OAuth from Neon + SigNoz + Google Cloud
- **Web:** Vercel (`apps/web/vercel.json`)
- **DB:** Neon Postgres (no Railway Postgres plugin needed)

See [SETUP.md](./SETUP.md) for full judge onboarding, [DEMO.md](./DEMO.md) for the live walkthrough,
and [docs/WIRING.md](./docs/WIRING.md) for operator/local env wiring.
