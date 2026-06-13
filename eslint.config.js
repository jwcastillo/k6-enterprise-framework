// eslint.config.js — ESLint v10 flat config (migrated from .eslintrc.json)
const tsParser = require("@typescript-eslint/parser");
const tsPlugin = require("@typescript-eslint/eslint-plugin");

module.exports = [
  {
    // Apply to all TypeScript source files
    files: ["src/**/*.ts", "clients/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: "module",
        project: "./tsconfig.json",
      },
      globals: {
        // ES2020 globals
        Promise: "readonly",
        Map: "readonly",
        Set: "readonly",
        Symbol: "readonly",
        BigInt: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        __ENV: "readonly", // k6 global
        __VU: "readonly", // k6 global
        __ITER: "readonly", // k6 global
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      // TypeScript rules
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/explicit-function-return-type": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],

      // ESLint core rules (manually replicate eslint:recommended subset)
      "no-console": "off",
      "no-undef": "off", // TypeScript handles this better
      "no-unused-vars": "off", // handled by @typescript-eslint/no-unused-vars
      "no-constant-condition": "warn",
      "no-debugger": "error",
    },
  },
  {
    // F-02: Vitest test files need the TS parser too — a later block applies
    // no-restricted-imports to test/**/*.ts, so they get linted, but with the
    // default espree parser they fail with "Parsing error: Unexpected token as".
    // NOTE: `parserOptions.project` is intentionally omitted: test/ is NOT in
    // tsconfig.json `include` (only src/ and clients/), so type-aware linting
    // would throw "file not found in project". None of the active rules are
    // type-aware; Vitest type-checks tests separately.
    files: ["test/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      // Off for tests: it/describe callbacks and inline mocks rarely annotate
      // returns — keeping it would only flood the output with noise warnings.
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "no-console": "off",
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-constant-condition": "warn",
      "no-debugger": "error",
    },
  },
  {
    // D-23 (Phase 4 ARC-06): Forbid @node/* imports from client scenarios.
    // src/node/ modules use Node.js built-ins (fs, http, path) that are NOT
    // available in the k6 goja runtime -- importing them would crash at bundle time.
    files: ["clients/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@node/*", "*/node/*"],
              message:
                "@node/* modules use Node.js built-ins incompatible with the k6 goja runtime. " +
                "Import from @core, @helpers, @patterns, or @observability instead.",
            },
            {
              group: ["@pyroscope/nodejs", "@pyroscope/nodejs/*"],
              message:
                "@pyroscope/nodejs is Node-only and forbidden in k6 scenarios. " +
                "Import startContinuous/stopContinuous from @node/pyroscope-node only " +
                "from bin/ orchestration (Node-side), never from client scenarios " +
                "(k6 goja runtime crashes on Node built-ins). See OBS2-02.",
            },
          ],
        },
      ],
    },
  },
  {
    // Phase 5 / AI-01 (D-02): Enforce @anthropic-ai/sdk import boundary.
    // Only anthropic-provider.ts is allowed to import the SDK directly.
    // All other AI code must use LLMProvider abstraction.
    files: ["src/**/*.ts", "test/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@anthropic-ai/sdk",
              message:
                "Import @anthropic-ai/sdk only inside src/ai/core/providers/anthropic-provider.ts. Use LLMProvider abstraction elsewhere (Phase 5 / AI-01 / D-02).",
            },
          ],
        },
      ],
    },
  },
  {
    // OBS2-02 (Phase 09): Forbid @pyroscope/nodejs imports outside src/node/.
    // src/node/pyroscope-node.ts is the single ARC-06 boundary file allowed to
    // require the SDK. Everything else under src/ (including src/observability/
    // pyroscope-instrumentation.ts, which is k6-safe) must NOT touch it.
    files: ["src/**/*.ts"],
    ignores: ["src/node/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@pyroscope/nodejs",
              message:
                "@pyroscope/nodejs is Node-only and must be imported only from " +
                "src/node/pyroscope-node.ts (the single ARC-06 boundary file). " +
                "Use @observability/pyroscope-instrumentation for k6-safe helpers. " +
                "See OBS2-02.",
            },
          ],
          patterns: [
            {
              group: ["@pyroscope/nodejs/*"],
              message:
                "@pyroscope/nodejs sub-paths are Node-only and must be imported only " +
                "from src/node/pyroscope-node.ts. See OBS2-02.",
            },
          ],
        },
      ],
    },
  },
  {
    // Permanent allow: anthropic-provider.ts is the one file allowed to import the SDK
    files: ["src/ai/core/providers/anthropic-provider.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    // Ignore build output and dependencies
    ignores: [
      "node_modules/**",
      "dist/**",
      "mcp-server/node_modules/**",
      "poc/**",
      "archive/**",
      "eslint.config.js",
    ],
  },
];
