import { describe, expect, it } from "vitest";

import { classifyObiMetric, obiMetricToEvidence, obiMetricToWebhookType } from "./obi-metrics";

describe("obi-metrics", () => {
  it("classifies OBI network metrics", () => {
    expect(classifyObiMetric("obi_stat_tcp_rtt_seconds")).toBe("tcp_rtt");
    expect(classifyObiMetric("obi_stat_tcp_failed_connections_total")).toBe("tcp_failed");
  });

  it("maps OBI metrics to investigation evidence", () => {
    const evidence = obiMetricToEvidence(
      {
        metricName: "obi_stat_tcp_rtt_seconds",
        value: 0.42,
        timestamp: "2026-07-23T00:00:00.000Z",
      },
      "payments-svc",
    );

    expect(evidence?.kind).toBe("EBPF");
    expect(evidence?.source).toBe("obi-signoz");
    expect(evidence?.title).toContain("OBI");
  });

  it("maps OBI metrics to webhook types for the anomaly bridge", () => {
    expect(obiMetricToWebhookType("obi_stat_tcp_rtt_seconds")).toBe("connect_latency");
    expect(obiMetricToWebhookType("obi_network_flow_bytes_total")).toBe("tcp_retransmit");
  });
});
