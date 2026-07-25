# ADR-0006: Rate Limiting and Abuse Protection

## Status

Accepted

## Context

Evolvex exposes public auth flows, expensive LLM/agent endpoints, and webhook receivers. A production incident investigation platform must protect against credential stuffing, runaway OpenAI spend, and webhook floods.

## Decision

Apply layered rate limits on tRPC and REST routes:

- Auth credential procedures: 40 requests / 15 minutes per IP
- Password reset: stricter windows
- Agent chat: per-user limits due to OpenAI cost
- Distributed counters via Redis when `REDIS_URL` is configured; in-process fallback otherwise

Return standard `429` responses with `RateLimit-*` headers.

## Consequences

- Multi-instance deploys should configure Redis for consistent limits (#38).
- Vitest runs skip rate limiting to keep tests fast.
