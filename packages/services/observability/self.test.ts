import { describe, expect, it, vi, afterEach } from "vitest";

import { buildSelfObservabilitySnapshot } from "./self";

describe("self observability (#39/#40)", () => {
  const originalVitest = process.env.VITEST;

  afterEach(() => {
    delete process.env.OTEL_SDK_DISABLED;
    delete process.env.SIGNOZ_INGESTION_KEY;
    delete process.env.OTEL_SERVICE_NAME;
    if (originalVitest === undefined) delete process.env.VITEST;
    else process.env.VITEST = originalVitest;
  });

  it("reports OTel disabled when ingestion key is missing", async () => {
    delete process.env.VITEST;
    delete process.env.SIGNOZ_INGESTION_KEY;
    const snapshot = await buildSelfObservabilitySnapshot({ serviceName: "evolvex-api-test" });

    expect(snapshot.serviceName).toBe("evolvex-api-test");
    expect(snapshot.otel.enabled).toBe(false);
    expect(snapshot.rateLimiting.enabled).toBe(true);
  });

  it("reports OTel enabled when ingestion is configured", async () => {
    process.env.SIGNOZ_INGESTION_KEY = "test-ingestion-key";
    process.env.OTEL_SERVICE_NAME = "evolvex-api";

    const snapshot = await buildSelfObservabilitySnapshot();

    expect(snapshot.otel.enabled).toBe(true);
    expect(snapshot.otel.serviceName).toBe("evolvex-api");
  });
});
