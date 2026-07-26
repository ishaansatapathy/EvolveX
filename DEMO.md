# Evolvex — 5-minute judge demo

> **Full setup (OTel → SigNoz → Evolvex → GitHub/Slack/Jira/K8s):** [SETUP.md](./SETUP.md)  
> **Operator env checklist (Railway/local):** [docs/WIRING.md](./docs/WIRING.md)  
> **Capability map:** [HACKATHON.md](./HACKATHON.md)

## Before the demo

### Hosted Evolvex — judge / evaluator checklist

Use this when testing **production** (e.g. `https://evolvex.ishaandev.co.in`) with **your own** credentials — no shared operator secrets.

- [ ] **Your SigNoz** running (Cloud or Foundry `casting.yaml`)
- [ ] **Your app** instrumented with OTel → your SigNoz (**ingestion key** in app, not in Evolvex Settings)
- [ ] Evolvex → sign in → **Settings → SigNoz** → Cloud URL + **API key** → Save → Test OK
- [ ] **Generate webhook credentials** → SigNoz Notification Channel (URL + `evolvex` + **your password**)
- [ ] SigNoz **alert rule** attached to your channel (e.g. `signoz_calls_total` or p99 for your `service.name`)
- [ ] Optional: **GitHub** PAT + `owner/repo`, **Slack** webhook, **Jira** token in Settings
- [ ] Fire alert (`pnpm signoz:p99` with your ingestion key, or error in your app) → case in **Investigations**

### Operator checklist (deploying / running locally)

- [ ] Railway: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `JWT_*`, `INTEGRATION_SECRETS_KEY`, `OPENAI_API_KEY`, `BASE_URL`, `SIGNOZ_WEBHOOK_PUBLIC_URL`, Google OAuth
- [ ] Optional operator once: `SLACK_CLIENT_ID`/`SECRET` for Add to Slack OAuth
- [ ] Local: `pnpm db:migrate`, `pnpm dev`, `.env` per [docs/WIRING.md](./docs/WIRING.md)
- [ ] `SIGNOZ_INGESTION_KEY` on API for **Evolvex self-instrumentation** (`evolvex-api` traces in SigNoz)
- [ ] `/settings` → Integration Health **≥70%** (operator smoke test)

> **Do not** rely on `INVESTIGATION_OWNER_EMAIL` or global `SIGNOZ_WEBHOOK_SECRET` for multi-tenant demos — judges use **Settings → Generate webhook credentials** per workspace. Those env vars are legacy single-tenant/dev fallback only.

## Script (5 min)

### 1. Hook (30s)

> "SigNoz tells you something broke. Evolvex tells you **why** — by correlating alerts, traces, logs, deploys, and kernel signals into one investigation."

Open live URL → **Sign in with Google** or email/password.

### 2. Trigger incident (60s)

Option A — **Your app** (best for judges):

> OTel in your project sends telemetry to **your** SigNoz → alert fires → webhook → case in **your** workspace.

Option B — **Load generator** (repo clone, your ingestion key):

```bash
pnpm signoz:p99          # one-shot tail latency
pnpm signoz:loadgen      # baseline + periodic error spikes (graph peaks)
```

Wait 1–2 min for SigNoz alert → Evolvex creates investigation automatically.

Option C — Show an **existing open case** in **Investigations**.

### 3. Investigation OS (90s)

Select case → show:

- **Investigation Context** — rule-based summary from real evidence
- **Incident Narrative** — chronological story ("3 minutes later, slow trace…") with `[T1]` citation jumps
- **Evidence Completeness** — what's collected vs missing (GitHub, K8s, logs, traces)
- **Structured Supporting Evidence** — Deploy / Traces / Logs / Metrics / Infrastructure sections
- **Evidence Timeline** — ALERT → METRIC → TRACE from SigNoz API
- **AI Root Cause** — OpenAI markdown with clickable `[T1]` / `[E1]` citations
- **Pinpoint** — exact file:line from error logs + GitHub deploy correlation
- **Suggest fix** — optional LLM patch preview (user copies manually)
- **Export postmortem ↓** — download shareable `.md` for Slack/Notion
- **Create SigNoz dashboard** — one click in the Export menu builds a request-rate/error-rate/p99-latency
  dashboard in SigNoz scoped to the case's service and opens it in a new tab
- **Create Jira issue** — from case (if Jira connected in Settings)
- **Engineer Notes** — add a live note

### 4. Live telemetry (60s)

Navigate to **Traces** (no investigation filter):

> "This is live SigNoz data — including traces from this demo session via `evolvex-api`."

Show 5s auto-refresh. Open **Service Map** — real dependency graph from SigNoz.

### 5. Close (30s)

> "PostgreSQL is our investigation database. SigNoz is telemetry. Evolvex is the layer that connects them — so engineers investigate in minutes, not hours."

Show **Settings → Integration Health** dashboard. Point out that every integration is connected from the
browser — paste a key, or "Add to Slack" OAuth — no `.env` editing or redeploy per user, and each
workspace's webhook secrets are isolated (multi-tenant by design).

## What we never fake

- No hardcoded eBPF strings
- No mock logs/traces/service map in the UI
- No LLM summary without OpenAI + real timeline evidence
- No incident narrative without real timeline entries
- Demo traces fallback removed from investigation pipeline in production

## Troubleshooting

| Issue | Fix |
|-------|-----|
| No investigations | Settings → SigNoz → **Generate webhook credentials** → SigNoz channel + alert rule — see [SETUP.md](./SETUP.md) |
| Case in wrong workspace | Wrong webhook **password** in SigNoz channel — use **your** generated password |
| Save SigNoz 500 | Operator: run migrations + set `INTEGRATION_SECRETS_KEY` on deployment |
| Test Notification: no alerts | No telemetry for rule's `service.name` — run app OTel or `pnpm signoz:p99` |
| Integration health partial | Connect missing integrations in Settings (not global env for judges) |
| Empty traces page | Run `pnpm signoz:loadgen` or instrument your app with OTel |
| No AI summary | Operator: `OPENAI_API_KEY` on deployment; click Generate summary on case |
| GitHub deploy missing | Connect GitHub in Settings + push to configured repo **after** case exists |
| Pinpoint empty | GitHub PAT with `repo` read + error logs in SigNoz for same service |
| Slack test fails | Re-paste incoming webhook URL or reconnect OAuth |
