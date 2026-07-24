import { describe, expect, it } from "vitest";

import { PLUGIN_CATALOG, getPluginDefinition } from "./catalog";

describe("plugin catalog (#58)", () => {
  it("ships built-in marketplace plugins", () => {
    expect(PLUGIN_CATALOG.length).toBeGreaterThanOrEqual(4);
    expect(getPluginDefinition("custom-events")?.category).toBe("custom");
    expect(getPluginDefinition("datadog-import")?.category).toBe("import");
    expect(getPluginDefinition("prometheus-alertmanager")?.hooks).toContain("timeline");
  });
});
