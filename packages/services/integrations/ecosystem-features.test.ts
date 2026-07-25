import { describe, expect, it } from "vitest";

import { buildIntegrationsEcosystemFeatures } from "./ecosystem-features";

describe("integrations ecosystem features (#46-#60)", () => {
  it("marks core DX features as active", () => {
    const features = buildIntegrationsEcosystemFeatures();
    expect(features.find((f) => f.id === "#59")?.status).toBe("active");
    expect(features.find((f) => f.id === "#60")?.status).toBe("active");
  });

  it("reports github deploy correlation partial when only webhook is configured", () => {
    const features = buildIntegrationsEcosystemFeatures({
      orgGithubWebhookConfigured: true,
      orgGithubConfigured: false,
    });
    expect(features.find((f) => f.id === "#49")?.status).toBe("partial");
  });
});
