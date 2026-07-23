/**
 * Polls SigNoz for OBI (OpenTelemetry eBPF Instrumentation) metrics and posts
 * structured events to Evolvex /webhooks/ebpf when thresholds are exceeded.
 *
 * Requires: SIGNOZ_* configured, OBI exporting OTLP metrics to SigNoz,
 * EVOLVEX_EBPF_WEBHOOK_URL (defaults to BASE_URL/webhooks/ebpf).
 *
 * Usage:
 *   pnpm obi:bridge
 *   pnpm obi:bridge -- --service payments-svc --once
 */
import { OBI_METRIC_CANDIDATES, classifyObiMetric, obiMetricToWebhookType } from "../packages/services/ebpf/obi-metrics";
import { querySignozMetricRange } from "../packages/services/ebpf/signoz-metrics";
import { getDefaultServiceName, isSignozConfigured } from "../packages/services/signoz-env";

type ThresholdRule = {
  kind: ReturnType<typeof classifyObiMetric>;
  minValue: number;
};

function parseArgs(argv: string[]) {
  const serviceIdx = argv.indexOf("--service");
  const service =
    serviceIdx >= 0 ? argv[serviceIdx + 1] : process.env.SIGNOZ_DEFAULT_SERVICE_NAME?.trim() || getDefaultServiceName();
  const once = argv.includes("--once");
  const intervalSec = Number.parseInt(process.env.OBI_BRIDGE_INTERVAL_SEC ?? "60", 10);

  return { service: service ?? "payments-svc", once, intervalSec };
}

function thresholdForMetric(metricName: string): number | null {
  const kind = classifyObiMetric(metricName);
  if (!kind) return null;

  const rules: Record<NonNullable<ThresholdRule["kind"]>, number> = {
    tcp_rtt: Number.parseFloat(process.env.OBI_TCP_RTT_THRESHOLD_SEC ?? "0.25"),
    tcp_failed: Number.parseFloat(process.env.OBI_TCP_FAILED_THRESHOLD ?? "1"),
    network_flow: Number.parseFloat(process.env.OBI_NETWORK_FLOW_THRESHOLD ?? "1000000"),
    http_latency: Number.parseFloat(process.env.OBI_HTTP_LATENCY_THRESHOLD_SEC ?? "0.8"),
    rpc_latency: Number.parseFloat(process.env.OBI_RPC_LATENCY_THRESHOLD_SEC ?? "0.8"),
  };

  return rules[kind];
}

async function postEbpfEvent(payload: Record<string, unknown>) {
  const baseUrl = process.env.BASE_URL?.trim() || "http://localhost:8000";
  const webhookUrl = process.env.EVOLVEX_EBPF_WEBHOOK_URL?.trim() || `${baseUrl.replace(/\/+$/, "")}/webhooks/ebpf`;
  const secret = process.env.EBPF_WEBHOOK_SECRET?.trim();

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret) headers["x-evolvex-ebpf-secret"] = secret;

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`eBPF webhook failed (${response.status}): ${text}`);
  }

  return response.json();
}

async function scanOnce(service: string) {
  const endMs = Date.now();
  const startMs = endMs - 15 * 60_000;
  let posted = 0;

  for (const metricName of OBI_METRIC_CANDIDATES) {
    const threshold = thresholdForMetric(metricName);
    if (threshold == null) continue;

    const samples = await querySignozMetricRange({
      metricName,
      serviceName: service,
      startMs,
      endMs,
    });

    for (const sample of samples) {
      if (sample.value < threshold) continue;

      const webhookType = obiMetricToWebhookType(sample.metricName);
      await postEbpfEvent({
        type: webhookType,
        source: "obi",
        service,
        metric: sample.metricName,
        value: sample.value,
        unit: metricName.includes("seconds") ? "s" : metricName.includes("bytes") ? "bytes" : "1",
        message: `OBI metric ${sample.metricName} = ${sample.value} exceeded threshold ${threshold} for ${service}`,
        timestamp: sample.timestamp,
        metadata: {
          collector: "opentelemetry-ebpf-instrumentation",
          threshold,
          windowMinutes: 15,
        },
      });

      posted += 1;
      console.log(`[obi-bridge] Posted ${webhookType} for ${service} (${sample.metricName}=${sample.value})`);
    }
  }

  if (posted === 0) {
    console.log(`[obi-bridge] No OBI anomalies above threshold for ${service} (last 15m)`);
  }
}

async function main() {
  if (!isSignozConfigured()) {
    console.error("[obi-bridge] SigNoz is not configured. Set SIGNOZ_CLOUD_URL and SIGNOZ_API_KEY.");
    process.exit(1);
  }

  const { service, once, intervalSec } = parseArgs(process.argv.slice(2));
  console.log(`[obi-bridge] Watching OBI metrics for ${service} (interval ${intervalSec}s)`);

  if (once) {
    await scanOnce(service);
    return;
  }

  for (;;) {
    try {
      await scanOnce(service);
    } catch (err) {
      console.error("[obi-bridge] Scan failed:", err instanceof Error ? err.message : err);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalSec * 1000));
  }
}

main().catch((err) => {
  console.error("[obi-bridge] Fatal:", err);
  process.exit(1);
});
