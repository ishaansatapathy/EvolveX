# Evolvex wiring checklist (local demo → 80%+ integration health)

> **Judges / evaluators on hosted Evolvex:** start with **[SETUP.md](../SETUP.md)** — browser-only onboarding
> with your own SigNoz, OTel in your app, and per-workspace webhook credentials. **Do not** use this file as
> your primary guide unless you are the **operator** deploying Evolvex or running locally.

> **5-minute live script:** [DEMO.md](../DEMO.md) · **Architecture:** [ARCHITECTURE.md](./ARCHITECTURE.md)

---

## Who reads this file?

| Role | Primary doc |
|------|-------------|
| **Judge / hackathon evaluator** | [SETUP.md](../SETUP.md) |
| **Operator (Railway/Vercel deploy)** | This file + `.env.production.example` |
| **Local developer** | This file + `.env.example` |

---

## 1. Required for core demo (~15 min) — operator / local dev

| Variable | Where to get it | Unlocks |
|----------|-----------------|--------|
| `DATABASE_URL` | Neon dashboard (pooled URL) | Investigations persist |
| `DATABASE_URL_UNPOOLED` | Neon dashboard (direct URL) | `pnpm db:migrate` |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Generate random 32+ bytes | Auth |
| `INTEGRATION_SECRETS_KEY` | Generate random 32+ bytes | **Required in production** — encrypts workspace vault (SigNoz/GitHub/Slack secrets in Postgres) |
| `SIGNOZ_CLOUD_URL` | SigNoz Cloud → Settings | API queries, traces, logs |
| `SIGNOZ_API_KEY` | SigNoz → Settings → API Keys | Same |
| `SIGNOZ_INGESTION_KEY` | SigNoz → Settings → Ingestion | OTel self-instrumentation of `evolvex-api` |
| `OPENAI_API_KEY` | platform.openai.com | AI root-cause summary |
| `BASE_URL` | Your public API URL | Webhooks, OAuth callbacks |
| `SIGNOZ_WEBHOOK_PUBLIC_URL` | `{BASE_URL}/webhooks/signoz` | Shown in Settings when generating webhook credentials |
| `GOOGLE_OAUTH_*` | Google Cloud Console | Sign-in |

| Variable | When needed |
|----------|-------------|
| `INVESTIGATION_OWNER_EMAIL` | **Legacy only** — fallback owner for webhook cases when no per-workspace SigNoz password is used. **Not for multi-tenant judge demos.** |

---

## 2. SigNoz alert webhook — preferred: per-workspace (multi-tenant)

**Judges and SaaS users (browser only):**

1. Settings → Connect SigNoz (save cloud URL + API key)
2. Click **Generate webhook credentials**
3. SigNoz → Notification Channels → Webhook → paste URL, username (`evolvex`), and **your workspace password**
4. Attach channel to an alert rule

Each workspace gets its own password (`secret_hash` indexed lookup) — alerts route to that tenant only.
See [ADR-005](./adr/0005-org-integration-vault.md).

**Legacy single-tenant / local dev fallback:**

```powershell
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

```env
SIGNOZ_WEBHOOK_SECRET=<generated>
INVESTIGATION_OWNER_EMAIL=your-login@email.com
```

Use the same password in SigNoz Basic Auth. Cases assign via `INVESTIGATION_OWNER_EMAIL` when no
per-workspace vault secret matches.

---

## 3. Expose local API for webhooks (local dev only)

Pick one:

- **localtunnel:** `npx localtunnel --port 8000 --subdomain your-name`
- **ngrok:** `ngrok http 8000`

```env
BASE_URL=https://your-tunnel.loca.lt
SIGNOZ_WEBHOOK_PUBLIC_URL=https://your-tunnel.loca.lt/webhooks/signoz
```

---

## 4. GitHub deploy correlation

**Preferred — workspace vault (Settings):**

1. Settings → GitHub → PAT + `owner/repo` → Save
2. Evolvex can auto-register push webhook on your repo

**Legacy env fallback:**

```env
GITHUB_TOKEN=ghp_...
GITHUB_WEBHOOK_SECRET=<generated>
```

Manual webhook: `https://your-api/webhooks/github` · Event: **Push** · Secret: `GITHUB_WEBHOOK_SECRET`

> GitHub **enriches** cases (deploy timeline, pinpoint) — it does **not** create investigations. SigNoz alerts do.

---

## 5. Other integrations — prefer Settings over env

| Integration | Settings path | Legacy env fallback |
|-------------|---------------|---------------------|
| Slack | Add to Slack OAuth or manual webhook URL | `SLACK_WEBHOOK_URL` |
| PagerDuty | Routing key paste | `PAGERDUTY_ROUTING_KEY` |
| Jira | Base URL + email + API token + project key | `JIRA_*` |
| Kubernetes | Connect Kubernetes → Helm command | `KUBERNETES_WEBHOOK_SECRET` |
| eBPF / Feature flags / CI-CD | Connect signal webhooks | `EBPF_WEBHOOK_SECRET`, etc. |
| Plugins | Settings → Plugins → Install | — |

Operator once for Slack OAuth: `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, redirect
`{BASE_URL}/integrations/slack/callback`

---

## 6. Verify

1. Open `/settings` → Integration Health should be **~70–90%**
2. Test buttons: SigNoz API, Database, GitHub, OpenAI, Slack, Jira (when connected)
3. Fire alert: `pnpm signoz:p99` or `pnpm signoz:loadgen` (needs `SIGNOZ_INGESTION_KEY` in `.env`)
4. Open `/investigations` → timeline, narrative, completeness, postmortem export
5. Export menu → **Create SigNoz dashboard** (needs Editor/Admin API key)

---

## 7. Optional env vars

| Variable | Purpose |
|----------|---------|
| `REDIS_URL` | Distributed rate limiting across API instances |
| `EVOLVEX_API_KEY` | `/api/v1/sdk/*` server-side event ingestion |
| `EVOLVEX_COLLECTOR_KEY` | `/telemetry-intelligence/*` collector agent |
| `pnpm obi:up` | OBI eBPF demo (Linux Docker) → SigNoz OTLP |
| `.cursor/mcp.json` | Query SigNoz from Cursor — [SIGNOZ-MCP.md](./SIGNOZ-MCP.md) |

Run `pnpm wiring:check` before deploy. Run `pnpm wiring:secrets` to generate random webhook/JWT values.

---

## See also

| Doc | Purpose |
|-----|---------|
| [SETUP.md](../SETUP.md) | Full judge onboarding |
| [DEMO.md](../DEMO.md) | 5-minute demo script |
| [HACKATHON.md](../HACKATHON.md) | SigNoz capability map |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Multi-tenancy + zero-fake-data |
| [adr/0005-org-integration-vault.md](./adr/0005-org-integration-vault.md) | Vault + webhook secret design |
