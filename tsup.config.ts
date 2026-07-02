import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/extensions/http/index.ts",
    "src/extensions/depprober/index.ts"
  ],
  format: ["esm"],
  dts: true,
  splitting: false,
  // Sourcemaps are intentionally not emitted: they are not published (see
  // package.json "files") and this keeps the build output free of dead artifacts.
  sourcemap: false,
  treeshake: true,
  clean: true,
  outDir: "dist",
  target: "node20"
});
