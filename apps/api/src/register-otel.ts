/**
 * Registers OpenTelemetry export to SigNoz when SIGNOZ_INGESTION_KEY is set.
 * No-op when ingestion is not configured — never emits synthetic spans.
 */
export function registerApiOtel(): void {
  const ingestionKey = process.env.SIGNOZ_INGESTION_KEY?.trim();
  if (!ingestionKey || process.env.OTEL_SDK_DISABLED === "true") {
    return;
  }

  const ingestionUrl = (process.env.SIGNOZ_INGESTION_URL ?? "https://ingest.in2.signoz.cloud").replace(
    /\/+$/,
    "",
  );

  // Dynamic imports keep startup fast when OTel is disabled.
  void import("@opentelemetry/sdk-node")
    .then(({ NodeSDK }) =>
      Promise.all([
        import("@opentelemetry/auto-instrumentations-node"),
        import("@opentelemetry/exporter-trace-otlp-http"),
        import("@opentelemetry/resources"),
        import("@opentelemetry/semantic-conventions"),
      ]).then(([auto, exporter, resources, semconv]) => {
        const serviceName = process.env.OTEL_SERVICE_NAME?.trim() || "evolvex-api";

        const sdk = new NodeSDK({
          resource: resources.resourceFromAttributes({
            [semconv.ATTR_SERVICE_NAME]: serviceName,
            [semconv.ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env.NODE_ENV ?? "development",
          }),
          traceExporter: new exporter.OTLPTraceExporter({
            url: `${ingestionUrl}/v1/traces`,
            headers: {
              "signoz-ingestion-key": ingestionKey,
            },
          }),
          instrumentations: [auto.getNodeAutoInstrumentations()],
        });

        sdk.start();

        const shutdown = () => {
          void sdk.shutdown();
        };

        process.once("SIGTERM", shutdown);
        process.once("SIGINT", shutdown);
      }),
    )
    .catch((err) => {
      console.warn("[otel] Failed to initialize API telemetry", err);
    });
}
