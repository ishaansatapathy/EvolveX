import crypto from "node:crypto";

type SendDemoTracesOptions = {
  ingestionKey: string;
  ingestionUrl?: string;
  serviceName?: string;
  errorCount?: number;
};

function randomHex(bytes: number) {
  return crypto.randomBytes(bytes).toString("hex");
}

function buildOtlpPayload(serviceName: string, errorCount: number) {
  const now = BigInt(Date.now()) * 1_000_000n;
  const spans = Array.from({ length: errorCount }, (_, index) => {
    const start = now - BigInt((errorCount - index) * 60_000_000_000);
    const end = start + 400_000_000n;
    return {
      traceId: randomHex(16),
      spanId: randomHex(8),
      name: index === 0 ? "POST /checkout" : index === 1 ? "CartMapper.load" : "db.query.batch",
      kind: 1,
      startTimeUnixNano: start.toString(),
      endTimeUnixNano: end.toString(),
      attributes: [{ key: "has_error", value: { boolValue: true } }],
      status: { code: 2, message: "Simulated checkout failure for Evolvex demo" },
    };
  });

  return {
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: "service.name", value: { stringValue: serviceName } }],
        },
        scopeSpans: [
          {
            scope: { name: "evolvex-demo" },
            spans,
          },
        ],
      },
    ],
  };
}

export async function sendDemoTracesToSignoz(options: SendDemoTracesOptions) {
  const ingestionUrl = (options.ingestionUrl ?? "https://ingest.in2.signoz.cloud").replace(/\/+$/, "");
  const serviceName = options.serviceName ?? "payments-svc";
  const errorCount = options.errorCount ?? 3;
  const payload = buildOtlpPayload(serviceName, errorCount);

  const response = await fetch(`${ingestionUrl}/v1/traces`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "signoz-ingestion-key": options.ingestionKey,
    },
    body: JSON.stringify(payload),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`SigNoz ingestion failed (${response.status}): ${body.slice(0, 300)}`);
  }

  return { status: response.status, serviceName, errorCount, body };
}
