# OBI (OpenTelemetry eBPF Instrumentation) + Evolvex

[OBI](https://github.com/open-telemetry/opentelemetry-ebpf-instrumentation) is the OpenTelemetry project's **zero-code eBPF auto-instrumentation** (formerly Grafana Beyla lineage). It captures HTTP/gRPC RED metrics, distributed traces, and **kernel/network signals** (TCP RTT, retransmits, socket I/O) without changing application code.

Evolvex integrates OBI through **real telemetry only** — no synthetic kernel events.

## Architecture

```
┌─────────────────┐     OTLP      ┌─────────────┐     Query API    ┌─────────────┐
│  OBI (eBPF)     │ ────────────► │   SigNoz    │ ◄─────────────── │  Evolvex    │
│  Linux / K8s    │  metrics+     │   Cloud     │   metrics/logs   │  Pipeline   │
│  privileged     │  traces       │             │                  │  + UI       │
└─────────────────┘               └─────────────┘                  └──────┬──────┘
                                                                            │
                    Optional anomaly bridge ───────────────────────────────►│
                    (scripts/obi-anomaly-bridge.ts)                         │
                    POST /webhooks/ebpf when OBI metrics exceed threshold   ▼
```

### Two ingestion paths (both real)

| Path | When to use | Evolvex behavior |
|------|-------------|------------------|
| **A. SigNoz OTLP (recommended)** | OBI exports to SigNoz ingest | Investigation pipeline queries OBI metric names via `enrichEbpfFromSignozMetrics()` |
| **B. Anomaly bridge (optional)** | Want immediate EBPF timeline entries on spikes | `pnpm obi:bridge` polls SigNoz → POSTs to `/webhooks/ebpf` when thresholds exceeded |

Path A is automatic during investigation enrichment. Path B is for demos where you want webhook-driven timeline entries without waiting for a full pipeline rerun.

## Requirements

- **Linux** kernel 5.8+ with BTF (OBI does **not** run on native Windows)
- Docker Desktop with **Linux containers** (WSL2) for local demo
- Root / privileged container for OBI
- SigNoz Cloud (or self-hosted) with OTLP ingest key

## Quick start (local demo)

### 1. Start OBI + sample HTTP app

Ensure `.env` has `SIGNOZ_INGESTION_URL` and `SIGNOZ_INGESTION_KEY`.

```bash
docker compose -f docker-compose.obi.yml up
```

This runs:
- `goblog` — demo HTTPS app on https://localhost:18443
- `obi` — eBPF agent instrumenting port 8443, exporting OTLP to SigNoz as service `goblog`

Generate traffic: open https://localhost:18443 in browser.

### 2. Verify in SigNoz

Look for metrics such as:
- `obi_stat_tcp_rtt_seconds`
- `obi_network_flow_bytes_total`
- `http_server_request_duration_seconds`

And traces for service `goblog`.

### 3. Evolvex investigation enrichment

When an investigation runs for a correlated service, the pipeline automatically queries OBI metric names in SigNoz and adds **EBPF** timeline entries when values exist.

### 4. Optional: anomaly bridge

Posts to Evolvex when OBI metrics exceed configurable thresholds (real values only):

```bash
pnpm obi:bridge -- --service goblog --once
```

Continuous mode (default 60s interval):

```bash
pnpm obi:bridge -- --service payments-svc
```

Environment:

```bash
EBPF_WEBHOOK_SECRET=...          # required if secret set on API
OBI_TCP_RTT_THRESHOLD_SEC=0.25
OBI_HTTP_LATENCY_THRESHOLD_SEC=0.8
OBI_BRIDGE_INTERVAL_SEC=60
```

## Production (Kubernetes)

Run OBI as a DaemonSet or privileged sidecar. Export OTLP to SigNoz:

```yaml
env:
  - name: OTEL_EXPORTER_OTLP_ENDPOINT
    value: https://ingest.in2.signoz.cloud
  - name: OTEL_EXPORTER_OTLP_HEADERS
    value: signoz-ingestion-key=${SIGNOZ_INGESTION_KEY}
  - name: OTEL_EBPF_METRICS_FEATURES
    value: network,application
```

Image: `otel/ebpf-instrument:v0.10.0` (pin semver in production).

See [OBI Kubernetes setup](https://opentelemetry.io/docs/zero-code/obi/setup/kubernetes/).

## Why not embed OBI in Evolvex API?

OBI is a **Linux eBPF daemon**, not an npm library. Evolvex stays a Node.js investigation layer and consumes OBI telemetry via SigNoz (same pattern as traces/logs). This keeps the zero-fake policy: if OBI is not running, no EBPF evidence is fabricated.

## Hackathon talking point

> "We use OpenTelemetry's official eBPF instrumentation — zero code changes — kernel-level TCP/network signals flow into SigNoz, and Evolvex correlates them with alerts, deploys, and traces in one investigation timeline."

## References

- [OBI GitHub](https://github.com/open-telemetry/opentelemetry-ebpf-instrumentation)
- [OBI docs](https://opentelemetry.io/docs/zero-code/obi/)
- [OBI exported metrics](https://opentelemetry.io/docs/zero-code/obi/metrics/)
- [Evolvex ARCHITECTURE.md](./ARCHITECTURE.md)
