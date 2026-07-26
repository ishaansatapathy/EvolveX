# ADR-005: Per-Organization Integration Vault

## Status
Accepted

## Context
Multi-tenant workspaces need isolated SigNoz/GitHub/Slack/Jira/Kubernetes credentials instead of a single global `.env` per deployment.

## Decision
Store integration secrets encrypted (AES-256-GCM) in `organization_integrations`. Resolution order: workspace vault → environment fallback. Owner-only mutations with audit events.

## Consequences
- SaaS-ready onboarding flows in Settings
- Helm/K8s onboarding can issue org-scoped webhook secrets
- Operators must set `INTEGRATION_SECRETS_KEY` (or `JWT_SECRET` in dev) for encryption

## Amendment: shared-secret webhook providers (kubernetes/ebpf/feature_flag/cicd/signoz)
The "one shared secret authenticates the whole webhook" providers additionally store a
`secret_hash` (SHA-256 of the current secret) so an inbound webhook resolves its organization via an
indexed lookup instead of decrypting every `organization_integrations` row per request. Rotating a
secret keeps the old hash valid in `previous_secret_hash` for 24h (`previous_secret_expires_at`) so
in-flight agents/CI runners don't get a hard outage mid-rotation. The global env var
(`EBPF_WEBHOOK_SECRET`, `SIGNOZ_WEBHOOK_SECRET`, etc.) remains a single-tenant/dev fallback only — a
workspace that has connected via Settings never resolves through it.

### SigNoz alert webhook (multi-tenant routing)
`signoz` joined the hash-indexed providers so each workspace can generate its own Basic-auth
password from Settings → Connect SigNoz → Generate webhook credentials. `POST /webhooks/signoz`
decodes the Basic-auth password, resolves the organization via
`resolveOrganizationIdForWebhookSecret("signoz", password)`, and attributes the investigation to
that organization's owner (`resolveOrganizationOwnerUserId`). This removes the need to re-point
the single global `INVESTIGATION_OWNER_EMAIL` every time a different tenant needs alert routing —
that env var remains only as the legacy fallback when no per-workspace secret matches.
