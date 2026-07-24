/**
 * Simulates an OBI/eBPF webhook payload against the local API.
 * Usage: pnpm ebpf:webhook-demo
 */
const API_URL = process.env.API_INTERNAL_URL?.trim() || "http://localhost:8000";
const SECRET = process.env.EBPF_WEBHOOK_SECRET?.trim() ?? "";

const payload = {
  type: "connect_latency",
  service: "payments-svc",
  metric: "obi_stat_tcp_rtt_seconds",
  value: 0.84,
  unit: "s",
  source: "obi",
  message: "OBI TCP RTT elevated — socket connect path degraded during tail latency incident",
  timestamp: new Date().toISOString(),
  metadata: {
    collector: "opentelemetry-ebpf-instrumentation",
    signalLayer: "network",
  },
};

async function main() {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (SECRET) headers["x-evolvex-ebpf-secret"] = SECRET;

  const response = await fetch(`${API_URL.replace(/\/+$/, "")}/webhooks/ebpf`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  console.log(`[ebpf:webhook-demo] HTTP ${response.status}`);
  console.log(text);

  if (!response.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[ebpf:webhook-demo] Failed:", error);
  process.exit(1);
});
