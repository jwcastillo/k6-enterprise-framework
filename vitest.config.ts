import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@core": path.resolve(__dirname, "src/core"),
      "@helpers": path.resolve(__dirname, "src/helpers"),
      "@node": path.resolve(__dirname, "src/node"),
      "@observability": path.resolve(__dirname, "src/observability"),
      "@patterns": path.resolve(__dirname, "src/patterns"),
      "@types-k6": path.resolve(__dirname, "src/types"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      // Phase 2 D-39: client-with-legacy-tests-layout is a NEGATIVE-test fixture
      // (k6 scenario stubs whose filenames end in .test.ts). They are consumed
      // as input by the export-client E2E test, not run as Vitest tests.
      "test/fixtures/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "json-summary"],
      include: [
        "src/core/**/*.ts",
        "src/helpers/**/*.ts",
        "src/patterns/**/*.ts",
        "src/metrics/**/*.ts",
        "src/observability/**/*.ts",
        "src/reporting/**/*.ts",
      ],
      exclude: [
        "src/**/*.d.ts",
        "src/**/index.ts",
        "src/types/**",
        "src/ai/**",
        "src/integrations/bot/**",
      ],
      thresholds: {
        lines: 60,
        functions: 55,
        branches: 60,
        statements: 60,
      },
    },
  },
});
