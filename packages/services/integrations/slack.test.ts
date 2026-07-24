import { describe, expect, it } from "vitest";

import { isSlackConfigured } from "./slack";

describe("slack integration", () => {
  it("detects webhook configuration", () => {
    const original = process.env.SLACK_WEBHOOK_URL;
    process.env.SLACK_WEBHOOK_URL = "";
    expect(isSlackConfigured()).toBe(false);
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/test";
    expect(isSlackConfigured()).toBe(true);
    process.env.SLACK_WEBHOOK_URL = original;
  });
});
