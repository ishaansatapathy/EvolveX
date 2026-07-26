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

## Copy-paste cheat sheet (full flow)

```bash
# ── 1. YOUR APP → SigNoz (OTel) ──
export SIGNOZ_INGESTION_KEY=<SigNoz Settings → Ingestion>
export SIGNOZ_INGESTION_URL=https://ingest.in2.signoz.cloud
export OTEL_SERVICE_NAME=payments-svc
node --require ./instrumentation.js server.js

# ── 2. OR use Evolvex loadgen (no app) ──
cd evolvex && pnpm signoz:p99

# ── 3. GitHub deploy test (after case exists) ──
git commit --allow-empty -m "test: deploy correlation"
git push origin main
```

```text
# ── Evolvex Settings → SigNoz ──
Cloud URL:   https://your-org.in2.signoz.cloud
API key:     <Editor/Admin key>

# ── Generate webhook credentials → paste in SigNoz channel ──
Webhook URL: https://evolvex-api.ishaandev.co.in/webhooks/signoz
Username:    evolvex
Password:    <your unique workspace password>

# ── Evolvex Settings → GitHub ──
PAT:         ghp_...
Repository:  owner/your-app-repo

# ── Evolvex Settings → Jira ──
Base URL:    https://your-org.atlassian.net
Email:       you@company.com
API token:   ATATT...
Project key: SCRUM
Issue type:  Bug
```

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

### 3.0 Environment variables (copy this first)

Every language uses the same three values from **SigNoz → Settings → Ingestion**:

```bash
# ── Put these in your app shell, .env, or deployment secrets ──
SIGNOZ_INGESTION_KEY=your-ingestion-key-here
SIGNOZ_INGESTION_URL=https://ingest.in2.signoz.cloud   # match your SigNoz Cloud region
OTEL_SERVICE_NAME=payments-svc                         # MUST match your alert rule filter
```

| Variable | Example | Where to get it |
|----------|---------|-----------------|
| `SIGNOZ_INGESTION_KEY` | `abc123…` | SigNoz → Settings → **Ingestion** |
| `SIGNOZ_INGESTION_URL` | `https://ingest.in2.signoz.cloud` | Same page (OTLP HTTP base URL) |
| `OTEL_SERVICE_NAME` | `payments-svc` | You choose — use the same name in alert rules |

**Verify:** SigNoz → **Services** → your `OTEL_SERVICE_NAME` → traces within ~1 minute.

---

### 3.1 Node.js / TypeScript

#### Install packages

```bash
npm install @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http
```

#### Create `instrumentation.ts`

```typescript
// instrumentation.ts — load BEFORE your app starts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";

const baseUrl = (process.env.SIGNOZ_INGESTION_URL ?? "https://ingest.in2.signoz.cloud").replace(/\/+$/, "");
const key = process.env.SIGNOZ_INGESTION_KEY!;

const sdk = new NodeSDK({
  serviceName: process.env.OTEL_SERVICE_NAME ?? "payments-svc",
  traceExporter: new OTLPTraceExporter({
    url: `${baseUrl}/v1/traces`,
    headers: { "signoz-ingestion-key": key },
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: `${baseUrl}/v1/metrics`,
      headers: { "signoz-ingestion-key": key },
    }),
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
```

#### Minimal Express app (optional — to generate real HTTP traces)

```typescript
// server.ts
import express from "express";

const app = express();

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/checkout", (_req, res) => {
  // Simulate occasional errors so alert rules can fire
  if (Math.random() < 0.05) {
    return res.status(500).json({ error: "payment failed" });
  }
  res.json({ status: "ok" });
});

app.listen(3000, () => console.log("listening on :3000"));
```

#### Run (load OTel first)

```bash
# Linux / macOS
export SIGNOZ_INGESTION_KEY=your-key
export SIGNOZ_INGESTION_URL=https://ingest.in2.signoz.cloud
export OTEL_SERVICE_NAME=payments-svc

node --require ./instrumentation.js server.js
```

```powershell
# Windows PowerShell
$env:SIGNOZ_INGESTION_KEY="your-key"
$env:SIGNOZ_INGESTION_URL="https://ingest.in2.signoz.cloud"
$env:OTEL_SERVICE_NAME="payments-svc"

node --require ./instrumentation.js server.js
```

#### `package.json` script (recommended)

```json
{
  "scripts": {
    "dev": "node --require ./instrumentation.js server.js"
  }
}
```

---

### 3.2 Python (FastAPI example)

#### Install

```bash
pip install opentelemetry-distro opentelemetry-exporter-otlp \
  fastapi uvicorn opentelemetry-instrumentation-fastapi
```

#### Run with auto-instrumentation

```bash
export SIGNOZ_INGESTION_KEY=your-key
export SIGNOZ_INGESTION_URL=https://ingest.in2.signoz.cloud
export OTEL_SERVICE_NAME=payments-svc

export OTEL_EXPORTER_OTLP_ENDPOINT="${SIGNOZ_INGESTION_URL}"
export OTEL_EXPORTER_OTLP_HEADERS="signoz-ingestion-key=${SIGNOZ_INGESTION_KEY}"
export OTEL_TRACES_EXPORTER=otlp
export OTEL_METRICS_EXPORTER=otlp

opentelemetry-instrument uvicorn main:app --host 0.0.0.0 --port 8000
```

#### Minimal `main.py`

```python
from fastapi import FastAPI
import random

app = FastAPI()

@app.get("/health")
def health():
    return {"ok": True}

@app.get("/checkout")
def checkout():
    if random.random() < 0.05:
        raise RuntimeError("payment failed")  # shows up as error trace in SigNoz
    return {"status": "ok"}
```

---

### 3.3 Go (minimal)

#### Install OTel packages

```bash
go get go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp
go get go.opentelemetry.io/otel/sdk/trace
go get go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp
```

#### Env vars + run

```bash
export SIGNOZ_INGESTION_KEY=your-key
export SIGNOZ_INGESTION_URL=https://ingest.in2.signoz.cloud
export OTEL_SERVICE_NAME=payments-svc

go run .
```

#### Snippet — OTLP exporter setup

```go
// main.go (simplified)
endpoint := os.Getenv("SIGNOZ_INGESTION_URL") + "/v1/traces"
exporter, _ := otlptracehttp.New(ctx,
    otlptracehttp.WithEndpointURL(endpoint),
    otlptracehttp.WithHeaders(map[string]string{
        "signoz-ingestion-key": os.Getenv("SIGNOZ_INGESTION_KEY"),
    }),
)
tp := trace.NewTracerProvider(trace.WithBatcher(exporter))
otel.SetTracerProvider(tp)
```

Full Go guide: [SigNoz Go instrumentation docs](https://signoz.io/docs/instrumentation/opentelemetry-golang/).

---

### 3.4 Quick demo load (no app needed — Evolvex repo only)

If you cloned **Evolvex** and just want to test alerts without wiring your own app:

```bash
cd evolvex

# Create .env with at least:
# SIGNOZ_INGESTION_KEY=...
# SIGNOZ_INGESTION_URL=https://ingest.in2.signoz.cloud

pnpm signoz:loadgen          # baseline + periodic error spikes → service payments-svc
pnpm signoz:p99              # one-shot tail latency batch
pnpm signoz:alert-setup -- --channel YourChannelName
```

This sends **real OTLP** to SigNoz. Alerts and Evolvex cases behave the same as a production app.

---

## 4. Connect Evolvex (hosted app)

Open the **hosted Evolvex URL** from the submission (example: `https://evolvex.ishaandev.co.in`).

### 4.1 Sign in & workspace

1. **Sign in with Google** (or email if enabled).
2. You get a **personal workspace** automatically — only you (and future teammates) see your investigations.
3. Go to **Settings** — confirm you are **workspace owner** (required to connect integrations).

### 4.2 Connect SigNoz (read path + vault)

Fill the Evolvex Settings form like this (replace with **your** values):

```text
Cloud URL:  https://your-org.in2.signoz.cloud
API key:    <SigNoz → Settings → API Keys → Editor or Admin>
```

Steps:

1. **Settings → Connect integrations → SigNoz**
2. Paste **Cloud URL** and **API key**
3. Click **Save SigNoz** → **Test** → expect `SigNoz API connected`
4. Badge should show **Workspace vault** (not “From .env fallback”)

> Use the **API key** here — **not** the ingestion key. Ingestion key stays in your app only (section 3).

### 4.3 Generate webhook credentials (alert routing)

After Save, click **Generate webhook credentials**. You will get something like:

```text
Webhook URL:  https://evolvex-api.ishaandev.co.in/webhooks/signoz
Username:     evolvex
Password:     <unique per workspace — copy from Settings, do not share>
```

### 4.4 SigNoz notification channel

In **your SigNoz** → **Alerts → Notification Channels → + New → Webhook**:

```text
URL:      https://evolvex-api.ishaandev.co.in/webhooks/signoz
Username: evolvex
Password: <your workspace password from step 4.3>
```

Save the channel (e.g. name it `EvolveX-Alerts`).

### 4.5 Alert rule (what actually fires cases)

Create or edit a rule in **SigNoz → Alerts → Alert Rules**. Example for loadgen / `payments-svc`:

```text
Rule name:     p99 latency spike — payments-svc
Query type:    Metrics (or Traces — depends on your setup)
Filter:        service.name = 'payments-svc'
Condition:     p99 latency > 800ms   (or error rate > 0)
For:           1 minute
Notification:  EvolveX-Alerts        ← your channel from 4.4
```

Or create rules automatically from the Evolvex repo (needs API key in `.env`):

```bash
pnpm signoz:alert-setup -- --channel EvolveX-Alerts
```

Without a rule attached to your channel, telemetry alone will **not** create Evolvex cases.

### 4.6 End-to-end verification

```bash
# Option A — your instrumented app (section 3)
npm run dev

# Option B — Evolvex loadgen (section 3.4)
pnpm signoz:p99
```

Then:

1. Wait **1–2 minutes** for SigNoz to evaluate the rule
2. Open **Investigations** on hosted Evolvex → new case **building** → **ready**
3. Open the case → **Incident story**, **Timeline**, **Evidence completeness**

---

## 5. GitHub (deploy correlation + pinpoint)

**Does not create cases.** After a SigNoz case exists, GitHub adds *what changed before the incident*.

### 5.1 Create a GitHub PAT

GitHub → **Settings → Developer settings → Personal access tokens** → create token:

```text
Classic token scopes:  repo (private repos) + read:user
Fine-grained token:    read access to your deploy repo
```

Copy the token (`ghp_…` or `github_pat_…`).

### 5.2 Connect in Evolvex

Fill Settings → GitHub like this:

```text
PAT:         ghp_xxxxxxxxxxxx
Repository:  ishaansatapathy/my-payments-api    ← owner/repo of YOUR app, not Evolvex
```

Steps:

1. **Settings → Connect integrations → GitHub**
2. Paste **PAT** and **Repository** (`owner/repo`)
3. **Save GitHub** → **Test token**
4. Evolvex can **auto-register** a push webhook on your repo

Manual webhook (if auto-register fails):

```text
Payload URL:  https://evolvex-api.ishaandev.co.in/webhooks/github
Content type: application/json
Events:       Push
```

### 5.3 Test GitHub — push a commit

You need an **open investigation** first (from SigNoz alert). Then push:

```bash
cd my-payments-api
git commit --allow-empty -m "test: trigger deploy correlation for Evolvex"
git push origin main
```

### 5.4 Where to see GitHub tracing in Evolvex

| What you want | Where in the UI |
|---------------|-----------------|
| Which commit deployed | Case → **Timeline** → filter **DEPLOY** |
| Commit diff / rollback | Case → **Analysis** → **Pinpoint** → **View deploy diff →** |
| Error at file:line | Case → **Analysis** → **Likely culprit · Pinpoint** (`src/foo.ts:42`) |
| All deploys (not just story summary) | **Timeline** — story paragraph only highlights first + last event |

> **Note:** Incident **story** summary mentions deploy twice by design (first deploy + latest event).
> Every push appears as its own line under **Timeline → DEPLOY**. With multiple open cases, each push
> may attach to the case whose incident window matches — check all cases if you pushed multiple times.

### 5.5 Pinpoint needs real stack traces

Loadgen creates alerts but usually **no file:line pinpoint**. For pinpoint demo, your app should log
errors with stack traces:

```typescript
// Example — error with stack (Node.js)
app.get("/checkout", () => {
  throw new Error("Redis connection timeout at checkout");
});
```

SigNoz captures the log → Evolvex **Pinpoint** extracts `file:line` → correlates with GitHub deploy diff.

---

## 6. Slack (notifications)

**Does not create cases.** Notifies your channel when investigations are ready or resolved.

### Option A — Add to Slack (one click)

If Settings shows **Add to Slack**:

1. Click **Add to Slack** → pick workspace + channel
2. **Send test message** → channel should show: `Evolvex is connected…`

### Option B — Manual incoming webhook (always works)

#### Step 1 — Create webhook in Slack

Slack → **Apps → Incoming Webhooks** → add to a channel → copy URL (looks like `hooks.slack.com/services/…` — paste the full URL Slack gives you):

```text
<paste-your-incoming-webhook-url-from-slack>
```

#### Step 2 — Paste in Evolvex

```text
Settings → Slack → Manual setup → Incoming webhook URL → Save webhook URL
```

#### Step 3 — Test

Click **Send test message**. Success = message in your Slack channel.

#### Optional — test with curl

```bash
curl -X POST "<your-slack-incoming-webhook-url>" \
  -H "Content-Type: application/json" \
  -d '{"text":"Evolvex Slack test from curl"}'
```

---

## 7. Jira (create tickets from cases)

**Does not create cases.** You create a Jira issue **from an open investigation** in the UI.

### 7.1 Get Jira API token

1. Open [Atlassian API tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
2. **Create and manage API tokens** → **Create API token**
3. Copy token (shown once)

### 7.2 Connect in Evolvex — example values

Fill Settings → Jira like this (use **your** site):

```text
Base URL:     https://your-org.atlassian.net
Email:        you@company.com              ← same email as Atlassian login
API token:    ATATT3xFfGF0...              ← paste once, then Save
Project key:  SCRUM                        ← from Jira board URL (.../projects/SCRUM/...)
Issue type:   Bug                          ← or Task — must exist in your project
```

Steps:

1. **Save Jira** first (scroll up after Test — result message appears at top of Settings)
2. Click **Test** → expect `Connected as <name> · project SCRUM · issue type Bug`

### 7.3 Create issue from a case

1. Open an **investigation** (must be from SigNoz alert — Jira does not create cases)
2. Click **Create Jira issue**
3. Ticket appears in Jira → your project → **To Do**

Example ticket body (auto-filled by Evolvex):

```markdown
## Incident summary
p99 latency above 800ms for payments-svc

## Root cause (AI)
Redis connection timeout during POST /checkout…

## Timeline
- [T1] SigNoz alert fired at 18:41 UTC
- [T2] Deploy ishaansatapathy/EvolveX@fc35fd4
```

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

Example (Evolvex generates the real URL + secret in Settings):

```bash
curl -X POST "https://evolvex-api.ishaandev.co.in/webhooks/cicd" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-workspace-secret>" \
  -d '{
    "pipeline": "deploy",
    "stage": "deploy",
    "status": "success",
    "service": "payments-svc",
    "commit": "abc1234"
  }'
```

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
| Story shows 2 deploys but I pushed 3 | Check **Timeline → DEPLOY** on **each case** — pushes split across cases |
| Jira Test — nothing visible | **Save Jira** first, then Test, then **scroll to top** of Settings for message |
| Jira Test 401 | Email must match Atlassian login; regenerate API token |
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
