export type CollectorEnrichmentAttributes = {
  "evolvex.incident_id"?: string;
  "evolvex.git_sha"?: string;
  "evolvex.deploy_version"?: string;
  "evolvex.namespace"?: string;
  "evolvex.sampling_mode"?: string;
  "evolvex.sampling_rate"?: number;
  "evolvex.organization_id"?: string;
};

/** Feature #2 — OTel processor attribute schema for collector enrichment. */
export function buildCollectorEnrichmentSpec(input: {
  incidentId?: string;
  gitSha?: string;
  deployVersion?: string;
  namespace?: string;
  samplingMode?: string;
  samplingRate?: number;
  organizationId?: string;
}): CollectorEnrichmentAttributes {
  const attrs: CollectorEnrichmentAttributes = {};
  if (input.incidentId) attrs["evolvex.incident_id"] = input.incidentId;
  if (input.gitSha) attrs["evolvex.git_sha"] = input.gitSha;
  if (input.deployVersion) attrs["evolvex.deploy_version"] = input.deployVersion;
  if (input.namespace) attrs["evolvex.namespace"] = input.namespace;
  if (input.samplingMode) attrs["evolvex.sampling_mode"] = input.samplingMode;
  if (input.samplingRate != null) attrs["evolvex.sampling_rate"] = input.samplingRate;
  if (input.organizationId) attrs["evolvex.organization_id"] = input.organizationId;
  return attrs;
}

export const COLLECTOR_EXTENSION_PROCESSOR_NAME = "evolvex/enrichment";
