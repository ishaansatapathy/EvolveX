# ADR-004: Investigation Pipeline Cache

## Status
Accepted

## Context
Repeated pipeline runs (webhook retries, multiple engineers opening the same case) re-query SigNoz and rebuild derived artifacts unnecessarily.

## Decision
Cache pipeline outputs in `investigation_pipeline_cache` keyed by investigation fingerprint + pipeline version with TTL (default 24h). Invalidate on content changes and explicit refresh.

## Consequences
- Faster reopen and correlation refresh paths
- UI exposes cache status and manual refresh
- Cache misses still run full pipeline — no stale silent failures
