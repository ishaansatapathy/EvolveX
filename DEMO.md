# Evolvex — 5-minute judge demo

> Wiring checklist: [docs/WIRING.md](./docs/WIRING.md)

## Before the demo

- [ ] `.env` production values set on Railway (API) and Vercel (web) — or local `.env` wired per WIRING.md
- [ ] SigNoz alert configured → webhook URL live (`SIGNOZ_WEBHOOK_SECRET` set)
- [ ] GitHub webhook on repo → `/webhooks/github` (`GITHUB_WEBHOOK_SECRET` set)
- [ ] `GITHUB_TOKEN` set for pinpoint + deploy diff
- [ ] `OPENAI_API_KEY` set for AI summary
- [ ] `SIGNOZ_INGESTION_KEY` set so API self-instruments as `evolvex-api`
- [ ] `/settings` → Integration Health **≥70%**

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
- **Incident Narrative** — chronological story ("3 minutes later, slow trace…") with `[T1]` citation jumps
- **Evidence Completeness** — what's collected vs missing (GitHub, K8s, logs, traces)
- **Structured Supporting Evidence** — Deploy / Traces / Logs / Metrics / Infrastructure sections
- **Evidence Timeline** — ALERT → METRIC → TRACE from SigNoz API
- **AI Root Cause** — OpenAI markdown with clickable `[T1]` / `[E1]` citations
- **Pinpoint** — exact file:line from error logs + GitHub deploy correlation
- **Suggest fix** — optional LLM patch preview (user copies manually)
- **Export postmortem ↓** — download shareable `.md` for Slack/Notion
- **Engineer Notes** — add a live note

### 4. Live telemetry (60s)

Navigate to **Traces** (no investigation filter):

> "This is live SigNoz data — including traces from this demo session via `evolvex-api`."

Show 5s auto-refresh. Open **Service Map** — real dependency graph from SigNoz.

### 5. Close (30s)

> "PostgreSQL is our investigation database. SigNoz is telemetry. Evolvex is the layer that connects them — so engineers investigate in minutes, not hours."

Show **Settings → Integration Health** dashboard (10 integrations, live probes).

## What we never fake

- No hardcoded eBPF strings
- No mock logs/traces/service map in the UI
- No LLM summary without OpenAI + real timeline evidence
- No incident narrative without real timeline entries
- Demo traces fallback removed from investigation pipeline

## Troubleshooting

| Issue | Fix |
|-------|-----|
| No investigations | Check webhook URL + `SIGNOZ_WEBHOOK_SECRET` + `INVESTIGATION_OWNER_EMAIL` — see [WIRING.md](./docs/WIRING.md) |
| Integration health partial | Settings → copy webhook URLs, set missing secrets |
| Empty traces page | Run `pnpm signoz:loadgen` or use the app (OTel on API) |
| No AI summary | Set `OPENAI_API_KEY`, click Generate summary |
| GitHub deploy missing | Verify `GITHUB_WEBHOOK_SECRET` + HMAC on GitHub |
| Pinpoint empty | Set `GITHUB_TOKEN` with `repo` read scope |
