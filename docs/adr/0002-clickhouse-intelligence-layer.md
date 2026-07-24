# ADR-002: Optional ClickHouse Intelligence Layer

## Status
Accepted

## Context
Investigation pipelines can trigger expensive aggregations on trace data. SigNoz Query API covers most cases but latency grows with window size and service cardinality.

## Decision
Support optional direct ClickHouse reads against SigNoz tables/materialized views when `SIGNOZ_CLICKHOUSE_URL` is configured. Prefer MVs (`evolvex_service_error_summary_mv`, `evolvex_top_failing_endpoints_mv`) and fall back to native queries.

## Consequences
- Faster investigation insights when MVs exist
- Feature remains optional — local demos work without ClickHouse credentials
- MV DDL lives outside Evolvex core migrations (SigNoz-side concern)
