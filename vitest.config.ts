import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      thresholds: {
        global: {
          lines: 90,
          branches: 80
        }
      }
    }
  }
});
