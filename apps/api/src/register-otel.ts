import { registerOtel } from "@repo/services/signoz/register-otel";

registerOtel(process.env.OTEL_SERVICE_NAME?.trim() || "evolvex-api");
