import { describe, expect, it } from "vitest";

import type { InvestigationSearchMatchSource, InvestigationSearchResult } from "./search";

describe("investigation search (#59/#60)", () => {
  it("supports match metadata on search results", () => {
    const sample: InvestigationSearchResult = {
      id: "00000000-0000-4000-8000-000000000001",
      shortId: "INV-00000001",
      title: "payments-svc latency spike",
      status: "ready",
      caseStatus: "open",
      severity: "high",
      affectedServices: ["payments-svc"],
      createdAt: new Date().toISOString(),
      updatedAt: null,
      primaryService: "payments-svc",
      alertName: "High P99 Latency",
      matchSources: ["timeline", "service"] satisfies InvestigationSearchMatchSource[],
      matchSnippet: "connection timeout on payments-svc",
    };

    expect(sample.matchSources).toContain("timeline");
    expect(sample.matchSnippet).toContain("timeout");
  });
});
