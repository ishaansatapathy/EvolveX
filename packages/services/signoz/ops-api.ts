/**
 * SigNoz ops workflows Evolvex implements natively via the same REST API the
 * SigNoz MCP server's alert tools wrap (`/api/v2/rules`, `/api/v1/channels`).
 * See docs/SIGNOZ-MCP.md for the mapping to `signoz_create_alert`,
 * `signoz_list_alert_rules`, `signoz_list_notification_channels`, and
 * `signoz_get_alert_history`.
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

export type SignozNotificationChannel = {
  id: string;
  name: string;
  type: string;
};

/** Mirrors the `signoz_list_notification_channels` MCP tool (GET /api/v1/channels). */
export async function listNotificationChannels(
  configOverride?: SignozConfig | null,
): Promise<SignozNotificationChannel[]> {
  const config = requireConfig(configOverride);
  const url = `${normalizeBaseUrl(config.cloudUrl)}/api/v1/channels`;
  const response = await fetch(url, { headers: authHeaders(config) });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Failed to list SigNoz notification channels (${response.status}): ${text.slice(0, 300)}`);
  }

  const json = safeJsonParse(text);
  const list = Array.isArray(json) ? json : ((json as { data?: unknown[] } | null)?.data ?? []);
  if (!Array.isArray(list)) return [];

  return list
    .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
    .map((row) => ({
      id: String(row.id ?? ""),
      name: String(row.name ?? ""),
      type: String(row.type ?? ""),
    }));
}

/** Mirrors the `signoz_list_alert_rules` MCP tool (GET /api/v2/rules). */
export async function listAlertRules(configOverride?: SignozConfig | null): Promise<unknown[]> {
  const config = requireConfig(configOverride);
  const url = `${normalizeBaseUrl(config.cloudUrl)}/api/v2/rules`;
  const response = await fetch(url, { headers: authHeaders(config) });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Failed to list SigNoz alert rules (${response.status}): ${text.slice(0, 300)}`);
  }

  const json = safeJsonParse(text) as { data?: { rules?: unknown[] } } | unknown[] | null;
  const list = Array.isArray(json) ? json : json?.data?.rules;
  return Array.isArray(list) ? list : [];
}

/** Mirrors the `signoz_get_alert_history` MCP tool (GET /api/v2/rules/{id}/history/timeline). */
export async function getAlertRuleHistory(
  ruleId: string,
  options?: { startMs?: number; endMs?: number; limit?: number },
  configOverride?: SignozConfig | null,
): Promise<unknown> {
  const config = requireConfig(configOverride);
  const params = new URLSearchParams();
  if (options?.startMs) params.set("start", String(options.startMs));
  if (options?.endMs) params.set("end", String(options.endMs));
  if (options?.limit) params.set("limit", String(options.limit));
  const query = params.toString();

  const url = `${normalizeBaseUrl(config.cloudUrl)}/api/v2/rules/${encodeURIComponent(ruleId)}/history/timeline${
    query ? `?${query}` : ""
  }`;
  const response = await fetch(url, { headers: authHeaders(config) });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Failed to fetch SigNoz alert history for rule ${ruleId} (${response.status}): ${text.slice(0, 300)}`,
    );
  }
  return safeJsonParse(text);
}

export type ThresholdAlertKind = "latency_p99" | "error_rate";

export type CreateThresholdAlertInput = {
  alertName: string;
  serviceName: string;
  kind: ThresholdAlertKind;
  /** Threshold value: milliseconds for latency_p99, span count for error_rate */
  target: number;
  evalWindow?: string;
  frequency?: string;
  channelNames: string[];
  severity?: "critical" | "warning" | "info";
};

/**
 * Builds a v2alpha1 `threshold_rule` payload for POST /api/v2/rules — the
 * same shape the `signoz_create_alert` MCP tool sends. Exported standalone
 * so it can be unit-tested without a live SigNoz instance.
 */
export function buildThresholdAlertPayload(input: CreateThresholdAlertInput, verifiedChannelNames: string[]) {
  const evalWindow = input.evalWindow ?? "5m";
  const frequency = input.frequency ?? "1m";
  const severity = input.severity ?? "critical";
  const isLatency = input.kind === "latency_p99";
  const filterExpression = `service.name = '${input.serviceName.replace(/'/g, "''")}'`;

  const querySpec = isLatency
    ? {
        name: "A",
        signal: "traces",
        aggregations: [{ expression: "p99(duration_nano)" }],
        filter: { expression: filterExpression },
      }
    : {
        name: "A",
        signal: "traces",
        aggregations: [{ expression: "count()" }],
        filter: { expression: `${filterExpression} AND has_error = true` },
      };

  // ClickHouse stores span duration in nanoseconds; convert the ms threshold operators use.
  const targetValue = isLatency ? input.target * 1_000_000 : input.target;

  return {
    alert: input.alertName,
    alertType: "TRACES_BASED_ALERT",
    ruleType: "threshold_rule",
    version: "v5",
    schemaVersion: "v2alpha1",
    condition: {
      compositeQuery: {
        queryType: "builder",
        queries: [{ type: "builder_query", spec: querySpec }],
      },
      thresholds: {
        kind: "basic",
        spec: [
          {
            name: severity,
            op: "above",
            target: targetValue,
            targetUnit: isLatency ? "ns" : "",
            matchType: "at_least_once",
            channels: verifiedChannelNames,
          },
        ],
      },
    },
    evaluation: {
      kind: "rolling",
      spec: { evalWindow, frequency },
    },
    notificationSettings: {
      renotify: { enabled: true, interval: "4h", alertStates: ["firing"] },
    },
    labels: { severity, "evolvex.managed": "true" },
    annotations: {
      summary: isLatency
        ? `p99 latency above ${input.target}ms for ${input.serviceName}`
        : `Error span count above ${input.target} for ${input.serviceName}`,
    },
  };
}

/**
 * Mirrors the `signoz_create_alert` MCP tool end-to-end: verifies the
 * requested notification channels exist before creating the rule (same
 * safety check the MCP tool documents), then POSTs /api/v2/rules.
 */
export async function createThresholdAlertRule(
  input: CreateThresholdAlertInput,
  configOverride?: SignozConfig | null,
) {
  const config = requireConfig(configOverride);
  const channels = await listNotificationChannels(config);
  const verified = input.channelNames.filter((name) => channels.some((channel) => channel.name === name));

  if (verified.length === 0) {
    const available = channels.map((channel) => channel.name).join(", ");
    throw new Error(
      `No matching SigNoz notification channel found for [${input.channelNames.join(", ")}]. ` +
        (available
          ? `Available channels: ${available}.`
          : "No channels exist yet — create one in SigNoz → Settings → Alerts → Notification Channels."),
    );
  }

  const payload = buildThresholdAlertPayload(input, verified);
  const url = `${normalizeBaseUrl(config.cloudUrl)}/api/v2/rules`;
  const response = await fetch(url, {
    method: "POST",
    headers: authHeaders(config),
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(
        `Failed to create SigNoz alert rule "${input.alertName}" (403 forbidden): the configured ` +
          `SIGNOZ_API_KEY does not have Editor/Admin permissions in SigNoz. Reads (listing channels/rules) ` +
          `work with any role, but creating rules needs an Editor+ key — generate one in SigNoz → Settings → ` +
          `API Keys with an Editor or Admin role. Raw response: ${text.slice(0, 300)}`,
      );
    }
    throw new Error(
      `Failed to create SigNoz alert rule "${input.alertName}" (${response.status}): ${text.slice(0, 500)}`,
    );
  }
  return safeJsonParse(text);
}
