import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        // Barrel files are re-exports only; nothing to cover.
        "src/index.ts",
        "src/extensions/**/index.ts"
      ],
      thresholds: {
        global: {
          lines: 95,
          branches: 88,
          functions: 100,
          statements: 95
        }
      }
    }
  }
});
