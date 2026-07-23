# Evolvex

**AI-powered Investigation OS** on top of SigNoz. Correlates alerts, traces, logs, deploys, Kubernetes events, and eBPF signals into a single incident context stored in PostgreSQL.

## Architecture

```
SigNoz / GitHub / K8s / eBPF  →  Evolvex API  →  PostgreSQL  →  React UI
```

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the full production design and zero-fake-data policy.

## Prerequisites

- Node.js 20+
- pnpm 9+
- Docker (PostgreSQL)
- SigNoz Cloud account
- OpenAI API key (optional — for LLM summaries)

## Local setup

```bash
pnpm install
cp .env.example .env
# Fill: DATABASE_URL, JWT_SECRET, SIGNOZ_*, INVESTIGATION_OWNER_EMAIL

pnpm db:up
pnpm db:migrate
pnpm dev
```

- Web: http://localhost:3000
- API: http://localhost:8000
- Health: http://localhost:8000/health

## SigNoz integration

1. Set `SIGNOZ_CLOUD_URL`, `SIGNOZ_API_KEY`, `SIGNOZ_INGESTION_KEY` in `.env`
2. Create alert in SigNoz (e.g. p99 latency > 800ms for `payments-svc`)
3. Add webhook notification channel pointing to `https://<your-api>/webhooks/signoz`
4. Set `SIGNOZ_WEBHOOK_SECRET` and configure the same secret in SigNoz

## Webhooks

| Endpoint | Source |
|----------|--------|
| `POST /webhooks/signoz` | SigNoz alerts |
| `POST /webhooks/github` | GitHub push (HMAC verified) |
| `POST /webhooks/kubernetes` | K8s event exporter |
| `POST /webhooks/ebpf` | Cilium Hubble / Pixie / custom agent |

## Telemetry (dogfooding)

When `SIGNOZ_INGESTION_KEY` is set, the API auto-instruments with OpenTelemetry as service `evolvex-api`. Visitor traffic appears in **Traces** and **Logs** pages (live SigNoz queries, no mock data).

## Demo login

Set `DEMO_LOGIN_ENABLED=true` and seed credentials in `.env` for judge access.

## Scripts

```bash
pnpm signoz:loadgen   # Send real traces to SigNoz
pnpm signoz:p99       # Tail latency load for p99 alerts
pnpm db:seed          # Seed auth demo user
```

## Deploy (Railway + Vercel)

See [DEMO.md](./DEMO.md) for the judge walkthrough.
