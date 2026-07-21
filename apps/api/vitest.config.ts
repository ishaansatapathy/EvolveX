import { defineConfig } from "vitest/config";
import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 30_000,
    env: {
      HEALTH_CHECK_DATABASE: "false",
      CORSAIR_WEBHOOK_SECRET: "ci-test-webhook-secret-min-16-chars",
    },
  },
});
