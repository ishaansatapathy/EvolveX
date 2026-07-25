# ADR-0007: Self-Observability Dogfooding

## Status

Accepted

## Context

Evolvex sells investigation intelligence built on observability. The API itself must be observable to debug slow investigations, webhook failures, and LLM latency in production.

## Decision

- Instrument `evolvex-api` with OpenTelemetry when `SIGNOZ_INGESTION_KEY` is set
- Export traces to the same SigNoz tenant used for customer telemetry
- Expose operational counters and OTel status via `trpc.observability.self`
- Link operators to SigNoz service view for distributed trace inspection (#39/#40)

## Consequences

- Dogfooding story is credible in demos: Evolvex traces appear beside application telemetry.
- OTel remains opt-in via env vars; local dev works without ingestion keys.
