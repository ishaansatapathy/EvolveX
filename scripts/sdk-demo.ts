import { createEvolvexClient } from "../packages/sdk/src/index.ts";

const baseUrl = (process.env.API_INTERNAL_URL ?? process.env.BASE_URL ?? "http://localhost:8000").replace(/\/+$/, "");
const apiKey = process.env.EVOLVEX_API_KEY?.trim();

async function main() {
  const client = createEvolvexClient({
    baseUrl: `${baseUrl}/api/v1/sdk`,
    apiKey,
  });

  console.log("Evolvex SDK demo (#57)\n");

  const info = await client.info();
  console.log("API:", info.version, info.endpoints.join(", "));

  const listed = await client.listInvestigations({ limit: 5 });
  console.log(`Investigations: ${listed.investigations.length}`);

  const push = await client.pushCustomEvent({
    title: "SDK custom event",
    detail: "Pushed from pnpm sdk:demo — internal tooling integration test",
    service: "payments-svc",
    source: "sdk-demo",
    metadata: { demo: true, feature: "#57" },
  });
  console.log("Push event:", push.message, push.attachedInvestigationIds);

  if (listed.investigations[0]) {
    const target = listed.investigations[0]!;
    const timeline = await client.createTimelineEvent(target.id, {
      title: "SDK timeline entry",
      detail: "Created via EvolvexClient.createTimelineEvent()",
      kind: "CHANGE",
      source: "sdk-demo",
    });
    console.log("Timeline entry:", timeline.timelineEntryId, "on", target.shortId);

    await client.attachMetadata(target.id, { sdkDemo: true, runAt: new Date().toISOString() }, "SDK metadata attached");
    console.log("Metadata attached to", target.shortId);
  }

  console.log("\nSDK demo complete.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
