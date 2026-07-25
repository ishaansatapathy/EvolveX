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

## Amendment: shared-secret webhook providers (kubernetes/ebpf/feature_flag/cicd)
The four "one shared secret authenticates the whole webhook" providers additionally store a
`secret_hash` (SHA-256 of the current secret) so an inbound webhook resolves its organization via an
indexed lookup instead of decrypting every `organization_integrations` row per request. Rotating a
secret keeps the old hash valid in `previous_secret_hash` for 24h (`previous_secret_expires_at`) so
in-flight agents/CI runners don't get a hard outage mid-rotation. The global env var
(`EBPF_WEBHOOK_SECRET`, etc.) remains a single-tenant/dev fallback only — a workspace that has
connected via Settings never resolves through it.
