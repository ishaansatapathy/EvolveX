import crypto from "node:crypto";

export type OtlpIngestConfig = {
  ingestionKey: string;
  ingestionUrl?: string;
  serviceName?: string;
};

export type TraceBatchOptions = {
  serviceName: string;
  errorCount: number;
  successCount?: number;
  /** Healthy ~100ms requests — keeps average latency looking fine in SigNoz */
  fastSuccessCount?: number;
  /** Slow tail requests (2–5s) — drives p95/p99 up in SigNoz (SigNoz computes percentiles, not Evolvex) */
  tailLatencyCount?: number;
  tailLatencyMs?: number;
};

function randomHex(bytes: number) {
  return crypto.randomBytes(bytes).toString("hex");
}

function nowNano(offsetMs = 0) {
  return (BigInt(Date.now() + offsetMs) * 1_000_000n).toString();
}

function buildCheckoutTrace(
  serviceName: string,
  withError: boolean,
  offsetMs: number,
  totalDurationMs = 100,
) {
  const traceId = randomHex(16);
  const rootSpanId = randomHex(8);
  const cartSpanId = randomHex(8);
  const dbSpanId = randomHex(8);
  const rootStart = nowNano(offsetMs);
  const dbDurationMs = Math.max(40, Math.round(totalDurationMs * 0.75));
  const cartDurationMs = Math.max(8, Math.round(totalDurationMs * 0.08));
  const rootOverheadMs = Math.max(5, totalDurationMs - dbDurationMs - cartDurationMs);

  const cartStart = (BigInt(rootStart) + 12_000_000n).toString();
  const dbStart = (BigInt(cartStart) + BigInt(cartDurationMs) * 1_000_000n).toString();
  const dbEnd = (BigInt(dbStart) + BigInt(dbDurationMs) * 1_000_000n).toString();
  const cartEnd = (BigInt(dbEnd) + 8_000_000n).toString();
  const rootEnd = (BigInt(cartEnd) + BigInt(rootOverheadMs) * 1_000_000n).toString();

  const errorStatus = { code: 2, message: "checkout pipeline failure — inventory lock timeout" };
  const okStatus = { code: 1 };

  return [
    {
      traceId,
      spanId: rootSpanId,
      parentSpanId: "",
      name: "POST /checkout",
      kind: 2,
      startTimeUnixNano: rootStart,
      endTimeUnixNano: rootEnd,
      attributes: [
        { key: "http.method", value: { stringValue: "POST" } },
        { key: "http.route", value: { stringValue: "/checkout" } },
        { key: "has_error", value: { boolValue: withError } },
      ],
      status: withError ? errorStatus : okStatus,
    },
    {
      traceId,
      spanId: cartSpanId,
      parentSpanId: rootSpanId,
      name: "CartMapper.load",
      kind: 1,
      startTimeUnixNano: cartStart,
      endTimeUnixNano: cartEnd,
      attributes: [{ key: "has_error", value: { boolValue: withError } }],
      status: withError ? errorStatus : okStatus,
    },
    {
      traceId,
      spanId: dbSpanId,
      parentSpanId: cartSpanId,
      name: "db.query.batch",
      kind: 1,
      startTimeUnixNano: dbStart,
      endTimeUnixNano: dbEnd,
      attributes: [
        { key: "db.system", value: { stringValue: "postgresql" } },
        { key: "has_error", value: { boolValue: withError } },
      ],
      status: withError ? errorStatus : okStatus,
    },
  ];
}

export function buildTracePayload(options: TraceBatchOptions) {
  const serviceName = options.serviceName;
  const successCount = options.successCount ?? 0;
  const fastSuccessCount = options.fastSuccessCount ?? 0;
  const tailLatencyCount = options.tailLatencyCount ?? 0;
  const tailLatencyMs = options.tailLatencyMs ?? 4_800;
  const spans = [];
  let offsetIndex = 0;

  const nextOffset = () => {
    offsetIndex += 1;
    return -offsetIndex * 4_000;
  };

  for (let i = 0; i < options.errorCount; i += 1) {
    spans.push(...buildCheckoutTrace(serviceName, true, nextOffset(), 420));
  }

  for (let i = 0; i < tailLatencyCount; i += 1) {
    spans.push(...buildCheckoutTrace(serviceName, false, nextOffset(), tailLatencyMs));
  }

  for (let i = 0; i < fastSuccessCount; i += 1) {
    spans.push(...buildCheckoutTrace(serviceName, false, nextOffset(), 100));
  }

  for (let i = 0; i < successCount; i += 1) {
    spans.push(...buildCheckoutTrace(serviceName, false, nextOffset(), 120));
  }

  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: serviceName } },
            { key: "deployment.environment", value: { stringValue: process.env.NODE_ENV ?? "production" } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "evolvex-loadgen", version: "1.0.0" },
            spans,
          },
        ],
      },
    ],
  };
}

export function buildMetricPayload(serviceName: string, increment: number) {
  const timeUnixNano = nowNano();
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [{ key: "service.name", value: { stringValue: serviceName } }],
        },
        scopeMetrics: [
          {
            scope: { name: "evolvex-loadgen", version: "1.0.0" },
            metrics: [
              {
                name: "signoz_calls_total",
                sum: {
                  aggregationTemporality: 2,
                  isMonotonic: true,
                  dataPoints: [
                    {
                      asInt: String(Math.max(1, increment)),
                      timeUnixNano,
                      attributes: [{ key: "service.name", value: { stringValue: serviceName } }],
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

async function postOtlp(path: "traces" | "metrics", config: OtlpIngestConfig, payload: unknown) {
  const ingestionUrl = (config.ingestionUrl ?? "https://ingest.in2.signoz.cloud").replace(/\/+$/, "");
  const response = await fetch(`${ingestionUrl}/v1/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "signoz-ingestion-key": config.ingestionKey,
    },
    body: JSON.stringify(payload),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`SigNoz ${path} ingestion failed (${response.status}): ${body.slice(0, 300)}`);
  }

  return { status: response.status, body };
}

export async function ingestTraces(config: OtlpIngestConfig, options: TraceBatchOptions) {
  const payload = buildTracePayload(options);
  const result = await postOtlp("traces", config, payload);
  return {
    ...result,
    serviceName: options.serviceName,
    errorCount: options.errorCount,
    successCount: options.successCount ?? 0,
  };
}

export async function ingestMetrics(config: OtlpIngestConfig, serviceName: string, increment: number) {
  const payload = buildMetricPayload(serviceName, increment);
  const result = await postOtlp("metrics", config, payload);
  return { ...result, serviceName, increment };
}
