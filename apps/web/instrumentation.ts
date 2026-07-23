export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerOtel } = await import("@repo/services/signoz/register-otel");
    registerOtel(process.env.OTEL_SERVICE_NAME?.trim() || "evolvex-web");
  }
}
