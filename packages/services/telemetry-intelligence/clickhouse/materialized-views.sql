-- Feature #4 — ClickHouse materialized view templates for SigNoz schema.
-- Apply on self-hosted SigNoz ClickHouse when SIGNOZ_CLICKHOUSE_URL is configured.

CREATE MATERIALIZED VIEW IF NOT EXISTS evolvex_service_error_summary_mv
ENGINE = SummingMergeTree()
ORDER BY (service_name, window_start)
AS
SELECT
  serviceName AS service_name,
  toStartOfHour(timestamp) AS window_start,
  count() AS request_count,
  countIf(statusCode = 'Error') AS error_count,
  quantile(0.99)(durationNano) AS p99_duration_nano
FROM signoz_traces.signoz_index_v3
GROUP BY service_name, window_start;

CREATE MATERIALIZED VIEW IF NOT EXISTS evolvex_top_failing_endpoints_mv
ENGINE = SummingMergeTree()
ORDER BY (service_name, name, window_start)
AS
SELECT
  serviceName AS service_name,
  name,
  toStartOfHour(timestamp) AS window_start,
  countIf(statusCode = 'Error') AS error_count
FROM signoz_traces.signoz_index_v3
GROUP BY service_name, name, window_start;
