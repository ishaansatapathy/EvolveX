# Evolvex — 5-minute judge demo

## Before the demo

- [ ] `.env` production values set on Railway (API) and Vercel (web)
- [ ] SigNoz alert configured → webhook URL live
- [ ] GitHub webhook on repo → `/webhooks/github`
- [ ] `OPENAI_API_KEY` set for AI summary
- [ ] `SIGNOZ_INGESTION_KEY` set so API self-instruments as `evolvex-api`

## Script (5 min)

### 1. Hook (30s)

> "SigNoz tells you something broke. Evolvex tells you **why** — by correlating alerts, traces, deploys, and kernel signals into one investigation."

Open live URL → **Sign in with Google** or email/password.

### 2. Trigger incident (60s)

Option A — Live:
```bash
pnpm signoz:p99
```
Wait for SigNoz alert → Evolvex creates investigation automatically.

Option B — Show existing open case in **Investigations**.

### 3. Investigation OS (90s)

Select case → show:

- **Investigation Context** — rule-based summary from real evidence
- **Evidence Timeline** — ALERT → METRIC → TRACE from SigNoz API
- **Change Events** — GitHub push or K8s event if correlated
- **AI Root Cause** — OpenAI markdown (only from collected evidence)
- **Engineer Notes** — add a live note

### 4. Live telemetry (60s)

Navigate to **Traces** (no investigation filter):

> "This is live SigNoz data — including traces from this demo session via `evolvex-api`."

Show 5s auto-refresh. Open **Service Map** — real dependency graph from SigNoz.

### 5. Close (30s)

> "PostgreSQL is our investigation database. SigNoz is telemetry. Evolvex is the layer that connects them — so engineers investigate in minutes, not hours."

## What we never fake

- No hardcoded eBPF strings
- No mock logs/traces/service map in the UI
- No LLM summary without OpenAI + real timeline evidence
- Demo traces fallback removed from investigation pipeline

## Troubleshooting

| Issue | Fix |
|-------|-----|
| No investigations | Check webhook URL + `INVESTIGATION_OWNER_EMAIL` |
| Empty traces page | Run `pnpm signoz:loadgen` or use the app (OTel on API) |
| No AI summary | Set `OPENAI_API_KEY`, click Generate summary |
| GitHub deploy missing | Verify `GITHUB_WEBHOOK_SECRET` + HMAC on GitHub |
