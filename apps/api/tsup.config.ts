import { defineConfig } from "tsup";

const shared = {
  splitting: false as const,
  bundle: true,
  env: { IS_SERVER_BUILD: "true" },
  loader: { ".json": "copy" as const },
  minify: false,
  sourcemap: false,
  target: "es2022" as const,
};

export default defineConfig({
  ...shared,
  entry: ["./src/index.ts", "./src/server.ts", "./src/api-bootstrap.ts"],
  format: "cjs",
  outDir: "./dist",
  clean: true,
  noExternal: [/^@repo\//],
  external: [],
});
