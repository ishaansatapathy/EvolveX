import { z } from "zod";

/** LaunchDarkly / Flagsmith / OpenFeature / generic feature-flag webhook */
export const featureFlagEventSchema = z
  .object({
    provider: z.enum(["launchdarkly", "flagsmith", "openfeature", "generic"]).optional(),
    flagKey: z.string().optional(),
    flagName: z.string().optional(),
    key: z.string().optional(),
    name: z.string().optional(),
    action: z.string().optional(),
    environment: z.string().optional(),
    service: z.string().optional(),
    project: z.string().optional(),
    author: z.string().optional(),
    occurredAt: z.string().optional(),
    timestamp: z.union([z.string(), z.number()]).optional(),
    date: z.union([z.string(), z.number()]).optional(),
    previousValue: z.unknown().optional(),
    currentValue: z.unknown().optional(),
    tags: z.array(z.string()).optional(),
    /** LaunchDarkly audit log shape */
    kind: z.string().optional(),
    title: z.string().optional(),
    target: z
      .object({
        key: z.string().optional(),
        name: z.string().optional(),
        tags: z.array(z.string()).optional(),
      })
      .optional(),
    member: z
      .object({
        email: z.string().optional(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
      })
      .optional(),
    /** Flagsmith webhook shape */
    event_type: z.string().optional(),
    data: z
      .object({
        flag_name: z.string().optional(),
        flag: z.string().optional(),
        environment_name: z.string().optional(),
        new_state: z.string().optional(),
        previous_state: z.string().optional(),
        changed_by: z.string().optional(),
        service: z.string().optional(),
        tags: z.array(z.string()).optional(),
      })
      .optional(),
    /** OpenFeature CloudEvent-style */
    type: z.string().optional(),
    subject: z.string().optional(),
    time: z.string().optional(),
  })
  .passthrough();

export type FeatureFlagEventPayload = z.infer<typeof featureFlagEventSchema>;

export type FeatureFlagAction = "enabled" | "disabled" | "updated" | "rollout";

function inferProvider(payload: FeatureFlagEventPayload): string {
  if (payload.provider) return payload.provider;
  if (payload.kind === "flag" || payload.target?.key) return "launchdarkly";
  if (payload.event_type?.includes("FLAG")) return "flagsmith";
  if (payload.type?.includes("featureflag") || payload.subject) return "openfeature";
  return "generic";
}

function inferFlagKey(payload: FeatureFlagEventPayload): string {
  return (
    payload.flagKey ??
    payload.key ??
    payload.target?.key ??
    payload.data?.flag_name ??
    payload.data?.flag ??
    payload.subject ??
    "unknown-flag"
  );
}

function inferFlagName(payload: FeatureFlagEventPayload, flagKey: string): string {
  return (
    payload.flagName ??
    payload.name ??
    payload.target?.name ??
    payload.data?.flag_name ??
    flagKey.replace(/[-_]+/g, " ")
  );
}

function inferAction(payload: FeatureFlagEventPayload): FeatureFlagAction {
  const blob = [
    payload.action,
    payload.event_type,
    payload.data?.new_state,
    payload.title,
    payload.type,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/enable|turned.?on|on\b|true/.test(blob)) return "enabled";
  if (/disable|turned.?off|off\b|false/.test(blob)) return "disabled";
  if (/rollout|percentage|gradual|canary/.test(blob)) return "rollout";
  return "updated";
}

function inferService(payload: FeatureFlagEventPayload, flagKey: string, tags: string[]): string {
  if (payload.service?.trim()) return payload.service.trim();
  if (payload.data?.service?.trim()) return payload.data.service.trim();

  const serviceTag = tags.find((tag) => /^service[:=]/i.test(tag) || /^svc[:=]/i.test(tag));
  if (serviceTag) {
    const [, value] = serviceTag.split(/[:=]/);
    if (value?.trim()) return value.trim();
  }

  const match = flagKey.match(/^([a-z0-9-]+)-(?:flag|feature|checkout|rollout)/i);
  if (match?.[1]) return match[1];

  if (/checkout|payment|order|cart/i.test(flagKey)) return "payments-svc";
  return flagKey.split(/[-_.]/)[0] ?? flagKey;
}

function inferOccurredAt(payload: FeatureFlagEventPayload): Date {
  const raw = payload.occurredAt ?? payload.timestamp ?? payload.date ?? payload.time;
  if (typeof raw === "number") {
    const ms = raw > 1_000_000_000_000 ? raw : raw * 1000;
    return new Date(ms);
  }
  if (typeof raw === "string" && raw.trim()) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function inferAuthor(payload: FeatureFlagEventPayload): string | undefined {
  const memberName = [payload.member?.firstName, payload.member?.lastName].filter(Boolean).join(" ");
  return (
    payload.author ??
    payload.member?.email ??
    payload.data?.changed_by ??
    (memberName || undefined)
  );
}

function inferTags(payload: FeatureFlagEventPayload): string[] {
  return [...(payload.tags ?? []), ...(payload.target?.tags ?? []), ...(payload.data?.tags ?? [])];
}

export function classifyFeatureFlagSeverity(action: FeatureFlagAction): "critical" | "warning" | "info" {
  if (action === "enabled" || action === "rollout") return "critical";
  if (action === "disabled") return "warning";
  return "info";
}

export function parseFeatureFlagEvent(payload: FeatureFlagEventPayload) {
  const provider = inferProvider(payload);
  const flagKey = inferFlagKey(payload);
  const flagName = inferFlagName(payload, flagKey);
  const action = inferAction(payload);
  const tags = inferTags(payload);
  const service = inferService(payload, flagKey, tags);
  const occurredAt = inferOccurredAt(payload);
  const author = inferAuthor(payload);
  const environment = payload.environment ?? payload.data?.environment_name ?? "production";
  const severity = classifyFeatureFlagSeverity(action);

  const actionLabel =
    action === "enabled"
      ? "enabled"
      : action === "disabled"
        ? "disabled"
        : action === "rollout"
          ? "rollout started"
          : "updated";

  const title =
    severity === "critical"
      ? `Feature flag · ${flagName} ${actionLabel}`
      : `Feature flag: ${flagName} ${actionLabel}`;

  const detail = `[${provider}] ${flagKey} ${actionLabel} in ${environment}${
    author ? ` by ${author}` : ""
  }`;

  return {
    provider,
    flagKey,
    flagName,
    action,
    environment,
    service,
    author,
    tags,
    occurredAt,
    severity,
    title,
    detail,
    fingerprint: `${provider}|${environment}|${flagKey}|${action}`.toLowerCase(),
    previousValue: payload.previousValue ?? payload.data?.previous_state,
    currentValue: payload.currentValue ?? payload.data?.new_state,
  };
}
