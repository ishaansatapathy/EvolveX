/**
 * Registers OpenTelemetry export to SigNoz when SIGNOZ_INGESTION_KEY is set.
 * No-op when ingestion is not configured — never emits synthetic spans.
 *
 * Exports both traces (auto-instrumented HTTP/DB/etc. spans) and runtime
 * metrics (event-loop lag, GC, heap, CPU, HTTP histograms — from
 * @opentelemetry/auto-instrumentations-node's HostMetrics/RuntimeNodeMetrics)
 * alongside each other, matching the "traces + metrics + logs" three-pillar
 * story SigNoz is built for. Set OTEL_METRICS_EXPORTER=none to opt out of
 * metrics while keeping traces (mirrors the SigNoz MCP server's own env var
 * of the same name/semantics).
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
      ]).then(([auto, traceExporterMod, resources, semconv, metricExporterMod, sdkMetricsMod]) => {
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

        const sdk = new NodeSDK({
          resource,
          traceExporter: new traceExporterMod.OTLPTraceExporter({
            url: `${ingestionUrl}/v1/traces`,
            headers: {
              "signoz-ingestion-key": ingestionKey,
            },
          }),
          ...(metricReader ? { metricReader } : {}),
          instrumentations: [auto.getNodeAutoInstrumentations()],
        });

        sdk.start();

        console.log(
          `[otel:${serviceName}] started (traces${metricReader ? " + metrics" : ""}) → ${ingestionUrl}`,
        );

        const shutdown = () => {
          void sdk.shutdown();
        };

        process.once("SIGTERM", shutdown);
        process.once("SIGINT", shutdown);
      }),
    )
    .catch((err) => {
      console.warn(`[otel:${serviceName}] Failed to initialize`, err);
    });
}
