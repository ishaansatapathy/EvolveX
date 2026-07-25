/**
 * Registers OpenTelemetry export to SigNoz when SIGNOZ_INGESTION_KEY is set.
 * No-op when ingestion is not configured — never emits synthetic spans.
 *
 * Exports all three observability pillars alongside each other:
 *  - traces: auto-instrumented HTTP/DB/etc. spans
 *  - metrics: event-loop lag, GC, heap, CPU, HTTP histograms (from
 *    @opentelemetry/auto-instrumentations-node's HostMetrics/RuntimeNodeMetrics)
 *  - logs: every @repo/logger (winston) call, auto-bridged to OTel log records
 *    with trace_id/span_id correlation via @opentelemetry/instrumentation-winston
 *    (bundled in getNodeAutoInstrumentations()) once a LoggerProvider is registered
 *
 * Set OTEL_METRICS_EXPORTER=none / OTEL_LOGS_EXPORTER=none to opt out of a pillar
 * while keeping the others (mirrors the SigNoz MCP server's own env var semantics).
 */
export function registerOtel(serviceName: string): void {
  const ingestionKey = process.env.SIGNOZ_INGESTION_KEY?.trim();
  if (!ingestionKey || process.env.OTEL_SDK_DISABLED === "true") {
    return;
  }

  const ingestionUrl = (process.env.SIGNOZ_INGESTION_URL ?? "https://ingest.in2.signoz.cloud").replace(
    /\/+$/,
    "",
  );
  const metricsEnabled = process.env.OTEL_METRICS_EXPORTER !== "none";
  const logsEnabled = process.env.OTEL_LOGS_EXPORTER !== "none";
  const metricExportIntervalMs =
    Number.parseInt(process.env.OTEL_METRIC_EXPORT_INTERVAL_MS ?? "", 10) || 60_000;

  void import("@opentelemetry/sdk-node")
    .then(({ NodeSDK }) =>
      Promise.all([
        import("@opentelemetry/auto-instrumentations-node"),
        import("@opentelemetry/exporter-trace-otlp-http"),
        import("@opentelemetry/resources"),
        import("@opentelemetry/semantic-conventions"),
        metricsEnabled ? import("@opentelemetry/exporter-metrics-otlp-http") : Promise.resolve(null),
        metricsEnabled ? import("@opentelemetry/sdk-metrics") : Promise.resolve(null),
        logsEnabled ? import("@opentelemetry/exporter-logs-otlp-http") : Promise.resolve(null),
        logsEnabled ? import("@opentelemetry/sdk-logs") : Promise.resolve(null),
      ]).then(
        ([auto, traceExporterMod, resources, semconv, metricExporterMod, sdkMetricsMod, logExporterMod, sdkLogsMod]) => {
          const resource = resources.resourceFromAttributes({
            [semconv.ATTR_SERVICE_NAME]: serviceName,
            [semconv.ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env.NODE_ENV ?? "development",
          });

          const metricReader =
            metricExporterMod && sdkMetricsMod
              ? new sdkMetricsMod.PeriodicExportingMetricReader({
                  exporter: new metricExporterMod.OTLPMetricExporter({
                    url: `${ingestionUrl}/v1/metrics`,
                    headers: {
                      "signoz-ingestion-key": ingestionKey,
                    },
                  }),
                  exportIntervalMillis: metricExportIntervalMs,
                })
              : undefined;

          const logRecordProcessor =
            logExporterMod && sdkLogsMod
              ? new sdkLogsMod.BatchLogRecordProcessor({
                  exporter: new logExporterMod.OTLPLogExporter({
                    url: `${ingestionUrl}/v1/logs`,
                    headers: {
                      "signoz-ingestion-key": ingestionKey,
                    },
                  }),
                })
              : undefined;

          const sdk = new NodeSDK({
            resource,
            traceExporter: new traceExporterMod.OTLPTraceExporter({
              url: `${ingestionUrl}/v1/traces`,
              headers: {
                "signoz-ingestion-key": ingestionKey,
              },
            }),
            ...(metricReader ? { metricReader } : {}),
            ...(logRecordProcessor ? { logRecordProcessors: [logRecordProcessor] } : {}),
            instrumentations: [auto.getNodeAutoInstrumentations()],
          });

          sdk.start();

          const pillars = ["traces", metricReader && "metrics", logRecordProcessor && "logs"]
            .filter(Boolean)
            .join(" + ");
          console.log(`[otel:${serviceName}] started (${pillars}) → ${ingestionUrl}`);

          const shutdown = () => {
            void sdk.shutdown();
          };

          process.once("SIGTERM", shutdown);
          process.once("SIGINT", shutdown);
        },
      ),
    )
    .catch((err) => {
      console.warn(`[otel:${serviceName}] Failed to initialize`, err);
    });
}
