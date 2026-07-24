/**
 * Prints localtunnel setup for SigNoz webhooks and reminds you to update .env.
 * Run while `pnpm dev` is serving the API on port 8000.
 *
 * Usage:
 *   pnpm tunnel:refresh
 *   pnpm tunnel:refresh --subdomain evolvex-ishaan
 */
const args = process.argv.slice(2);
const subdomainIndex = args.indexOf("--subdomain");
const subdomain = subdomainIndex >= 0 ? args[subdomainIndex + 1] : process.env.LOCALTUNNEL_SUBDOMAIN ?? "evolvex-dev";

console.log("\nEvolvex webhook tunnel setup\n");
console.log("1. Ensure API is running: pnpm dev  (port 8000)");
console.log("2. In a new terminal, run:");
console.log("");
if (subdomain) {
  console.log(`   npx localtunnel --port 8000 --subdomain ${subdomain}`);
  console.log("");
  console.log("3. Set in .env:");
  console.log(`   SIGNOZ_WEBHOOK_PUBLIC_URL=https://${subdomain}.loca.lt/webhooks/signoz`);
} else {
  console.log("   npx localtunnel --port 8000");
  console.log("");
  console.log("3. Copy the printed https URL and set:");
  console.log("   SIGNOZ_WEBHOOK_PUBLIC_URL=<url>/webhooks/signoz");
}
console.log("");
console.log("4. Restart dev server, then verify: pnpm wiring:check");
console.log("");
console.log("Optional: set GITHUB_TOKEN in .env for pinpoint + deploy correlation.");
console.log("");
