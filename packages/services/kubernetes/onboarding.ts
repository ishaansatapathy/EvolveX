import { randomBytes } from "node:crypto";

import { getIntegrationBaseUrl } from "../integrations/config";

export type KubernetesOnboardingPlan = {
  clusterName: string;
  webhookUrl: string;
  webhookSecret: string;
  organizationId: string;
  helmInstallCommand: string;
  helmUpgradeCommand: string;
  helmUninstallCommand: string;
  postInstallCheckUrl: string;
  collectorConfigUrl: string;
  requiredPermissions: string[];
  notes: string[];
};

export type KubernetesClusterMetadata = {
  clusterVersion?: string | null;
  namespaces?: string[];
  nodeCount?: number | null;
  lastEventKind?: string | null;
  lastEventNamespace?: string | null;
};

function sanitizeClusterName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function generateKubernetesWebhookSecret() {
  return randomBytes(24).toString("hex");
}

const DEFAULT_HELM_CHART_VERSION = "0.1.0";
const DEFAULT_PRODUCTION_HELM_CHART_OCI = "oci://ghcr.io/ishaansatapathy/evolvex-agent";

export type HelmChartReference = {
  chart: string;
  version?: string;
  source: "oci" | "local";
};

/** Production defaults to GHCR OCI so users never need to clone the repo. */
export function resolveHelmChartReference(env: NodeJS.ProcessEnv = process.env): HelmChartReference {
  const explicitOci = env.EVOLVEX_HELM_CHART_OCI?.trim();
  if (explicitOci) {
    return {
      chart: explicitOci,
      version: env.EVOLVEX_HELM_CHART_VERSION?.trim() || DEFAULT_HELM_CHART_VERSION,
      source: "oci",
    };
  }

  const nodeEnv = env.NODE_ENV?.trim().toLowerCase();
  if (nodeEnv === "production" || nodeEnv === "prod") {
    return {
      chart: DEFAULT_PRODUCTION_HELM_CHART_OCI,
      version: env.EVOLVEX_HELM_CHART_VERSION?.trim() || DEFAULT_HELM_CHART_VERSION,
      source: "oci",
    };
  }

  return {
    chart: env.EVOLVEX_HELM_CHART_PATH?.trim() || "./helm/evolvex-agent",
    source: "local",
  };
}

export function buildHelmInstallCommand(input: {
  releaseName?: string;
  namespace?: string;
  baseUrl: string;
  webhookSecret: string;
  organizationId: string;
  clusterName: string;
  signozOtlpEndpoint?: string;
  signozIngestionKey?: string;
  chart?: HelmChartReference;
}) {
  const release = input.releaseName ?? "evolvex-agent";
  const namespace = input.namespace ?? "evolvex";
  const chartRef = input.chart ?? resolveHelmChartReference();
  const versionFlag = chartRef.version ? ` --version ${chartRef.version}` : "";
  const sets = [
    `evolvex.baseUrl=${input.baseUrl}`,
    `evolvex.webhookSecret=${input.webhookSecret}`,
    `evolvex.organizationId=${input.organizationId}`,
    `cluster.name=${input.clusterName}`,
    `signoz.otlpEndpoint=${input.signozOtlpEndpoint ?? "ingest.signoz.cloud:4317"}`,
  ];

  if (input.signozIngestionKey) {
    sets.push(`signoz.ingestionKey=${input.signozIngestionKey}`);
  }

  return `helm upgrade --install ${release} ${chartRef.chart}${versionFlag} --namespace ${namespace} --create-namespace ${sets.map((value) => `--set ${value}`).join(" ")}`;
}

export function buildKubernetesOnboardingPlan(input: {
  organizationId: string;
  clusterName?: string;
  baseUrl?: string;
  webhookSecret: string;
  signozOtlpEndpoint?: string;
  signozIngestionKey?: string;
}): KubernetesOnboardingPlan {
  const baseUrl = (input.baseUrl ?? getIntegrationBaseUrl()).replace(/\/+$/, "");
  const clusterName = sanitizeClusterName(input.clusterName ?? "production") || "production";
  const release = "evolvex-agent";
  const namespace = "evolvex";
  const chart = resolveHelmChartReference();

  const helmInstallCommand = buildHelmInstallCommand({
    baseUrl,
    webhookSecret: input.webhookSecret,
    organizationId: input.organizationId,
    clusterName,
    signozOtlpEndpoint: input.signozOtlpEndpoint,
    signozIngestionKey: input.signozIngestionKey,
    chart,
  });

  const chartNote =
    chart.source === "oci"
      ? `Chart pulls from ${chart.chart} — no Evolvex repo clone required.`
      : "Local chart path — run from the Evolvex repo root, or set EVOLVEX_HELM_CHART_OCI in production.";

  return {
    clusterName,
    webhookUrl: `${baseUrl}/webhooks/kubernetes`,
    webhookSecret: input.webhookSecret,
    organizationId: input.organizationId,
    helmInstallCommand,
    helmUpgradeCommand: helmInstallCommand,
    helmUninstallCommand: `helm uninstall ${release} --namespace ${namespace}`,
    postInstallCheckUrl: `${baseUrl}/webhooks/kubernetes`,
    collectorConfigUrl: `${baseUrl}/telemetry-intelligence/collector-config`,
    requiredPermissions: [
      "get/list/watch pods, deployments, services, namespaces, nodes, events",
      "create/update configmaps and secrets in target namespace",
    ],
    notes: [
      "Run the Helm command from a machine with kubectl access to the target cluster.",
      chartNote,
      "The chart deploys an event forwarder and OTel collector ConfigMap — not the Evolvex API itself.",
      "After install, cluster events appear on investigation timelines within one webhook delivery.",
    ],
  };
}

export function mergeKubernetesClusterMetadata(
  existing: KubernetesClusterMetadata | null | undefined,
  incoming: KubernetesClusterMetadata,
): KubernetesClusterMetadata {
  const namespaces = new Set([...(existing?.namespaces ?? []), ...(incoming.namespaces ?? [])]);
  return {
    clusterVersion: incoming.clusterVersion ?? existing?.clusterVersion ?? null,
    namespaces: namespaces.size > 0 ? [...namespaces].sort().slice(0, 50) : existing?.namespaces ?? [],
    nodeCount: incoming.nodeCount ?? existing?.nodeCount ?? null,
    lastEventKind: incoming.lastEventKind ?? existing?.lastEventKind ?? null,
    lastEventNamespace: incoming.lastEventNamespace ?? existing?.lastEventNamespace ?? null,
  };
}
