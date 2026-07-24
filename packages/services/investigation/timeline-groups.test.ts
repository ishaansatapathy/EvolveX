import { describe, expect, it } from "vitest";

import { groupTimelineEntries } from "./timeline-groups";

describe("timeline groups (#54)", () => {
  it("groups delivery chain events within the time window", () => {
    const groups = groupTimelineEntries([
      {
        id: "1",
        occurredAt: "2026-07-25T08:50:00.000Z",
        kind: "CHANGE",
        title: "CI/CD · test failed",
        detail: "integration-tests failed",
        source: "cicd-webhook",
      },
      {
        id: "2",
        occurredAt: "2026-07-25T08:52:00.000Z",
        kind: "CHANGE",
        title: "CI/CD: integration-tests passed",
        detail: "retry success",
        source: "cicd-webhook",
      },
      {
        id: "3",
        occurredAt: "2026-07-25T08:54:00.000Z",
        kind: "DEPLOY",
        title: "Deploy payments-svc",
        detail: "main pushed",
        source: "github-webhook",
      },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind).toBe("delivery_chain");
    expect(groups[0]?.entryCount).toBe(3);
    expect(groups[0]?.summary).toContain("→");
  });

  it("clusters log entries and highlights error-like signals", () => {
    const groups = groupTimelineEntries([
      {
        id: "l1",
        occurredAt: "2026-07-25T09:00:00.000Z",
        kind: "LOG",
        title: "ERROR Redis timeout",
        detail: "connection refused",
        source: "signoz",
      },
      {
        id: "l2",
        occurredAt: "2026-07-25T09:01:00.000Z",
        kind: "LOG",
        title: "WARN pool exhausted",
        detail: "retrying",
        source: "signoz",
      },
    ]);

    expect(groups[0]?.kind).toBe("log_cluster");
    expect(groups[0]?.highlighted).toBe(true);
  });

  it("keeps unrelated entries as singles", () => {
    const groups = groupTimelineEntries([
      {
        id: "a1",
        occurredAt: "2026-07-25T09:10:00.000Z",
        kind: "ALERT",
        title: "High latency",
        detail: "p99 exceeded",
        source: "signoz",
      },
      {
        id: "t1",
        occurredAt: "2026-07-25T09:20:00.000Z",
        kind: "TRACE",
        title: "Slow span",
        detail: "920ms",
        source: "signoz",
      },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.kind).toBe("alert_group");
    expect(groups[1]?.kind).toBe("telemetry_signals");
  });
});
