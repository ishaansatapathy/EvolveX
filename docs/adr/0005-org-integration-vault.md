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
