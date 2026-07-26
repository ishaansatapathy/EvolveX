# Evolvex — complete judge & user setup guide

> Step-by-step guide for **hosted production Evolvex** (browser only — no redeploy, no shared operator
> credentials). Each person gets their **own workspace**; data never leaks across accounts.

**Related docs:** [HACKATHON.md](./HACKATHON.md) (capability map) · [DEMO.md](./DEMO.md) (5‑min script) ·
[docs/WIRING.md](./docs/WIRING.md) (operator env checklist)

---

## 0. How the system fits together

Evolvex is an **investigation OS on top of SigNoz**. It does **not** continuously watch GitHub and forward
data to SigNoz. Your app sends telemetry **directly to SigNoz**; SigNoz fires alerts; Evolvex builds cases
and pulls extra context from connected integrations.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  YOUR APP (any language)                                                │
│  OpenTelemetry SDK  ──OTLP + ingestion key──►  YOUR SigNoz instance    │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              │  alert rules evaluate metrics/traces/logs
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  YOUR SigNoz                                                            │
│  Alert fires → Notification channel (Webhook + Basic Auth)            │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              │  POST /webhooks/signoz  (your unique password)
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  HOSTED EVOLVEX (e.g. evolvex.ishaandev.co.in)                          │
│  Creates investigation in YOUR workspace → pipeline enriches case         │
└─────────────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
   SigNoz API            GitHub API            Slack / Jira / K8s webhooks
   (read traces)         (deploys, pinpoint)   (notify, tickets, cluster events)
```

### Three different “SigNoz keys” (do not confuse them)

| Key | Where it goes | Purpose |
|-----|---------------|---------|
| **Ingestion key** | Your **app** (OTel env / SDK headers) | **Send** traces, logs, metrics **to** SigNoz |
| **API key** | **Evolvex Settings → Connect SigNoz** | **Read** traces/logs/metrics **from** SigNoz when building a case |
| **Webhook password** | **SigNoz notification channel** (Basic Auth) | Route **alerts to your Evolvex workspace** (each workspace gets its own password) |

The **webhook URL** is the same for everyone (`https://…/webhooks/signoz`); **password** identifies your workspace.

### What creates a case vs what enriches it

| Integration | Creates investigation? | Role |
|-------------|------------------------|------|
| **SigNoz alert webhook** | ✅ Yes | Automatic case creation |
| **GitHub** | ❌ No | Deploy/commit timeline, pinpoint (file:line) |
| **Kubernetes** | ❌ No* | Pod/rollout events on timeline (*signal webhook, not alert) |
| **Slack** | ❌ No | Notifications when case is ready / resolved |
| **Jira** | ❌ No | Create ticket from case (you click in UI) |
| **eBPF / CI-CD / Feature flags** | ❌ No | Extra timeline signals |

---

## 1. Prerequisites

- Google account (Evolvex sign-in)
- **Your own** SigNoz: [SigNoz Cloud](https://signoz.io/teams/) **or** self-host via Foundry (`casting.yaml`)
- A project/app you can instrument with OpenTelemetry (Node, Python, Go, Java, etc.)
- Optional: GitHub repo, Slack workspace, Jira Cloud, Kubernetes cluster

**You do not need:** operator `.env`, Railway access, or anyone else’s API keys.

---

## 2. Stand up SigNoz (your telemetry backend)

### Option A — SigNoz Cloud (fastest)

1. Create a SigNoz Cloud workspace (e.g. `https://your-org.in2.signoz.cloud`).
2. Note these from **SigNoz → Settings**:
   - **Cloud URL** (UI URL, e.g. `https://your-org.in2.signoz.cloud`)
   - **API Keys** → create key with **Editor** or **Admin** (needed for alert rules + Evolvex queries)
   - **Ingestion** → copy **Ingestion key** and note OTLP endpoint (e.g. `https://ingest.in2.signoz.cloud`)

### Option B — Self-host with Foundry (reproducible)

```bash
# From this repo root (same as foundryctl cast -f casting.yaml)
pnpm signoz:local:up
# UI: http://localhost:8080
# OTLP HTTP: http://localhost:4318
```

Then use `http://localhost:8080` as Cloud URL and create API + ingestion keys in local SigNoz Settings.

---

## 3. Instrument **your app** with OpenTelemetry (required for real alerts)

Evolvex **does not** install OTel into your repo. You add the SDK to **your project** so SigNoz receives
continuous traces/logs/metrics. Without this, alert rules have nothing to evaluate and **no case will fire**.

### 3.1 Node.js / TypeScript (recommended example)

**Install:**

```bash
npm install @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/exporter-logs-otlp-http
```

**Create `instrumentation.ts`** (load before your app):

```typescript
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";

const ingestionUrl = (process.env.SIGNOZ_INGESTION_URL ?? "https://ingest.in2.signoz.cloud").replace(/\/+$/, "");
const ingestionKey = process.env.SIGNOZ_INGESTION_KEY!;

const sdk = new NodeSDK({
  serviceName: process.env.OTEL_SERVICE_NAME ?? "payments-svc",
  traceExporter: new OTLPTraceExporter({
    url: `${ingestionUrl}/v1/traces`,
    headers: { "signoz-ingestion-key": ingestionKey },
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: `${ingestionUrl}/v1/metrics`,
      headers: { "signoz-ingestion-key": ingestionKey },
    }),
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
```

**Run your app:**

```bash
export SIGNOZ_INGESTION_KEY=<from SigNoz Settings → Ingestion>
export SIGNOZ_INGESTION_URL=https://ingest.in2.signoz.cloud   # match your region
export OTEL_SERVICE_NAME=payments-svc                          # match alert rule service name
node --require ./instrumentation.js dist/server.js
```

**Verify in SigNoz:** Services → your `OTEL_SERVICE_NAME` → traces appear within ~1 minute.

### 3.2 Python / Go / Java

Use SigNoz’s official OTel docs for your language. Same env vars:

- OTLP endpoint: `{SIGNOZ_INGESTION_URL}/v1/traces` (and `/v1/metrics`, `/v1/logs`)
- Header: `signoz-ingestion-key: <INGESTION_KEY>`
- Resource attribute: `service.name=<your-service>`

### 3.3 Quick demo load (optional — not your app, but real OTLP)

If you cloned this repo and only want to **test the pipeline** without wiring your app yet:

```bash
cd evolvex
# .env must have SIGNOZ_INGESTION_KEY + SIGNOZ_INGESTION_URL
pnpm signoz:loadgen          # baseline + periodic error spikes → payments-svc
pnpm signoz:p99              # one-shot tail latency batch
pnpm signoz:alert-setup -- --channel YourChannelName
```

This sends **real OTLP** to SigNoz; alerts and cases behave the same as a production app.

---

## 4. Connect Evolvex (hosted app)

Open the **hosted Evolvex URL** from the submission (example: `https://evolvex.ishaandev.co.in`).

### 4.1 Sign in & workspace

1. **Sign in with Google** (or email if enabled).
2. You get a **personal workspace** automatically — only you (and future teammates) see your investigations.
3. Go to **Settings** — confirm you are **workspace owner** (required to connect integrations).

### 4.2 Connect SigNoz (read path + vault)

1. **Settings → Connect integrations → SigNoz**
2. **Cloud URL:** your SigNoz UI URL (e.g. `https://your-org.in2.signoz.cloud`)
3. **API key:** from SigNoz → Settings → **API Keys** (Editor/Admin recommended)
4. Click **Save SigNoz** → **Test** → expect “SigNoz API connected”
5. Badge should show **Workspace vault** (not “From .env fallback”)

> Use the **API key** here — **not** the ingestion key. Ingestion key stays in your app only.

### 4.3 Generate webhook credentials (alert routing)

Still on the SigNoz card (after Save):

1. Click **Generate webhook credentials**
2. Copy:
   - **Webhook URL** — e.g. `https://evolvex-api.ishaandev.co.in/webhooks/signoz` (same URL for all users; your deployment may differ)
   - **Username:** `evolvex`
   - **Password:** **unique to your workspace** — do not share; other judges have different passwords

### 4.4 SigNoz notification channel

1. **Your SigNoz** → **Alerts → Notification Channels → + New**
2. Type: **Webhook**
3. Paste URL, username `evolvex`, password from step 4.3
4. **Save** → optional **Test** (connectivity check)

### 4.5 Alert rule (what actually fires cases)

1. **SigNoz → Alerts → Alert Rules** → create or edit a rule
2. **Query:** e.g. metric `signoz_calls_total` or error rate for **`service.name = '<your OTEL_SERVICE_NAME>'`**
3. **Threshold:** e.g. value > 0 (or p99 latency > 800ms — see `pnpm signoz:alert-setup` for examples)
4. **Notification:** select **your** channel from step 4.4
5. **Save**

Without a rule attached to your channel, saves alone will not create Evolvex cases.

### 4.6 End-to-end verification

1. Generate traffic: run your instrumented app **or** `pnpm signoz:loadgen` / `pnpm signoz:p99`
2. Wait **1–2 minutes** for SigNoz to evaluate the rule
3. Open **Investigations** on hosted Evolvex → new case **building** → **ready**
4. Open the case → **Incident story**, **Timeline**, **Evidence completeness**

---

## 5. GitHub (deploy correlation + pinpoint)

**Does not create cases.** After a SigNoz case exists, GitHub adds *what changed before the incident*.

### 5.1 Create a GitHub PAT

1. GitHub → **Settings → Developer settings → Personal access tokens**
2. **Classic:** scopes `repo` (if private repos) + `read:user`
3. **Fine-grained:** read access to repositories you deploy from
4. Copy token (`ghp_…` or `github_pat_…`)

### 5.2 Connect in Evolvex

1. **Settings → Connect integrations → GitHub**
2. Paste **PAT**
3. **Repository:** `owner/repo` (e.g. `acme/payments-api`) — **your project repo**, not Evolvex’s repo
4. Optional **Webhook secret** — for deploy webhook verification
5. **Save GitHub** → **Test token**

Evolvex can **auto-register** a push webhook on your repo when you provide `owner/repo` + token.

Manual fallback webhook URL (if needed):

```text
https://<evolvex-api-host>/webhooks/github
```

Event: **Push** · Content type: `application/json`

### 5.3 Test GitHub value

1. Ensure you already have an **open investigation** (from SigNoz alert)
2. **Push a commit** to the connected repo
3. Refresh the case → timeline should show a **Deploy** entry (commit, author, time)
4. If error logs match stack traces, check **Pinpoint** for file:line

---

## 6. Slack (notifications)

**Does not create cases.** Notifies your channel when investigations are ready or resolved.

### Option A — Add to Slack (one click)

If the deployment has Slack OAuth configured:

1. **Settings → Connect integrations → Slack**
2. Click **Add to Slack**
3. Pick workspace + channel on Slack’s consent screen
4. **Send test message** to verify

### Option B — Manual incoming webhook

1. Slack → **Apps → Incoming Webhooks** → add to a channel
2. Copy webhook URL (`https://hooks.slack.com/services/…`)
3. Evolvex Settings → Slack → **Manual setup** → paste URL → **Save webhook URL**
4. **Send test message**

---

## 7. Jira (create tickets from cases)

**Does not create cases.** You create a Jira issue **from an open investigation** in the UI.

### 7.1 Jira Cloud API token

1. [Atlassian account](https://id.atlassian.com/manage-profile/security/api-tokens) → **Create API token**
2. Note your Jira **site URL** (e.g. `https://your-org.atlassian.net`)
3. Note **project key** (e.g. `ENG`) and default **issue type** (e.g. `Bug`)

### 7.2 Connect in Evolvex

1. **Settings → Connect integrations → Jira**
2. **Base URL**, **email**, **API token**, **project key**, **issue type**
3. **Save Jira** → **Test**

### 7.3 Use in product

1. Open an investigation
2. Use **Create Jira issue** (or equivalent action in case UI)
3. Issue body includes root cause, timeline, and fix context from the case

---

## 8. Kubernetes (cluster events on timeline)

**Does not create cases by itself.** Forwards pod/rollout events into **open investigations** as infrastructure evidence.

### 8.1 Connect in Evolvex

1. **Settings → Connect Kubernetes**
2. Enter cluster name (e.g. `production`)
3. Click **Connect Kubernetes** → copy **Helm install command** and **webhook secret**

Each workspace gets a **scoped secret** (same pattern as SigNoz alert webhooks).

### 8.2 Install on your cluster

Run the generated Helm command against a cluster you control (chart deploys an event forwarder + OTel
collector ConfigMap — **not** the Evolvex API itself).

### 8.3 Verify

1. Settings panel flips to **✅ Cluster connected** when the first event arrives (auto-polls — no manual refresh)
2. With an open case near a rollout/crash, timeline shows **Kubernetes** entries

See `helm/evolvex-agent/` in this repo for chart details.

---

## 9. Optional signal webhooks (same pattern as K8s)

**Settings → Connect signal webhooks**

| Source | Use case |
|--------|----------|
| **eBPF / OBI** | Kernel/network latency signals |
| **Feature flags** | LaunchDarkly / Flagsmith flip correlation |
| **CI/CD** | GitHub Actions / Jenkins deploy stage correlation |

For each: click **Connect** → copy URL + secret + curl example → send one event → status shows **Connected**.

---

## 10. Optional plugins

**Settings → Plugins** → Install (Custom Events, Datadog Import, Prometheus Alertmanager, Security Scanner).

Each install gets a **unique webhook URL + secret** for that workspace. Use for custom timeline importers.

---

## 11. Minimum vs full judge checklist

### Minimum (must pass — ~20 min)

- [ ] SigNoz Cloud or Foundry running
- [ ] App instrumented with OTel **or** `pnpm signoz:loadgen`
- [ ] Evolvex sign-in → SigNoz Save + Test OK
- [ ] Webhook credentials generated → SigNoz channel + alert rule
- [ ] Alert fires → case in **Investigations**
- [ ] Case opens with timeline + incident story

### Full demo (+15 min)

- [ ] GitHub PAT + repo → push → deploy on timeline
- [ ] Slack test message
- [ ] Jira test + create issue from case
- [ ] K8s or signal webhook (optional)

---

## 12. Troubleshooting

| Problem | Fix |
|---------|-----|
| Save SigNoz 500 | Operator DB migration / `INTEGRATION_SECRETS_KEY` on deployment — retry after redeploy |
| Test Notification: “no alerts found” | No telemetry for rule’s `service.name` — run app or `pnpm signoz:p99` |
| Case in wrong workspace | Wrong webhook password in SigNoz channel — use **your** generated password |
| Case but empty traces | API key wrong in Settings, or no data in SigNoz for service/time window |
| GitHub connected but no deploy line | Push **after** case exists; repo must match `owner/repo` in Settings |
| Slack test fails | Re-paste webhook URL or reconnect OAuth |
| Password “optional” in SigNoz UI | **Required for multi-tenant** — always fill Basic Auth password |

---

## 13. What the operator configures once (judges never touch)

Hosted deployment needs (you don’t paste these in Settings):

- `DATABASE_URL`, `JWT_*`, `INTEGRATION_SECRETS_KEY`
- `OPENAI_API_KEY` (AI summaries)
- `SIGNOZ_WEBHOOK_PUBLIC_URL` / `BASE_URL` (public API URL for webhooks)
- Google OAuth for sign-in
- Optional: `SLACK_CLIENT_ID` / `SECRET` for Add to Slack

Judges only use **Settings in the browser** + **their own** SigNoz + **their own** app/repo.

---

## Quick links

| Doc | Purpose |
|-----|---------|
| [HACKATHON.md](./HACKATHON.md) | SigNoz capability map + judge narrative |
| [DEMO.md](./DEMO.md) | 5-minute live demo script |
| [docs/WIRING.md](./docs/WIRING.md) | Operator/local `.env` wiring |
| [docs/SIGNOZ-MCP.md](./docs/SIGNOZ-MCP.md) | Query SigNoz from Cursor via MCP |
| [docs/EBPF-OBI.md](./docs/EBPF-OBI.md) | eBPF / OBI setup |
