import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildThresholdAlertPayload,
  createThresholdAlertRule,
  listAlertRules,
  listNotificationChannels,
} from "./ops-api";

const TEST_CONFIG = { cloudUrl: "https://signoz.example.com", apiKey: "test-key" };

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("buildThresholdAlertPayload", () => {
  it("builds a v2alpha1 threshold_rule for p99 latency (ms → ns)", () => {
    const payload = buildThresholdAlertPayload(
      { alertName: "High p99", serviceName: "payments-svc", kind: "latency_p99", target: 800, channelNames: ["slack"] },
      ["slack"],
    );

    expect(payload.ruleType).toBe("threshold_rule");
    expect(payload.schemaVersion).toBe("v2alpha1");
    expect(payload.condition.compositeQuery.queries[0]?.spec.aggregations[0]?.expression).toBe(
      "p99(duration_nano)",
    );
    expect(payload.condition.thresholds.spec[0]?.target).toBe(800 * 1_000_000);
    expect(payload.condition.thresholds.spec[0]?.channels).toEqual(["slack"]);
    expect(payload.condition.compositeQuery.queries[0]?.spec.filter.expression).toContain(
      "service.name = 'payments-svc'",
    );
  });

  it("builds an error-rate rule without unit conversion", () => {
    const payload = buildThresholdAlertPayload(
      { alertName: "Error spike", serviceName: "checkout-api", kind: "error_rate", target: 5, channelNames: ["pagerduty"] },
      ["pagerduty"],
    );

    expect(payload.condition.compositeQuery.queries[0]?.spec.aggregations[0]?.expression).toBe("count()");
    expect(payload.condition.compositeQuery.queries[0]?.spec.filter.expression).toContain("has_error = true");
    expect(payload.condition.thresholds.spec[0]?.target).toBe(5);
  });

  it("escapes single quotes in service names", () => {
    const payload = buildThresholdAlertPayload(
      { alertName: "x", serviceName: "o'brien-svc", kind: "error_rate", target: 1, channelNames: [] },
      [],
    );
    expect(payload.condition.compositeQuery.queries[0]?.spec.filter.expression).toContain("o''brien-svc");
  });
});

describe("SigNoz ops API (mocked fetch)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("listNotificationChannels parses a data-wrapped array", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ data: [{ id: "1", name: "slack-oncall", type: "slack" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const channels = await listNotificationChannels(TEST_CONFIG);

    expect(channels).toEqual([{ id: "1", name: "slack-oncall", type: "slack" }]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://signoz.example.com/api/v1/channels",
      expect.objectContaining({ headers: expect.objectContaining({ "SIGNOZ-API-KEY": "test-key" }) }),
    );
  });

  it("listAlertRules parses nested data.rules", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { rules: [{ id: "r1" }] } }));
    vi.stubGlobal("fetch", fetchMock);

    const rules = await listAlertRules(TEST_CONFIG);
    expect(rules).toEqual([{ id: "r1" }]);
  });

  it("createThresholdAlertRule rejects when no channel matches", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: "1", name: "email-only", type: "email" }] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createThresholdAlertRule(
        {
          alertName: "High p99",
          serviceName: "payments-svc",
          kind: "latency_p99",
          target: 800,
          channelNames: ["slack-oncall"],
        },
        TEST_CONFIG,
      ),
    ).rejects.toThrow(/No matching SigNoz notification channel/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("createThresholdAlertRule verifies channels then POSTs the rule", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "1", name: "slack-oncall", type: "slack" }] }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "rule-123" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = (await createThresholdAlertRule(
      {
        alertName: "High p99",
        serviceName: "payments-svc",
        kind: "latency_p99",
        target: 800,
        channelNames: ["slack-oncall"],
      },
      TEST_CONFIG,
    )) as { data: { id: string } };

    expect(result.data.id).toBe("rule-123");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, postCall] = fetchMock.mock.calls;
    expect(postCall?.[0]).toBe("https://signoz.example.com/api/v2/rules");
    expect(postCall?.[1]?.method).toBe("POST");
  });
});
