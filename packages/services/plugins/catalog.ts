import { z } from "zod";

export type PluginCategory = "custom" | "import" | "security" | "ai";

export type PluginDefinition = {
  id: string;
  name: string;
  description: string;
  category: PluginCategory;
  version: string;
  hooks: Array<"timeline" | "pre_investigation" | "evidence">;
  webhookPath: string;
  docs: string;
};

/** Feature #58 — built-in plugin marketplace catalog. */
export const PLUGIN_CATALOG: PluginDefinition[] = [
  {
    id: "custom-events",
    name: "Custom Events",
    description: "Push arbitrary operational events into investigation timelines via webhook or SDK.",
    category: "custom",
    version: "1.0.0",
    hooks: ["timeline"],
    webhookPath: "/webhooks/plugins/custom-events",
    docs: "Send { title, detail, service?, metadata? }",
  },
  {
    id: "datadog-import",
    name: "Datadog Import",
    description: "Import Datadog monitor alerts as Evolvex timeline evidence.",
    category: "import",
    version: "1.0.0",
    hooks: ["timeline", "evidence"],
    webhookPath: "/webhooks/plugins/datadog-import",
    docs: "Datadog webhook v1 payload or simplified { alert_title, alert_body, service, tags? }",
  },
  {
    id: "prometheus-alertmanager",
    name: "Prometheus Alertmanager",
    description: "Ingest Alertmanager v4 webhook payloads into active investigations.",
    category: "import",
    version: "1.0.0",
    hooks: ["timeline", "evidence"],
    webhookPath: "/webhooks/plugins/prometheus-alertmanager",
    docs: "Standard Alertmanager webhook JSON (alerts[], commonLabels, externalURL).",
  },
  {
    id: "security-scanner",
    name: "Security Scanner",
    description: "Attach vulnerability and misconfiguration findings to incident context.",
    category: "security",
    version: "1.0.0",
    hooks: ["timeline", "evidence"],
    webhookPath: "/webhooks/plugins/security-scanner",
    docs: "Send { finding, severity, resource, cve?, remediation? }",
  },
];

export const customEventsPluginSchema = z.object({
  title: z.string().min(1).max(255),
  detail: z.string().min(1).max(4000),
  service: z.string().max(128).optional(),
  occurredAt: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  investigationId: z.string().uuid().optional(),
});

export const datadogImportPluginSchema = z.union([
  z.object({
    alert_title: z.string(),
    alert_body: z.string().optional(),
    service: z.string().optional(),
    tags: z.string().optional(),
    date: z.union([z.string(), z.number()]).optional(),
  }),
  z.object({
    title: z.string(),
    text: z.string().optional(),
    hostname: z.string().optional(),
    tags: z.string().optional(),
  }),
]);

export const prometheusAlertmanagerSchema = z.object({
  status: z.string().optional(),
  externalURL: z.string().optional(),
  commonLabels: z.record(z.string(), z.string()).optional(),
  alerts: z
    .array(
      z.object({
        status: z.string().optional(),
        labels: z.record(z.string(), z.string()).optional(),
        annotations: z.record(z.string(), z.string()).optional(),
        startsAt: z.string().optional(),
      }),
    )
    .min(1),
});

export const securityScannerPluginSchema = z.object({
  finding: z.string().min(1).max(255),
  severity: z.enum(["critical", "high", "medium", "low"]).default("high"),
  resource: z.string().min(1).max(255),
  cve: z.string().max(32).optional(),
  remediation: z.string().max(1000).optional(),
  service: z.string().max(128).optional(),
  occurredAt: z.string().datetime().optional(),
});

export function getPluginDefinition(pluginId: string) {
  return PLUGIN_CATALOG.find((plugin) => plugin.id === pluginId) ?? null;
}
