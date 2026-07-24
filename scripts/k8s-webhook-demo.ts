/**
 * Simulates a kubernetes-event-exporter payload against the local API.
 * Usage: pnpm k8s:webhook-demo
 */
const API_URL = process.env.API_INTERNAL_URL?.trim() || "http://localhost:8000";
const SECRET = process.env.KUBERNETES_WEBHOOK_SECRET?.trim() ?? "";

const payload = {
  reason: "OOMKilled",
  message: "Container payments-svc exceeded memory limit (512Mi)",
  type: "Warning",
  involvedObject: {
    kind: "Pod",
    name: "payments-svc-7d8f9c4b2-xk9lm",
    namespace: "production",
  },
  lastTimestamp: new Date().toISOString(),
};

async function main() {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (SECRET) headers["x-evolvex-k8s-secret"] = SECRET;

  const response = await fetch(`${API_URL.replace(/\/+$/, "")}/webhooks/kubernetes`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  console.log(`[k8s:webhook-demo] HTTP ${response.status}`);
  console.log(text);

  if (!response.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[k8s:webhook-demo] Failed:", error);
  process.exit(1);
});
