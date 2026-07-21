export type IncidentSeverity = "critical" | "high" | "medium" | "low";
export type IncidentStatus = "OPEN" | "INVESTIGATING" | "MONITORING" | "RESOLVED";

export type Incident = {
  id: string;
  title: string;
  service: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  time: string;
  cause: string;
  fix: string;
};

export type TimelineEvent = {
  at: string;
  kind: "DEPLOY" | "METRIC" | "LOG" | "TRACE" | "AI";
  text: string;
  href?: string;
};

export type LogEntry = {
  id: string;
  at: string;
  level: "ERROR" | "WARN" | "INFO";
  service: string;
  message: string;
  incidentId?: string;
};

export type TraceSpan = {
  id: string;
  name: string;
  service: string;
  durationMs: number;
  status: "error" | "ok" | "slow";
  incidentId?: string;
};

export type ServiceNode = {
  id: string;
  name: string;
  status: "healthy" | "degraded" | "critical";
  requestsPerMin: number;
  errorRate: number;
  deps: string[];
};

export type MetricPanel = {
  id: string;
  title: string;
  value: string;
  delta: string;
  series: number[];
};

export const INCIDENTS: Incident[] = [
  {
    id: "INC-2041",
    title: "Checkout API latency spike",
    service: "payments-svc",
    status: "OPEN",
    severity: "critical",
    time: "12 min ago",
    cause: "Deploy #8412 introduced N+1 query in cart lookup",
    fix: "Roll back deploy #8412 or patch CartMapper.load() to batch-fetch cart items in a single query.",
  },
  {
    id: "INC-2040",
    title: "Elevated 5xx on auth gateway",
    service: "auth-gateway",
    status: "INVESTIGATING",
    severity: "high",
    time: "48 min ago",
    cause: "Connection pool exhaustion after traffic surge",
    fix: "Increase pool size to 40 and enable queue timeout alerts on auth-gateway replicas.",
  },
  {
    id: "INC-2039",
    title: "Kafka consumer lag growing",
    service: "events-pipeline",
    status: "MONITORING",
    severity: "medium",
    time: "2 hr ago",
    cause: "Rebalance storm after broker restart",
    fix: "Pause partition reassignment and scale consumer group events-pipeline by +2 pods.",
  },
  {
    id: "INC-2038",
    title: "Memory leak in search workers",
    service: "search-svc",
    status: "RESOLVED",
    severity: "low",
    time: "6 hr ago",
    cause: "Unbounded cache fixed in deploy #8407",
    fix: "Keep LRU cache limit at 512MB and add heap usage alert above 85%.",
  },
];

export const TIMELINE: TimelineEvent[] = [
  {
    at: "14:02:11",
    kind: "DEPLOY",
    text: "payments-svc deploy #8412 rolled out to prod (canary 100%)",
  },
  {
    at: "14:04:56",
    kind: "METRIC",
    text: "p99 latency /checkout jumped 180ms → 2.4s",
    href: "/dashboards",
  },
  {
    at: "14:05:20",
    kind: "LOG",
    text: "ERROR pool timeout waiting for connection (db-cart-replica)",
    href: "/logs?service=payments-svc&incident=INC-2041",
  },
  {
    at: "14:06:02",
    kind: "TRACE",
    text: "Span cart.lookup executing 220 sequential SELECTs per request",
    href: "/traces?service=payments-svc&incident=INC-2041",
  },
  {
    at: "14:07:44",
    kind: "AI",
    text: "Root cause: commit a41f9c added per-item query in CartMapper.load()",
  },
];

export const STATS = [
  { label: "OPEN INCIDENTS", value: "3", note: "+1 last hour" },
  { label: "MTTR (7D)", value: "18m", note: "▼ 62% vs last week" },
  { label: "SERVICES WATCHED", value: "42", note: "8 stacks connected" },
  { label: "SIGNALS / MIN", value: "12.4k", note: "logs · traces · metrics" },
];

export const LOGS: LogEntry[] = [
  {
    id: "log-1",
    at: "14:05:20",
    level: "ERROR",
    service: "payments-svc",
    message: "pool timeout waiting for connection (db-cart-replica)",
    incidentId: "INC-2041",
  },
  {
    id: "log-2",
    at: "14:04:58",
    level: "WARN",
    service: "payments-svc",
    message: "checkout handler exceeded 1200ms p99 threshold",
    incidentId: "INC-2041",
  },
  {
    id: "log-3",
    at: "13:58:11",
    level: "ERROR",
    service: "auth-gateway",
    message: "upstream connect error: connection pool exhausted",
    incidentId: "INC-2040",
  },
  {
    id: "log-4",
    at: "13:42:03",
    level: "INFO",
    service: "events-pipeline",
    message: "consumer group rebalance started (generation 118)",
    incidentId: "INC-2039",
  },
  {
    id: "log-5",
    at: "12:10:44",
    level: "WARN",
    service: "search-svc",
    message: "heap usage crossed 82% on worker-3",
    incidentId: "INC-2038",
  },
  {
    id: "log-6",
    at: "11:55:02",
    level: "INFO",
    service: "api-gateway",
    message: "health check passed for all upstream clusters",
  },
];

export const TRACES: TraceSpan[] = [
  {
    id: "trace-1",
    name: "POST /checkout",
    service: "payments-svc",
    durationMs: 2410,
    status: "error",
    incidentId: "INC-2041",
  },
  {
    id: "trace-2",
    name: "cart.lookup",
    service: "payments-svc",
    durationMs: 1980,
    status: "slow",
    incidentId: "INC-2041",
  },
  {
    id: "trace-3",
    name: "GET /auth/session",
    service: "auth-gateway",
    durationMs: 890,
    status: "error",
    incidentId: "INC-2040",
  },
  {
    id: "trace-4",
    name: "kafka.consume events.orders",
    service: "events-pipeline",
    durationMs: 420,
    status: "slow",
    incidentId: "INC-2039",
  },
  {
    id: "trace-5",
    name: "search.index rebuild",
    service: "search-svc",
    durationMs: 310,
    status: "ok",
    incidentId: "INC-2038",
  },
];

export const SERVICES: ServiceNode[] = [
  {
    id: "api-gateway",
    name: "api-gateway",
    status: "healthy",
    requestsPerMin: 4200,
    errorRate: 0.2,
    deps: ["auth-gateway", "payments-svc"],
  },
  {
    id: "auth-gateway",
    name: "auth-gateway",
    status: "degraded",
    requestsPerMin: 1800,
    errorRate: 4.8,
    deps: ["identity-svc"],
  },
  {
    id: "payments-svc",
    name: "payments-svc",
    status: "critical",
    requestsPerMin: 960,
    errorRate: 12.4,
    deps: ["db-cart-replica", "ledger-svc"],
  },
  {
    id: "events-pipeline",
    name: "events-pipeline",
    status: "degraded",
    requestsPerMin: 2400,
    errorRate: 1.1,
    deps: ["kafka-broker"],
  },
  {
    id: "search-svc",
    name: "search-svc",
    status: "healthy",
    requestsPerMin: 640,
    errorRate: 0.4,
    deps: ["search-index"],
  },
  {
    id: "identity-svc",
    name: "identity-svc",
    status: "healthy",
    requestsPerMin: 1100,
    errorRate: 0.1,
    deps: [],
  },
];

export const METRIC_PANELS: MetricPanel[] = [
  { id: "p99", title: "Checkout p99", value: "2.4s", delta: "+1.2s vs baseline", series: [180, 190, 220, 480, 1200, 2400] },
  { id: "5xx", title: "5xx rate", value: "3.8%", delta: "+2.9% vs 1h ago", series: [0.4, 0.5, 0.6, 1.2, 2.4, 3.8] },
  { id: "lag", title: "Kafka lag", value: "18.2k", delta: "+12k msgs", series: [1200, 2400, 4800, 9200, 14000, 18200] },
  { id: "mttr", title: "MTTR (7d)", value: "18m", delta: "▼ 62%", series: [48, 44, 38, 32, 24, 18] },
];

export function getIncidentById(id: string | null | undefined) {
  if (!id) return undefined;
  return INCIDENTS.find((inc) => inc.id === id);
}
