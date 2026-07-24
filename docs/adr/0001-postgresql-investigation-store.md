# ADR-001: PostgreSQL as Investigation System of Record

## Status
Accepted

## Context
Evolvex stores investigation case files, timeline entries, evidence, org integrations, audit logs, and telemetry intelligence policies. We needed a transactional store with JSON support and mature tooling for hackathon velocity and production path.

## Decision
Use PostgreSQL (Neon in cloud, Docker locally) via Drizzle ORM. SigNoz/ClickHouse remain telemetry stores; Evolvex does not duplicate raw traces/logs long-term.

## Consequences
- Strong consistency for investigations and RBAC
- Migrations via idempotent SQL bootstrap + Drizzle journal
- Heavy analytical queries delegated to SigNoz API or optional ClickHouse reads
