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

## Optional

| Variable | Purpose |
|----------|---------|
| `KUBERNETES_WEBHOOK_SECRET` | Cluster change events |
| `EBPF_WEBHOOK_SECRET` | Direct eBPF webhook path |
| `pnpm obi:up` | OBI demo → SigNoz OTLP |

See also: [DEMO.md](../DEMO.md), [EBPF-OBI.md](./EBPF-OBI.md)
