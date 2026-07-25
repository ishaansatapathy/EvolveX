# ADR-0008: Production Deploy Automation

## Status

Accepted

## Context

Hackathon-quality deploys rely on manual env checking. Production releases need repeatable validation before and after shipping API changes.

## Decision

Provide a deploy automation toolkit:

1. **Preflight** — `validateDeployEnvironment()` checks required production env vars (`pnpm deploy:preflight`)
2. **Smoke** — HTTP probes for `/health`, `/health/deep`, OpenAPI, and webhook endpoints (`pnpm deploy:smoke <url>`)
3. **Combined check** — `runDeployCheck()` merges preflight + smoke (`pnpm deploy:check`)
4. **CI** — GitHub Actions runs preflight tests on `main`; optional workflow_dispatch smoke against live URLs

Settings UI surfaces deploy check status for workspace owners (#45).

## Consequences

- Railway/Vercel deploys still use platform pipelines; Evolvex validates readiness rather than replacing host CI.
- Deep health may return `503` when optional integrations (GitHub, OpenAI) are unset — liveness `/health` remains the primary uptime probe.
