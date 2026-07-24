import { describe, expect, it } from "vitest";

import { buildKubernetesOnboardingPlan, generateKubernetesWebhookSecret } from "./onboarding";

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
  });
});
