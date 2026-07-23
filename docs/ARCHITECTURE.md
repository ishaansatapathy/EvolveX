# Evolvex — Production Investigation OS

> **Policy: zero fake data in production.** Every timeline entry, metric, eBPF signal, and deploy event must originate from a real source (SigNoz API, webhook, or OpenTelemetry ingestion). Development-only fallbacks are gated by `NODE_ENV !== 'production'`.

## What Evolvex Is

Evolvex is the **investigation layer** on top of observability. SigNoz (and OpenTelemetry) are the **telemetry source**. PostgreSQL is the **investigation database** — the place where alerts, traces, logs, deploys, K8s events, and kernel signals are correlated into a single incident context.

```
┌─────────────┐  ┌──────────────┐  ┌─────────────┐  ┌──────────────┐
│   SigNoz    │  │   GitHub     │  │ Kubernetes  │  │ eBPF Agent   │
│ alerts/traces│  │ push/deploy  │  │ events      │  │ (Hubble/Pixie│
└──────┬──────┘  └──────┬───────┘  └──────┬──────┘  └──────┬───────┘
       │                │                 │                 │
       ▼                ▼                 ▼                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                     Evolvex API (Express + tRPC)                  │
│  /webhooks/signoz  /webhooks/github  /webhooks/kubernetes         │
│  /webhooks/ebpf                                                     │
└───────────────────────────────┬──────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│              PostgreSQL — Investigation Database                  │
│  investigations · timeline · evidence · change_events             │
│  runtime_signals · services · service_dependencies                │
│  investigation_notes · investigation_summaries                    │
└───────────────────────────────┬──────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                     React UI (Next.js)                            │
│  Investigations · Service Map · Logs · Traces · Settings        │
└──────────────────────────────────────────────────────────────────┘
```

## Data Sources (Real Only)

| Source | Ingestion | Stored As |
|--------|-----------|-----------|
| SigNoz alerts | `POST /webhooks/signoz` | Investigation + ALERT timeline |
| SigNoz traces/logs | SigNoz Query API v5 | TRACE/LOG timeline + runtime_signals |
| SigNoz metrics (incl. eBPF-derived) | SigNoz Query API v5 | METRIC/EBPF timeline |
| GitHub push | `POST /webhooks/github` | DEPLOY + change_events (commit) |
| Kubernetes | `POST /webhooks/kubernetes` | CHANGE + change_events (kubernetes) |
| eBPF agent | `POST /webhooks/ebpf` | EBPF timeline + evidence |

## Investigation Pipeline

1. **Alert ingested** — SigNoz webhook creates `investigations` row with incident window.
2. **Evidence enrichment** — async pipeline queries SigNoz for slow/error traces, logs, and kernel/network metrics.
3. **Change correlation** — GitHub/K8s webhooks attach deploy/events to open investigations within time window.
4. **Service graph** — built from SigNoz service map API + trace-derived dependencies (never hardcoded).
5. **LLM summary** — OpenAI generates markdown from assembled evidence (stored in `investigation_summaries`).

## Environment Requirements (Production)

```bash
# Required
DATABASE_URL=
JWT_SECRET=
JWT_REFRESH_SECRET=
INVESTIGATION_OWNER_EMAIL=
SIGNOZ_CLOUD_URL=
SIGNOZ_API_KEY=
SIGNOZ_WEBHOOK_SECRET=
GITHUB_WEBHOOK_SECRET=
KUBERNETES_WEBHOOK_SECRET=
EBPF_WEBHOOK_SECRET=
OPENAI_API_KEY=

# Webhook public URLs (Railway)
SIGNOZ_WEBHOOK_PUBLIC_URL=https://your-api.railway.app/webhooks/signoz
# GitHub: https://your-api.railway.app/webhooks/github
# K8s event exporter: https://your-api.railway.app/webhooks/kubernetes
# eBPF agent: https://your-api.railway.app/webhooks/ebpf
```

## Kubernetes Integration

Point [kubernetes-event-exporter](https://github.com/resmo/kubernetes-event-exporter) or ArgoCD/Flux webhook at `/webhooks/kubernetes`.

Supported event types: `Deployment`, `Pod`, `ReplicaSet`, `HorizontalPodAutoscaler`, OOMKilled, CrashLoopBackOff.

## eBPF Integration

Two real paths (both supported):

1. **SigNoz metrics** — if your cluster sends eBPF/network metrics to SigNoz (TCP retransmits, connection latency), Evolvex queries them via the metrics API during investigation enrichment.
2. **Direct webhook** — Cilium Hubble, Pixie, or custom eBPF collector POSTs structured events to `/webhooks/ebpf`.

No synthetic kernel evidence is ever generated.

## Security

- All webhooks require secrets in production (`NODE_ENV=production`).
- GitHub: `X-Hub-Signature-256` HMAC-SHA256 verification.
- JWT + CSRF on authenticated routes.
- Rate limiting on webhooks and tRPC.
