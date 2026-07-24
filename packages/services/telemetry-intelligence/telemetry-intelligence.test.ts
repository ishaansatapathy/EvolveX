import { describe, expect, it } from "vitest";

import { classifySignozAlert } from "../signoz/alert-classifier";
import { computeAdaptiveTailSampling } from "./sampling/adaptive-tail";
import { computeChangeAwareSampling } from "./sampling/change-aware";
import { computeContextAwareSampling, mergeSamplingPolicies } from "./sampling/context-aware";
import { generateCollectorConfig } from "./collector/config-generator";

describe("adaptive tail sampling (#1)", () => {
  it("boosts to incident mode for critical alerts", () => {
    const classification = classifySignozAlert({
      status: "firing",
      labels: { alertname: "HighErrorRate", severity: "critical" },
      annotations: { summary: "5xx errors spiking" },
      startsAt: new Date().toISOString(),
    });

    const policy = computeAdaptiveTailSampling({
      serviceName: "payments-svc",
      classification,
      severity: "critical",
    });

    expect(policy.mode).toBe("incident");
    expect(policy.sampleRate).toBe(1);
  });

  it("elevates sampling for p99 latency alerts", () => {
    const classification = classifySignozAlert({
      status: "firing",
      labels: { alertname: "HighP99Latency" },
      annotations: { summary: "p99 latency above 800ms" },
      startsAt: new Date().toISOString(),
    });

    const policy = computeAdaptiveTailSampling({
      serviceName: "payments-svc",
      classification,
      severity: "warning",
    });

    expect(policy.mode).toBe("elevated");
    expect(policy.sampleRate).toBeGreaterThan(0.1);
  });
});

describe("change-aware sampling (#8)", () => {
  it("sets change_boost mode after deploy", () => {
    const policy = computeChangeAwareSampling({
      serviceName: "payments-svc",
      changeType: "deploy",
      sha: "abc123",
    });

    expect(policy.mode).toBe("change_boost");
    expect(policy.sampleRate).toBe(1);
    expect(policy.metadata?.changeType).toBe("deploy");
  });
});

describe("context-aware sampling (#7)", () => {
  it("merges policies by highest sample rate", () => {
    const classification = classifySignozAlert({
      status: "firing",
      labels: { alertname: "HighP99Latency" },
      annotations: { summary: "p99 latency" },
      startsAt: new Date().toISOString(),
    });

    const adaptive = computeAdaptiveTailSampling({
      serviceName: "checkout-api",
      classification,
      severity: "critical",
    });
    const contextual = computeContextAwareSampling({
      serviceName: "checkout-api",
      classification,
      severity: "critical",
      graphDepth: 3,
      isCriticalService: true,
    });

    const merged = mergeSamplingPolicies([adaptive, contextual]);
    expect(merged?.sampleRate).toBeGreaterThanOrEqual(Math.max(adaptive.sampleRate, contextual.sampleRate));
  });
});

describe("collector config generator (#2)", () => {
  it("renders OTel collector YAML with enrichment processor", () => {
    const yaml = generateCollectorConfig({
      evolvexApiUrl: "http://localhost:8000",
      signozOtlpEndpoint: "ingest.signoz.cloud:4317",
      activePolicies: [
        {
          serviceName: "payments-svc",
          mode: "incident",
          sampleRate: 1,
          reason: "test",
          triggerSource: "test",
          expiresAt: new Date(),
        },
      ],
    });

    expect(yaml).toContain("evolvex/enrichment");
    expect(yaml).toContain("tail_sampling");
    expect(yaml).toContain("ingest.signoz.cloud:4317");
  });
});
