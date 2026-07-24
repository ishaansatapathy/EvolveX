export type EvolvexClientOptions = {
  baseUrl: string;
  apiKey?: string;
};

export type InvestigationListItem = {
  id: string;
  shortId: string;
  title: string;
  status: "building" | "ready" | "failed";
  caseStatus: "open" | "investigating" | "monitoring" | "resolved";
  severity: string | null;
  affectedServices: string[];
  createdAt: string;
  updatedAt: string | null;
};

export type TimelineEntry = {
  id: string;
  occurredAt: string;
  kind: string;
  title: string;
  detail: string;
  source?: string | null;
};

export type CustomEventInput = {
  title: string;
  detail: string;
  service?: string;
  occurredAt?: string;
  source?: string;
  metadata?: Record<string, unknown>;
  investigationId?: string;
};

export type TimelineEventInput = {
  title: string;
  detail: string;
  kind?: "ALERT" | "DEPLOY" | "METRIC" | "LOG" | "TRACE" | "CHANGE" | "EBPF" | "AI";
  occurredAt?: string;
  source?: string;
  metadata?: Record<string, unknown>;
};

/** Feature #57 — typed HTTP client for Evolvex SDK REST API. */
export class EvolvexClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(options: EvolvexClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    };

    if (this.apiKey) {
      headers.authorization = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });

    const body = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) {
      throw new Error(typeof body.error === "string" ? body.error : `Evolvex SDK request failed (${response.status})`);
    }

    return body;
  }

  info() {
    return this.request<{ ok: boolean; version: string; endpoints: string[] }>("/");
  }

  listInvestigations(filters?: { query?: string; severity?: string; service?: string; limit?: number }) {
    const params = new URLSearchParams();
    if (filters?.query) params.set("query", filters.query);
    if (filters?.severity) params.set("severity", filters.severity);
    if (filters?.service) params.set("service", filters.service);
    if (filters?.limit) params.set("limit", String(filters.limit));
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    return this.request<{ ok: boolean; investigations: InvestigationListItem[] }>(`/investigations${suffix}`);
  }

  getInvestigation(id: string) {
    return this.request<{ ok: boolean; investigation: InvestigationListItem }>(`/investigations/${id}`);
  }

  getTimeline(id: string) {
    return this.request<{ ok: boolean; timeline: TimelineEntry[] }>(`/investigations/${id}/timeline`);
  }

  createTimelineEvent(investigationId: string, event: TimelineEventInput) {
    return this.request<{ ok: boolean; timelineEntryId: string }>(`/investigations/${investigationId}/timeline-events`, {
      method: "POST",
      body: JSON.stringify(event),
    });
  }

  attachMetadata(investigationId: string, metadata: Record<string, unknown>, appendNote?: string) {
    return this.request<{ ok: boolean; investigationId: string; metadataKeys: string[] }>(
      `/investigations/${investigationId}/metadata`,
      {
        method: "POST",
        body: JSON.stringify({ metadata, appendNote }),
      },
    );
  }

  pushCustomEvent(event: CustomEventInput) {
    return this.request<{ ok: boolean; attachedInvestigationIds: string[]; message: string }>("/events", {
      method: "POST",
      body: JSON.stringify(event),
    });
  }
}

export function createEvolvexClient(options: EvolvexClientOptions) {
  return new EvolvexClient(options);
}
