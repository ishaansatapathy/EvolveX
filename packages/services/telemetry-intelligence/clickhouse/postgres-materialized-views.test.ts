import { describe, expect, it, vi } from "vitest";

const { mockSelect, mockInsert } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
  },
  and: (...args: unknown[]) => args,
  desc: (value: unknown) => value,
  eq: (left: unknown, right: unknown) => ({ left, right }),
  gte: (left: unknown, right: unknown) => ({ left, right }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

vi.mock("@repo/database/schema", () => ({
  telemetryServiceErrorSummaryMvTable: {
    organizationId: "organizationId",
    serviceName: "serviceName",
    windowStart: "windowStart",
    requestCount: "requestCount",
    errorCount: "errorCount",
    p99Ms: "p99Ms",
  },
  telemetryTopFailingEndpointsMvTable: {
    organizationId: "organizationId",
    serviceName: "serviceName",
    endpoint: "endpoint",
    windowStart: "windowStart",
    errorCount: "errorCount",
    p99Ms: "p99Ms",
  },
}));

import {
  buildPostgresMaterializedInvestigationInsights,
  getPostgresMaterializedViewStatus,
} from "./postgres-materialized-views";

function summaryChain(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve(rows)),
    })),
  };
}

function endpointChain(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  const tail = {
    groupBy: vi.fn(() => tail),
    orderBy: vi.fn(() => tail),
    limit: vi.fn(() => promise),
  };
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => tail),
    })),
  };
}

describe("postgres materialized views (#4 SigNoz Cloud)", () => {
  it("returns cached insights when Postgres MV rows exist", async () => {
    mockSelect
      .mockImplementationOnce(() => summaryChain([{ requests: 120, errors: 4, p99Ms: 850 }]))
      .mockImplementationOnce(() =>
        endpointChain([{ endpoint: "POST /checkout", errorCount: 3, p99Ms: 900 }]),
      );

    const insights = await buildPostgresMaterializedInvestigationInsights({
      serviceName: "payments-svc",
      organizationId: "org-1",
      windowMinutes: 15,
    });

    expect(insights?.source).toBe("postgres_materialized_view");
    expect(insights?.materializedViewBackend).toBe("postgres");
    expect(insights?.latencySummary?.errors).toBe(4);
    expect(insights?.topFailingEndpoints[0]?.endpoint).toBe("POST /checkout");
  });

  it("returns null when cache is empty", async () => {
    mockSelect
      .mockImplementationOnce(() => summaryChain([{ requests: 0, errors: 0, p99Ms: null }]))
      .mockImplementationOnce(() => endpointChain([]));

    const insights = await buildPostgresMaterializedInvestigationInsights({
      serviceName: "payments-svc",
      organizationId: "org-1",
    });

    expect(insights).toBeNull();
  });

  it("reports Postgres MV status counts", async () => {
    mockSelect
      .mockImplementationOnce(() => summaryChain([{ count: 2 }]))
      .mockImplementationOnce(() => summaryChain([{ count: 5 }]));

    const status = await getPostgresMaterializedViewStatus("org-1");

    expect(status.backend).toBe("postgres");
    expect(status.serviceSummaryRows).toBe(2);
    expect(status.endpointRows).toBe(5);
    expect(status.ready).toBe(true);
  });
});
