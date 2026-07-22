import { ingestTraces } from "./otel-ingest";

type SendDemoTracesOptions = {
  ingestionKey: string;
  ingestionUrl?: string;
  serviceName?: string;
  errorCount?: number;
};

export async function sendDemoTracesToSignoz(options: SendDemoTracesOptions) {
  return ingestTraces(
    {
      ingestionKey: options.ingestionKey,
      ingestionUrl: options.ingestionUrl,
    },
    {
      serviceName: options.serviceName ?? "payments-svc",
      errorCount: options.errorCount ?? 3,
      successCount: 1,
    },
  );
}
