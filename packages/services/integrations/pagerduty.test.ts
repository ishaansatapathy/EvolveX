import { describe, expect, it } from "vitest";

import { isPagerDutyConfigured } from "./pagerduty";

describe("pagerduty integration", () => {
  it("detects routing key configuration", () => {
    const original = process.env.PAGERDUTY_ROUTING_KEY;
    process.env.PAGERDUTY_ROUTING_KEY = "";
    expect(isPagerDutyConfigured()).toBe(false);
    process.env.PAGERDUTY_ROUTING_KEY = "routing-key-test";
    expect(isPagerDutyConfigured()).toBe(true);
    process.env.PAGERDUTY_ROUTING_KEY = original;
  });
});
