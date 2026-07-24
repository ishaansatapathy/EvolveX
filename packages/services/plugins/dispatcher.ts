import type InvestigationService from "../investigation";
import {
  customEventsPluginSchema,
  datadogImportPluginSchema,
  getPluginDefinition,
  prometheusAlertmanagerSchema,
  securityScannerPluginSchema,
} from "./catalog";

export type PluginDispatchResult = {
  pluginId: string;
  attachedInvestigationIds: string[];
  message: string;
};

/** Feature #58 — routes plugin webhook payloads into the investigation pipeline. */
export async function dispatchPluginWebhook(
  investigationService: InvestigationService,
  input: {
    pluginId: string;
    organizationId: string;
    payload: unknown;
  },
): Promise<PluginDispatchResult> {
  const definition = getPluginDefinition(input.pluginId);
  if (!definition) {
    throw new Error(`Unknown plugin: ${input.pluginId}`);
  }

  switch (input.pluginId) {
    case "custom-events": {
      const parsed = customEventsPluginSchema.parse(input.payload);
      const result = await investigationService.handleSdkCustomEvent(parsed, {
        organizationId: input.organizationId,
        source: "plugin:custom-events",
      });
      return {
        pluginId: input.pluginId,
        attachedInvestigationIds: result.attachedInvestigationIds,
        message: result.message,
      };
    }

    case "datadog-import": {
      const parsed = datadogImportPluginSchema.parse(input.payload);
      const title = "alert_title" in parsed ? parsed.alert_title : parsed.title;
      const detail =
        "alert_body" in parsed
          ? parsed.alert_body ?? ""
          : "text" in parsed
            ? parsed.text ?? ""
            : "";
      const service =
        "service" in parsed
          ? parsed.service
          : "hostname" in parsed
            ? parsed.hostname
            : undefined;
      const result = await investigationService.handleSdkCustomEvent(
        {
          title: `Datadog · ${title}`,
          detail: detail || "Datadog monitor alert imported",
          service,
          source: "plugin:datadog-import",
          metadata: {
            tags: "tags" in parsed ? parsed.tags : undefined,
            plugin: "datadog-import",
          },
        },
        { organizationId: input.organizationId, source: "plugin:datadog-import" },
      );
      return {
        pluginId: input.pluginId,
        attachedInvestigationIds: result.attachedInvestigationIds,
        message: `Datadog alert imported · ${result.message}`,
      };
    }

    case "prometheus-alertmanager": {
      const parsed = prometheusAlertmanagerSchema.parse(input.payload);
      const alert = parsed.alerts[0]!;
      const alertName = alert.labels?.alertname ?? parsed.commonLabels?.alertname ?? "Prometheus alert";
      const service = alert.labels?.service ?? alert.labels?.job ?? parsed.commonLabels?.service;
      const summary = alert.annotations?.summary ?? alert.annotations?.description ?? "Alertmanager firing alert";
      const result = await investigationService.handleSdkCustomEvent(
        {
          title: `Prometheus · ${alertName}`,
          detail: summary,
          service,
          occurredAt: alert.startsAt,
          source: "plugin:prometheus-alertmanager",
          metadata: {
            status: alert.status ?? parsed.status,
            externalURL: parsed.externalURL,
            labels: alert.labels,
            plugin: "prometheus-alertmanager",
          },
        },
        { organizationId: input.organizationId, source: "plugin:prometheus-alertmanager" },
      );
      return {
        pluginId: input.pluginId,
        attachedInvestigationIds: result.attachedInvestigationIds,
        message: `Prometheus alert imported · ${result.message}`,
      };
    }

    case "security-scanner": {
      const parsed = securityScannerPluginSchema.parse(input.payload);
      const result = await investigationService.handleSdkCustomEvent(
        {
          title: `Security · ${parsed.finding}`,
          detail: parsed.remediation
            ? `${parsed.resource} · ${parsed.remediation}`
            : parsed.resource,
          service: parsed.service,
          occurredAt: parsed.occurredAt,
          source: "plugin:security-scanner",
          metadata: {
            severity: parsed.severity,
            cve: parsed.cve,
            resource: parsed.resource,
            plugin: "security-scanner",
          },
        },
        { organizationId: input.organizationId, source: "plugin:security-scanner" },
      );
      return {
        pluginId: input.pluginId,
        attachedInvestigationIds: result.attachedInvestigationIds,
        message: `Security finding attached · ${result.message}`,
      };
    }

    default:
      throw new Error(`Plugin handler not implemented: ${input.pluginId}`);
  }
}
