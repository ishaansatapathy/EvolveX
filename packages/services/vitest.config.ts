import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/evolvex_test",
    },
  },
});
