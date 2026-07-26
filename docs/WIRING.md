# Evolvex wiring checklist (local demo → 80%+ integration health)

Use this after `pnpm dev` when Settings shows partial integrations.

## 1. Required for core demo (~15 min)

| Variable | Where to get it | Unlocks |
|----------|-----------------|--------|
| `SIGNOZ_CLOUD_URL` | SigNoz Cloud → Settings | API queries, traces, logs |
| `SIGNOZ_API_KEY` | SigNoz → Settings → API Keys | Same |
| `SIGNOZ_INGESTION_KEY` | SigNoz → Settings → Ingestion | OTel self-instrumentation |
| `OPENAI_API_KEY` | platform.openai.com | AI root-cause summary |
| `DATABASE_URL` | Neon dashboard (pooled URL) | Investigations persist |
| `INVESTIGATION_OWNER_EMAIL` | Your login email | Webhook-created cases assign to you |

## 2. Auto investigations + deploy correlation (~15 min)

Generate secrets (any random string):

```powershell
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Add to `.env`:

```env
SIGNOZ_WEBHOOK_SECRET=<generated>
GITHUB_WEBHOOK_SECRET=<generated>
```

Expose local API (pick one):

- **localtunnel:** `npx localtunnel --port 8000 --subdomain your-name`
- **ngrok:** `ngrok http 8000`

Set in `.env`:

```env
BASE_URL=https://your-tunnel.loca.lt
SIGNOZ_WEBHOOK_PUBLIC_URL=https://your-tunnel.loca.lt/webhooks/signoz
```

### SigNoz alert webhook

SigNoz → Notification Channels → Webhook → URL:

`https://your-tunnel.loca.lt/webhooks/signoz`

### GitHub push webhook

Repo → Settings → Webhooks → Payload URL:

`https://your-tunnel.loca.lt/webhooks/github`

Secret = `GITHUB_WEBHOOK_SECRET`

Event: **Push**

## 3. Pinpoint + suggest fix (~5 min)

```env
GITHUB_TOKEN=ghp_...   # scopes: repo (read)
```

## 4. Verify

1. Open `/settings` → Integration Health should be **~70–90%**
2. Test buttons: SigNoz API, Database, GitHub, OpenAI
3. Fire alert: `pnpm signoz:p99` or seed: `pnpm investigation:seed`
4. Open `/investigations` → timeline, narrative, completeness, postmortem export
5. From an investigation's **Export** menu, try **Create SigNoz dashboard** — opens a live 3-widget
   dashboard scoped to the case's service (needs an Editor/Admin `SIGNOZ_API_KEY`, not Viewer)

## Optional

| Variable | Purpose |
|----------|---------|
| `KUBERNETES_WEBHOOK_SECRET` | Cluster change events (single-tenant/dev fallback — prefer Settings → Connect signal webhooks for a real workspace secret) |
| `EBPF_WEBHOOK_SECRET` | Direct eBPF webhook path |
| `FEATURE_FLAG_WEBHOOK_SECRET` | LaunchDarkly/Flagsmith flag-toggle webhook path — try with `pnpm feature-flag:webhook-demo` |
| `CICD_WEBHOOK_SECRET` | GitHub Actions/CircleCI/Jenkins pipeline-stage webhook path — try with `pnpm cicd:webhook-demo` |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | Self-service "Add to Slack" OAuth button in Settings (skip to use manual `SLACK_WEBHOOK_URL` paste instead) |
| `REDIS_URL` | Distributed rate limiting across multiple API instances |
| `pnpm obi:up` | OBI demo → SigNoz OTLP |
| `.cursor/mcp.json` | Query SigNoz from Cursor/Claude/Codex — see [SIGNOZ-MCP.md](./SIGNOZ-MCP.md) |

Prefer connecting per-workspace instead of env vars where possible: Settings → **Connect integrations** /
**Connect signal webhooks** issues scoped secrets with rotation, so no shared global secret spans
tenants (see [docs/ARCHITECTURE.md](./ARCHITECTURE.md#multi-tenancy-model)). Run `pnpm wiring:check` to
verify what's actually configured before a demo or deploy.

See also: [DEMO.md](../DEMO.md), [EBPF-OBI.md](./EBPF-OBI.md), [SIGNOZ-MCP.md](./SIGNOZ-MCP.md), [../HACKATHON.md](../HACKATHON.md), [ARCHITECTURE.md](./ARCHITECTURE.md)
