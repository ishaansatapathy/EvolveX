import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildDashboardUrl,
  buildServiceOverviewDashboardPayload,
  createDashboard,
  deleteDashboard,
  getDashboard,
  listDashboards,
  updateDashboard,
} from "./dashboards-api";

const TEST_CONFIG = { cloudUrl: "https://signoz.example.com", apiKey: "test-key" };

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

type QueryDataLike = {
  dataSource: string;
  aggregateOperator: string;
  aggregateAttribute: { key: string };
  filters: { items: Array<{ key: { key: string }; op: string; value?: string }>; op: string };
};

function firstQueryData(widget: Record<string, unknown>): QueryDataLike {
  const query = widget.query as { builder: { queryData: QueryDataLike[] } };
  return query.builder.queryData[0]!;
}

describe("buildServiceOverviewDashboardPayload", () => {
  it("builds three traces widgets scoped to the given service", () => {
    const payload = buildServiceOverviewDashboardPayload("payments-svc");
    const widgets = payload.widgets as Array<Record<string, unknown>>;

    expect(widgets).toHaveLength(3);
    expect(widgets.map((w) => w.id)).toEqual(["request-rate", "error-rate", "p99-latency"]);
    for (const widget of widgets) {
      const queryData = firstQueryData(widget);
      expect(queryData.dataSource).toBe("traces");
      expect(queryData.filters.items[0]).toEqual({ key: { key: "serviceName" }, op: "=", value: "payments-svc" });
    }
  });

  it("sets a p99 latency widget with a duration aggregate attribute", () => {
    const payload = buildServiceOverviewDashboardPayload("checkout-api");
    const widgets = payload.widgets as Array<Record<string, unknown>>;
    const p99 = widgets.find((w) => w.id === "p99-latency")!;
    const queryData = firstQueryData(p99);

    expect(queryData.aggregateOperator).toBe("p99");
    expect(queryData.aggregateAttribute.key).toBe("durationNano");
    expect(p99.yAxisUnit).toBe("ns");
  });

  it("adds a hasError filter for the error-rate widget", () => {
    const payload = buildServiceOverviewDashboardPayload("checkout-api");
    const widgets = payload.widgets as Array<Record<string, unknown>>;
    const errorWidget = widgets.find((w) => w.id === "error-rate")!;
    const queryData = firstQueryData(errorWidget);

    expect(queryData.filters.items).toContainEqual({ key: { key: "hasError" }, op: "=", value: "true" });
  });

  it("produces a layout entry per widget with non-overlapping x offsets", () => {
    const payload = buildServiceOverviewDashboardPayload("payments-svc");
    const layout = payload.layout as Array<Record<string, unknown>>;

    expect(layout).toHaveLength(3);
    expect(layout.map((l) => l.x)).toEqual([0, 4, 8]);
    expect(layout.map((l) => l.i)).toEqual(["request-rate", "error-rate", "p99-latency"]);
  });

  it("defaults title/description/tags and slugifies the name", () => {
    const payload = buildServiceOverviewDashboardPayload("payments-svc");
    expect(payload.title).toBe("payments-svc — Service Overview (Evolvex)");
    expect(payload.name).toMatch(/^payments-svc.*service-overview.*evolvex$/);
    expect(payload.tags).toEqual(["evolvex", "auto-generated"]);
  });

  it("honors custom title/description/tags overrides", () => {
    const payload = buildServiceOverviewDashboardPayload("payments-svc", {
      title: "Custom title",
      description: "Custom description",
      tags: ["custom"],
    });
    expect(payload.title).toBe("Custom title");
    expect(payload.description).toBe("Custom description");
    expect(payload.tags).toEqual(["custom"]);
  });
});

describe("buildDashboardUrl", () => {
  it("builds a browsable dashboard URL under the configured cloud URL", () => {
    expect(buildDashboardUrl(TEST_CONFIG, "abc-123")).toBe("https://signoz.example.com/dashboard/abc-123");
  });

  it("strips trailing slashes from the base URL", () => {
    expect(buildDashboardUrl({ ...TEST_CONFIG, cloudUrl: "https://signoz.example.com/" }, "abc-123")).toBe(
      "https://signoz.example.com/dashboard/abc-123",
    );
  });
});

describe("SigNoz dashboards API (mocked fetch)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("listDashboards parses a data-wrapped array", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [{ id: "d1", data: { title: "My dashboard", description: "desc", tags: ["a"] }, created_at: "t1" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const dashboards = await listDashboards(TEST_CONFIG);

    expect(dashboards).toEqual([
      { id: "d1", title: "My dashboard", description: "desc", tags: ["a"], createdAt: "t1", updatedAt: "" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://signoz.example.com/api/v1/dashboards",
      expect.objectContaining({ headers: expect.objectContaining({ "SIGNOZ-API-KEY": "test-key" }) }),
    );
  });

  it("getDashboard fetches a single dashboard by id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { id: "d1" } }));
    vi.stubGlobal("fetch", fetchMock);

    await getDashboard("d1", TEST_CONFIG);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://signoz.example.com/api/v1/dashboards/d1",
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it("createDashboard POSTs the payload and returns the created id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { id: "new-dash-1" } }));
    vi.stubGlobal("fetch", fetchMock);

    const payload = buildServiceOverviewDashboardPayload("payments-svc");
    const result = await createDashboard(payload, TEST_CONFIG);

    expect(result.id).toBe("new-dash-1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://signoz.example.com/api/v1/dashboards");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toMatchObject({ title: payload.title });
  });

  it("createDashboard raises a clear error on 403 (read-only API key)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "forbidden" }, false, 403));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createDashboard({ title: "x" }, TEST_CONFIG)).rejects.toThrow(/Editor\+ key/);
  });

  it("createDashboard throws if SigNoz returns no id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createDashboard({ title: "x" }, TEST_CONFIG)).rejects.toThrow(/returned no id/);
  });

  it("updateDashboard PUTs to the dashboard id endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { id: "d1" } }));
    vi.stubGlobal("fetch", fetchMock);

    await updateDashboard("d1", { title: "updated" }, TEST_CONFIG);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://signoz.example.com/api/v1/dashboards/d1");
    expect(init.method).toBe("PUT");
  });

  it("deleteDashboard DELETEs the dashboard id endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await deleteDashboard("d1", TEST_CONFIG);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://signoz.example.com/api/v1/dashboards/d1");
    expect(init.method).toBe("DELETE");
  });

  it("throws when SigNoz is not configured and no override is provided", async () => {
    await expect(listDashboards(null)).rejects.toThrow(/not configured/);
  });
});
