/**
 * SigNoz Dashboards API client — closes the last gap in "SigNoz Cloud API"
 * coverage (Evolvex already drives query_range for traces/logs/metrics and
 * v2/rules + v1/channels for alerts; dashboards were the one primitive left
 * as "view only in the SigNoz UI").
 *
 * Uses the same `POST/GET/PUT/DELETE /api/v1/dashboards[/{id}]` routes the
 * official Terraform provider (`signoz_dashboard` resource) and `dashboards`
 * export/import tooling use — the stable, documented-by-usage legacy v4
 * widget schema, not the newer Perses-based `/api/v2/dashboards` API (still
 * evolving upstream as of this writing). See
 * https://github.com/ksoviero/terraform-provider-signoz/blob/main/docs/DASHBOARD_API.md
 * and SigNoz/dashboards (the official community dashboard JSON repo) for the
 * widget shape this mirrors.
 */
import { getSignozConfig, type SignozConfig } from "../signoz-env";

function normalizeBaseUrl(url: string) {
  return url.replace(/\/+$/, "");
}

function authHeaders(config: SignozConfig): Record<string, string> {
  return {
    "SIGNOZ-API-KEY": config.apiKey,
    "Content-Type": "application/json",
  };
}

function requireConfig(configOverride?: SignozConfig | null): SignozConfig {
  const config = configOverride ?? getSignozConfig();
  if (!config) {
    throw new Error("SigNoz is not configured. Set SIGNOZ_CLOUD_URL and SIGNOZ_API_KEY.");
  }
  return config;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Builds the browsable SigNoz UI URL for a dashboard (same origin as the API/cloud URL). */
export function buildDashboardUrl(config: SignozConfig, dashboardId: string): string {
  return `${normalizeBaseUrl(config.cloudUrl)}/dashboard/${encodeURIComponent(dashboardId)}`;
}

export type SignozDashboardSummary = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

function parseDashboardSummary(row: Record<string, unknown>): SignozDashboardSummary {
  const data = (row.data && typeof row.data === "object" ? (row.data as Record<string, unknown>) : row) as Record<
    string,
    unknown
  >;
  const tags = Array.isArray(data.tags) ? data.tags.filter((t): t is string => typeof t === "string") : [];
  return {
    id: String(row.id ?? row.uuid ?? ""),
    title: String(data.title ?? "Untitled dashboard"),
    description: String(data.description ?? ""),
    tags,
    createdAt: String(row.created_at ?? row.createdAt ?? ""),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? ""),
  };
}

/** GET /api/v1/dashboards — every dashboard visible to the configured API key. */
export async function listDashboards(configOverride?: SignozConfig | null): Promise<SignozDashboardSummary[]> {
  const config = requireConfig(configOverride);
  const url = `${normalizeBaseUrl(config.cloudUrl)}/api/v1/dashboards`;
  const response = await fetch(url, { headers: authHeaders(config) });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Failed to list SigNoz dashboards (${response.status}): ${text.slice(0, 300)}`);
  }

  const json = safeJsonParse(text) as { data?: unknown[] } | unknown[] | null;
  const list = Array.isArray(json) ? json : (json?.data ?? []);
  if (!Array.isArray(list)) return [];

  return list
    .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
    .map(parseDashboardSummary);
}

/** GET /api/v1/dashboards/{id} — full dashboard document (layout + widgets + variables). */
export async function getDashboard(id: string, configOverride?: SignozConfig | null): Promise<unknown> {
  const config = requireConfig(configOverride);
  const url = `${normalizeBaseUrl(config.cloudUrl)}/api/v1/dashboards/${encodeURIComponent(id)}`;
  const response = await fetch(url, { headers: authHeaders(config) });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Failed to fetch SigNoz dashboard ${id} (${response.status}): ${text.slice(0, 300)}`);
  }
  return safeJsonParse(text);
}

/** POST /api/v1/dashboards — returns the created dashboard, including its generated `id`/`uuid`. */
export async function createDashboard(
  payload: Record<string, unknown>,
  configOverride?: SignozConfig | null,
): Promise<{ id: string; raw: unknown }> {
  const config = requireConfig(configOverride);
  const url = `${normalizeBaseUrl(config.cloudUrl)}/api/v1/dashboards`;
  const response = await fetch(url, {
    method: "POST",
    headers: authHeaders(config),
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(
        `Failed to create SigNoz dashboard "${payload.title ?? ""}" (403 forbidden): the configured ` +
          `SIGNOZ_API_KEY does not have Editor/Admin permissions in SigNoz. Generate an Editor+ key in ` +
          `SigNoz → Settings → API Keys. Raw response: ${text.slice(0, 300)}`,
      );
    }
    throw new Error(
      `Failed to create SigNoz dashboard "${payload.title ?? ""}" (${response.status}): ${text.slice(0, 500)}`,
    );
  }

  const json = safeJsonParse(text) as { data?: Record<string, unknown> } | Record<string, unknown> | null;
  const data = (json && typeof json === "object" && "data" in json ? json.data : json) as
    | Record<string, unknown>
    | undefined;
  const id = String(data?.id ?? data?.uuid ?? "");
  if (!id) {
    throw new Error(`SigNoz created the dashboard but returned no id — raw response: ${text.slice(0, 300)}`);
  }
  return { id, raw: json };
}

/** PUT /api/v1/dashboards/{id} — full-document replace (SigNoz has no PATCH for dashboards). */
export async function updateDashboard(
  id: string,
  payload: Record<string, unknown>,
  configOverride?: SignozConfig | null,
): Promise<unknown> {
  const config = requireConfig(configOverride);
  const url = `${normalizeBaseUrl(config.cloudUrl)}/api/v1/dashboards/${encodeURIComponent(id)}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: authHeaders(config),
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Failed to update SigNoz dashboard ${id} (${response.status}): ${text.slice(0, 500)}`);
  }
  return safeJsonParse(text);
}

/** DELETE /api/v1/dashboards/{id} */
export async function deleteDashboard(id: string, configOverride?: SignozConfig | null): Promise<void> {
  const config = requireConfig(configOverride);
  const url = `${normalizeBaseUrl(config.cloudUrl)}/api/v1/dashboards/${encodeURIComponent(id)}`;
  const response = await fetch(url, { method: "DELETE", headers: authHeaders(config) });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to delete SigNoz dashboard ${id} (${response.status}): ${text.slice(0, 300)}`);
  }
}

type TraceFilterItem = { key: { key: string }; op: string; value?: string };

function traceQueryData(input: {
  aggregateOperator: string;
  aggregateAttributeKey?: string;
  aggregateAttributeDataType?: "float64" | "int64";
  serviceName: string;
  extraFilters?: TraceFilterItem[];
}) {
  const items: TraceFilterItem[] = [
    { key: { key: "serviceName" }, op: "=", value: input.serviceName },
    ...(input.extraFilters ?? []),
  ];

  const aggregateAttribute = input.aggregateAttributeKey
    ? {
        key: input.aggregateAttributeKey,
        dataType: input.aggregateAttributeDataType ?? "float64",
        type: "tag",
        isColumn: true,
        id: `${input.aggregateAttributeKey}--${input.aggregateAttributeDataType ?? "float64"}--tag--true`,
      }
    : { id: "------false", key: "", dataType: "", type: "", isColumn: false };

  return {
    aggregateOperator: input.aggregateOperator,
    aggregateAttribute,
    dataSource: "traces",
    disabled: false,
    expression: "A",
    filters: { items, op: "AND" },
    groupBy: [],
    having: [],
    legend: "",
    limit: null,
    orderBy: [],
    queryName: "A",
    reduceTo: "avg",
    spaceAggregation: "sum",
    stepInterval: 60,
    timeAggregation: "rate",
  };
}

function traceWidget(input: {
  id: string;
  title: string;
  description: string;
  yAxisUnit: string;
  queryData: ReturnType<typeof traceQueryData>;
}) {
  return {
    id: input.id,
    title: input.title,
    description: input.description,
    panelTypes: "graph",
    yAxisUnit: input.yAxisUnit,
    isStacked: false,
    opacity: "1",
    nullZeroValues: "zero",
    timePreferance: "GLOBAL_TIME",
    query: {
      queryType: "builder",
      builder: { queryData: [input.queryData], queryFormulas: [] },
    },
  };
}

export type ServiceOverviewDashboardOptions = {
  title?: string;
  description?: string;
  tags?: string[];
};

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-+|-+$)/g, "") || "dashboard"
  );
}

/**
 * Builds a ready-to-POST `/api/v1/dashboards` payload with three traces-based
 * widgets (request rate, error rate, p99 latency) filtered to one service —
 * the same three signals `signoz:alert-setup` already wires alerts for, so a
 * generated dashboard and a generated alert always agree on what "healthy"
 * means for a service. Exported standalone so the shape can be unit-tested
 * without a live SigNoz instance (mirrors `buildThresholdAlertPayload` in
 * ops-api.ts).
 */
export function buildServiceOverviewDashboardPayload(
  serviceName: string,
  options?: ServiceOverviewDashboardOptions,
): Record<string, unknown> {
  const title = options?.title ?? `${serviceName} — Service Overview (Evolvex)`;

  const widgets = [
    traceWidget({
      id: "request-rate",
      title: "Request rate",
      description: `Spans per interval for ${serviceName}`,
      yAxisUnit: "none",
      queryData: traceQueryData({ aggregateOperator: "count", serviceName }),
    }),
    traceWidget({
      id: "error-rate",
      title: "Error rate",
      description: `Error spans per interval for ${serviceName}`,
      yAxisUnit: "none",
      queryData: traceQueryData({
        aggregateOperator: "count",
        serviceName,
        extraFilters: [{ key: { key: "hasError" }, op: "=", value: "true" }],
      }),
    }),
    traceWidget({
      id: "p99-latency",
      title: "p99 latency",
      description: `p99 span duration for ${serviceName}`,
      yAxisUnit: "ns",
      queryData: traceQueryData({
        aggregateOperator: "p99",
        aggregateAttributeKey: "durationNano",
        aggregateAttributeDataType: "float64",
        serviceName,
      }),
    }),
  ];

  const layout = widgets.map((widget, index) => ({
    h: 8,
    i: widget.id,
    moved: false,
    static: false,
    w: 4,
    x: index * 4,
    y: 0,
  }));

  return {
    title,
    name: slugify(title),
    description:
      options?.description ??
      `Auto-generated by Evolvex: request rate, error rate, and p99 latency for ${serviceName}.`,
    tags: options?.tags ?? ["evolvex", "auto-generated"],
    layout,
    widgets,
    variables: {},
  };
}
