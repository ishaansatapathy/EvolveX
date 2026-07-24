/**
 * Simulates a LaunchDarkly-style flag enable against the local API.
 * Usage: pnpm feature-flag:webhook-demo
 */
const API_URL = process.env.API_INTERNAL_URL?.trim() || "http://localhost:8000";
const SECRET = process.env.FEATURE_FLAG_WEBHOOK_SECRET?.trim() ?? "";

const payload = {
  kind: "flag",
  action: "update",
  title: "Turned on flag New Checkout",
  target: {
    key: "new-checkout",
    name: "New Checkout",
    tags: ["service:payments-svc"],
  },
  member: { email: "alex@example.com" },
  date: new Date().toISOString(),
};

async function main() {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (SECRET) headers["x-evolvex-flag-secret"] = SECRET;

  const response = await fetch(`${API_URL.replace(/\/+$/, "")}/webhooks/feature-flags`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  console.log(`[feature-flag:webhook-demo] HTTP ${response.status}`);
  console.log(text);

  if (!response.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[feature-flag:webhook-demo] Failed:", error);
  process.exit(1);
});
