const baseUrl = (process.env.API_INTERNAL_URL ?? process.env.BASE_URL ?? "http://localhost:8000").replace(/\/+$/, "");
const pluginSecret = process.env.PLUGIN_WEBHOOK_SECRET?.trim();
const pluginId = process.env.PLUGIN_ID?.trim() || "custom-events";

async function main() {
  if (!pluginSecret) {
    console.error("Set PLUGIN_WEBHOOK_SECRET from Settings → Plugins after installing a plugin.");
    process.exit(1);
  }

  const url = `${baseUrl}/webhooks/plugins/${pluginId}`;
  const payload =
    pluginId === "prometheus-alertmanager"
      ? {
          status: "firing",
          externalURL: "http://prometheus:9090",
          commonLabels: { alertname: "HighErrorRate", service: "payments-svc" },
          alerts: [
            {
              status: "firing",
              labels: { alertname: "HighErrorRate", service: "payments-svc", severity: "critical" },
              annotations: {
                summary: "Error rate above 20% for 5m",
                description: "payments-svc returning 5xx on /checkout",
              },
              startsAt: new Date().toISOString(),
            },
          ],
        }
      : pluginId === "datadog-import"
        ? {
            alert_title: "High error rate on payments-svc",
            alert_body: "Error rate exceeded threshold in production",
            service: "payments-svc",
            tags: "env:production,service:payments-svc",
          }
        : pluginId === "security-scanner"
          ? {
              finding: "Public S3 bucket exposure",
              severity: "high",
              resource: "s3://prod-checkout-assets",
              service: "payments-svc",
              cve: "CVE-2026-1234",
              remediation: "Enable bucket policy deny-insecure-transport",
            }
          : {
              title: "Plugin custom event",
              detail: "Pushed from pnpm plugin:webhook-demo",
              service: "payments-svc",
              metadata: { demo: true, feature: "#58", pluginId },
            };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-evolvex-plugin-secret": pluginSecret,
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json().catch(() => ({}));
  console.log(`POST ${url} → ${response.status}`);
  console.log(JSON.stringify(body, null, 2));

  if (!response.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
