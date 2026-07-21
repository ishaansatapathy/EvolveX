import { nodeConfig } from "@repo/eslint-config/node-js";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...nodeConfig,
  {
    files: ["scripts/**/*.ts"],
    rules: {
      "turbo/no-undeclared-env-vars": "off",
    },
  },
];
