import { eq } from "@repo/database";
import { db } from "@repo/database";
import { investigationsTable } from "@repo/database/schema";

import { resolveInvestigationOwnerUserId } from "../investigation/owner";
import { resolveOrganizationForUser } from "../organization";
import { classifySignozAlert } from "../signoz/alert-classifier";
import type { SignozWebhookPayload } from "../signoz/types";
import {
  extractServiceNames,
  incidentWindowFromAlert,
  isResolvedAlert,
} from "../signoz/webhook-parser";
import { getDefaultServiceName } from "../signoz-env";
import { parseGithubDeployEvent, inferServiceNameFromRepo, type GithubPushPayload } from "../github/webhook-parser";
import { getTelemetryIntelligenceConfig } from "./config";
import { buildInvestigationInsights } from "./clickhouse/investigation-insights";
import { generateCollectorConfig } from "./collector/config-generator";
import { buildCollectorConfigForOrganization } from "./collector/org-config";
import { buildAlertEnrichment } from "./enrichment/similar-alerts";
import {
  buildServiceMapDeepCorrelation,
  graphDepthFromCorrelation,
} from "./service-map/deep-correlation";
import { applySamplingPolicyBoost } from "./sampling/apply-policy";
import { computeAdaptiveTailSampling } from "./sampling/adaptive-tail";
import { computeChangeAwareSampling } from "./sampling/change-aware";
import {
  computeContextAwareSampling,
  isCriticalServiceName,
  mergeSamplingPolicies,
} from "./sampling/context-aware";
import { listActiveSamplingPolicies, persistSamplingPolicy, recordTelemetryIntelligenceEvent } from "./sampling/policy-store";
import type {
  ChangeEventInput,
  SignozWebhookHandler,
  TelemetryIntelligenceSnapshot,
} from "./types";
import { attachTelemetryIntelligenceSnapshot } from "./vectors/telemetry-vectors";

/** Feature #10 — unified telemetry intelligence orchestrator. */
export class TelemetryIntelligenceOrchestrator {
  constructor(private readonly investigationHandler: SignozWebhookHandler) {}

  async handleSignozWebhook(payload: SignozWebhookPayload, options?: { organizationId?: string | null }) {
    // Per-workspace secret resolves the org directly; null/undefined falls back to the global
    // INVESTIGATION_OWNER_EMAIL workspace (legacy single-tenant / local-dev path).
    const organizationId =
      options?.organizationId ??
      (await resolveOrganizationForUser(await resolveInvestigationOwnerUserId()));
    const snapshotsByFingerprint = new Map<string, TelemetryIntelligenceSnapshot>();

    for (const alert of payload.alerts) {
      if (isResolvedAlert(payload, alert)) continue;

      const fingerprint = alert.fingerprint ?? `${alert.labels.alertname ?? "alert"}-${alert.startsAt}`;
      const snapshot = await this.processAlert({
        alert,
        payload,
        organizationId,
      });
      snapshotsByFingerprint.set(fingerprint, snapshot);
    }

    const result = await this.investigationHandler(payload, { organizationId });

    for (const investigationId of result.investigationIds) {
      const [row] = await db
        .select({
          id: investigationsTable.id,
          externalId: investigationsTable.externalId,
          signozAlertPayload: investigationsTable.signozAlertPayload,
        })
        .from(investigationsTable)
        .where(eq(investigationsTable.id, investigationId))
        .limit(1);

      if (!row) continue;

      const payloadRecord = row.signozAlertPayload as
        | { alert?: { fingerprint?: string } }
        | null
        | undefined;
      const fingerprint =
        payloadRecord?.alert?.fingerprint ?? row.externalId ?? investigationId;
      const snapshot = snapshotsByFingerprint.get(fingerprint);

      if (snapshot) {
        await attachTelemetryIntelligenceSnapshot(investigationId, snapshot);
      }
    }

    return result;
  }

  async processAlert(input: {
    alert: SignozWebhookPayload["alerts"][number];
    payload: SignozWebhookPayload;
    organizationId: string | null;
  }): Promise<TelemetryIntelligenceSnapshot> {
    const enrichment = await buildAlertEnrichment({
      alert: input.alert,
      payload: input.payload,
      organizationId: input.organizationId,
    });

    const services = enrichment.serviceNames.length
      ? enrichment.serviceNames
      : [getDefaultServiceName()];
    const primaryService = services[0]!;
    const window = incidentWindowFromAlert(input.alert);

    const serviceMapCorrelation = await buildServiceMapDeepCorrelation({
      primaryService,
      organizationId: input.organizationId,
      startMs: window.start.getTime(),
      endMs: window.end.getTime(),
    });

    const graphDepth = graphDepthFromCorrelation(serviceMapCorrelation);
    const classification = classifySignozAlert(input.alert);
    const severity = enrichment.severity;

    const policies = services.map((serviceName) => {
      const adaptive = computeAdaptiveTailSampling({
        serviceName,
        classification,
        severity,
      });
      const contextual = computeContextAwareSampling({
        serviceName,
        classification,
        severity,
        graphDepth,
        isCriticalService: isCriticalServiceName(serviceName),
      });
      return mergeSamplingPolicies([adaptive, contextual])!;
    });

    for (const affected of serviceMapCorrelation.affectedServices) {
      if (services.includes(affected)) continue;
      const boost = computeAdaptiveTailSampling({
        serviceName: affected,
        classification,
        severity,
        triggerSource: "graph-propagation",
      });
      policies.push(boost);
    }

    const uniquePolicies = new Map<string, (typeof policies)[number]>();
    for (const policy of policies) {
      const existing = uniquePolicies.get(policy.serviceName);
      if (!existing || policy.sampleRate > existing.sampleRate) {
        uniquePolicies.set(policy.serviceName, policy);
      }
    }

    const finalPolicies = [...uniquePolicies.values()];

    for (const policy of finalPolicies) {
      await persistSamplingPolicy({
        organizationId: input.organizationId,
        policy,
      });
      void applySamplingPolicyBoost(policy);
    }

    const runtimeInsights = await buildInvestigationInsights({
      serviceName: primaryService,
      organizationId: input.organizationId,
      windowMinutes: 15,
      endpointLimit: 5,
    });

    const intelligenceState =
      finalPolicies.some((policy) => policy.mode === "incident")
        ? "incident"
        : finalPolicies.some((policy) => policy.mode === "change_boost")
          ? "change_boost"
          : finalPolicies.some((policy) => policy.mode === "elevated")
            ? "elevated"
            : "normal";

    await recordTelemetryIntelligenceEvent({
      organizationId: input.organizationId,
      kind: "alert_processed",
      serviceName: primaryService,
      payload: {
        alertName: enrichment.alertName,
        intelligenceState,
        policyCount: finalPolicies.length,
        graphDepth,
      },
    });

    const evolvexApiUrl = process.env.BASE_URL?.replace(/\/+$/, "") ?? "http://localhost:8000";
    const orgQuery = input.organizationId ? `?organizationId=${input.organizationId}` : "";
    const collectorConfigHint = `${evolvexApiUrl}/telemetry-intelligence/collector-config${orgQuery}`;

    return {
      version: 1,
      processedAt: new Date().toISOString(),
      intelligenceState,
      alertEnrichment: enrichment,
      serviceMapCorrelation,
      samplingPolicies: finalPolicies,
      collectorConfigHint,
      runtimeInsights,
      clickhouseInsights: runtimeInsights,
    };
  }

  async handleChangeEvent(input: ChangeEventInput & { organizationId?: string | null }) {
    const policy = computeChangeAwareSampling(input);
    await persistSamplingPolicy({
      organizationId: input.organizationId ?? null,
      policy,
    });
    void applySamplingPolicyBoost(policy);

    await recordTelemetryIntelligenceEvent({
      organizationId: input.organizationId ?? null,
      kind: "change_boost_applied",
      serviceName: input.serviceName,
      payload: {
        changeType: input.changeType,
        sha: input.sha,
        repo: input.repo,
      },
    });

    return policy;
  }

  async handleGithubDeploy(payload: GithubPushPayload, organizationId: string | null) {
    const deploy = parseGithubDeployEvent(payload);
    const serviceName = inferServiceNameFromRepo(deploy.repo) ?? deploy.repo.split("/").pop() ?? getDefaultServiceName();

    return this.handleChangeEvent({
      serviceName,
      changeType: "deploy",
      sha: deploy.fullSha,
      author: deploy.author,
      repo: deploy.repo,
      organizationId,
    });
  }

  async getStatus(organizationId?: string | null) {
    const policies = await listActiveSamplingPolicies({ organizationId });
    const config = getTelemetryIntelligenceConfig();

    return {
      enabled: true,
      intelligenceState: policies.some((row) => row.mode === "incident")
        ? "incident"
        : policies.some((row) => row.mode === "change_boost")
          ? "change_boost"
          : policies.some((row) => row.mode === "elevated")
            ? "elevated"
            : "normal",
      activePolicyCount: policies.length,
      clickhouseEnabled: config.clickhouseEnabled,
      baselineSampleRate: config.baselineSampleRate,
      policies: policies.map((row) => ({
        serviceName: row.serviceName,
        mode: row.mode,
        sampleRate: row.sampleRate,
        reason: row.reason,
        expiresAt: row.expiresAt.toISOString(),
      })),
    };
  }

  async generateCollectorConfigForOrg(input: {
    organizationId?: string | null;
    signozOtlpEndpoint?: string;
    signozIngestionKey?: string;
  }) {
    if (!input.organizationId) {
      const evolvexApiUrl = process.env.BASE_URL?.replace(/\/+$/, "") ?? "http://localhost:8000";
      return generateCollectorConfig({
        evolvexApiUrl,
        signozOtlpEndpoint:
          input.signozOtlpEndpoint ??
          process.env.SIGNOZ_OTLP_ENDPOINT ??
          "ingest.signoz.cloud:4317",
        signozIngestionKey: input.signozIngestionKey ?? process.env.SIGNOZ_INGESTION_KEY,
        activePolicies: [],
      });
    }

    const result = await buildCollectorConfigForOrganization({
      organizationId: input.organizationId,
    });
    return result.yaml;
  }
}

let defaultOrchestrator: TelemetryIntelligenceOrchestrator | null = null;

export function createTelemetryIntelligenceOrchestrator(handler: SignozWebhookHandler) {
  return new TelemetryIntelligenceOrchestrator(handler);
}

export function getDefaultTelemetryIntelligenceOrchestrator(handler: SignozWebhookHandler) {
  if (!defaultOrchestrator) {
    defaultOrchestrator = new TelemetryIntelligenceOrchestrator(handler);
  }
  return defaultOrchestrator;
}
