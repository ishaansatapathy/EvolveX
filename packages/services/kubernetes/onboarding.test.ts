import { describe, expect, it } from "vitest";

import {
  buildKubernetesOnboardingPlan,
  generateKubernetesWebhookSecret,
  resolveHelmChartReference,
} from "./onboarding";

describe("kubernetes onboarding (#29/#30)", () => {
  it("generates stable-length webhook secrets", () => {
    const secret = generateKubernetesWebhookSecret();
    expect(secret).toHaveLength(48);
  });

  it("builds helm install command with org-scoped values", () => {
    const plan = buildKubernetesOnboardingPlan({
      organizationId: "11111111-1111-1111-1111-111111111111",
      clusterName: "production",
      webhookSecret: "abc123",
      baseUrl: "http://localhost:8000",
    });

    expect(plan.helmInstallCommand).toContain("helm upgrade --install evolvex-agent");
    expect(plan.helmInstallCommand).toContain("evolvex.webhookSecret=abc123");
    expect(plan.helmInstallCommand).toContain("11111111-1111-1111-1111-111111111111");
    expect(plan.webhookUrl).toBe("http://localhost:8000/webhooks/kubernetes");
    expect(plan.helmInstallCommand).toContain("./helm/evolvex-agent");
  });

  it("uses GHCR OCI chart in production", () => {
    const chart = resolveHelmChartReference({ NODE_ENV: "production" });
    expect(chart.source).toBe("oci");
    expect(chart.chart).toBe("oci://ghcr.io/ishaansatapathy/evolvex-agent");
    expect(chart.version).toBe("0.1.0");

    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const plan = buildKubernetesOnboardingPlan({
        organizationId: "11111111-1111-1111-1111-111111111111",
        clusterName: "production",
        webhookSecret: "abc123",
        baseUrl: "https://api.example.com",
      });

      expect(plan.helmInstallCommand).toContain("oci://ghcr.io/ishaansatapathy/evolvex-agent");
      expect(plan.helmInstallCommand).toContain("--version 0.1.0");
      expect(plan.notes.some((note) => note.includes("no Evolvex repo clone"))).toBe(true);
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
    }
  });

  it("honours EVOLVEX_HELM_CHART_OCI override", () => {
    const chart = resolveHelmChartReference({
      NODE_ENV: "development",
      EVOLVEX_HELM_CHART_OCI: "oci://ghcr.io/custom/evolvex-agent",
      EVOLVEX_HELM_CHART_VERSION: "1.2.3",
    });
    expect(chart.chart).toBe("oci://ghcr.io/custom/evolvex-agent");
    expect(chart.version).toBe("1.2.3");
  });
});
