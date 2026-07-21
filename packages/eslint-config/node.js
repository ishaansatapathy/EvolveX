import globals from "globals";
import { config as baseConfig } from "./base.js";

/**
 * ESLint config for Node.js packages (api, services, database, trpc).
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const nodeConfig = [
  ...baseConfig,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
