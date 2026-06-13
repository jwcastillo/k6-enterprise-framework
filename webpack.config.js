const path = require("path");
const { glob } = require("glob");
const fs = require("fs");
const CopyWebpackPlugin = require("copy-webpack-plugin");

// Files to exclude from bundling (reference scenarios with unimplemented dependencies)
const excludeFromBuild = ["clients/_reference/scenarios/api/16-redis-data-pool.ts"];
const excludeClients = [];
// Patterns to exclude: legacy scenarios with broken imports
const excludePatterns = [];

// Auto-discover all scenario entry points in clients/
// Canonical bucket taxonomy: api/, flow/, domain/, chaos/, perf/ (Phase 2 TST-01/TST-03)
const scenarioEntries = Object.fromEntries(
  glob
    .sync("clients/*/scenarios/**/*.ts")
    .filter((file) => !excludeFromBuild.includes(file))
    .filter((file) => !excludeClients.some((c) => file.startsWith(`clients/${c}/`)))
    .filter((file) => !excludePatterns.some((p) => file.includes(p)))
    .map((file) => {
      // e.g. clients/_reference/scenarios/api/smoke-users.ts -> dist/reference/api/smoke-users.js
      // e.g. clients/<client>/scenarios/domain/acl/_root.ts -> dist/<client>/domain/acl/_root.js
      const parts = file
        .replace(/^clients\//, "")
        .replace(/\.ts$/, "")
        .split("/");
      const clientName = parts[0].replace(/^_/, "");
      // parts[1] is always "scenarios"; subPath is everything after the bucket-root
      const subPath = parts.slice(2).join("/");
      const outKey = `${clientName}/${subPath}`;
      return [outKey, path.resolve(__dirname, file)];
    })
);

module.exports = {
  mode: "production",
  entry: scenarioEntries,
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name].js",
    libraryTarget: "commonjs",
  },
  resolve: {
    extensions: [".ts", ".js"],
    extensionAlias: {
      ".js": [".ts", ".js"],
    },
    alias: {
      "@core": path.resolve(__dirname, "src/core"),
      "@helpers": path.resolve(__dirname, "src/helpers"),
      "@node": path.resolve(__dirname, "src/node"),
      "@observability": path.resolve(__dirname, "src/observability"),
      "@patterns": path.resolve(__dirname, "src/patterns"),
      "@reporting": path.resolve(__dirname, "src/reporting"),
      "@types-k6": path.resolve(__dirname, "src/types"),
    },
    fallback: {
      fs: false,
      http: false,
      https: false,
      path: false,
      url: false,
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: {
          loader: "ts-loader",
          options: {
            transpileOnly: true, // Type checking done separately via npm run typecheck
          },
        },
        exclude: /node_modules/,
      },
    ],
  },
  target: "web", // k6 uses goja (browser-like), not Node.js
  externals: /^(k6|https?:\/\/)(\/.*)?$/, // k6 builtins + jslib are external
  performance: {
    hints: false, // Suppress size warnings (ajv bundles are large but valid)
  },
  optimization: {
    minimize: true,
  },
  plugins: [
    // Copy data/ and config/ files so k6 open() calls resolve at runtime.
    // Scenarios at dist/{client}/{subdir}/ use open("../../data/file") → dist/data/file
    // Tests at dist/{client}/tests/{subdir}/ use open("../../data/file") → dist/{client}/data/file
    new CopyWebpackPlugin({
      patterns: [
        // Flat copy for scenarios: dist/data/
        ...glob
          .sync("clients/*/data")
          .filter((dir) => fs.statSync(dir).isDirectory())
          .filter((dir) => !excludeClients.some((c) => dir.startsWith(`clients/${c}/`)))
          .map((dir) => ({
            from: path.resolve(__dirname, dir, "**/*"),
            to: path.resolve(__dirname, "dist/data/[name][ext]"),
            noErrorOnMissing: true,
          })),
        // Per-client copy for tests: dist/{client}/data/
        ...glob
          .sync("clients/*/data")
          .filter((dir) => fs.statSync(dir).isDirectory())
          .filter((dir) => !excludeClients.some((c) => dir.startsWith(`clients/${c}/`)))
          .map((dir) => {
            const client = dir.split("/")[1].replace(/^_/, "");
            return {
              from: path.resolve(__dirname, dir, "**/*"),
              to: path.resolve(__dirname, `dist/${client}/data/[name][ext]`),
              noErrorOnMissing: true,
            };
          }),
        // Flat copy for scenarios: dist/config/
        ...glob
          .sync("clients/*/config")
          .filter((dir) => fs.statSync(dir).isDirectory())
          .filter((dir) => !excludeClients.some((c) => dir.startsWith(`clients/${c}/`)))
          .filter((dir) => !excludePatterns.some((p) => dir.includes(p)))
          .map((dir) => ({
            from: path.resolve(__dirname, dir, "**/*.json"),
            to: path.resolve(__dirname, "dist/config/[name][ext]"),
            noErrorOnMissing: true,
          })),
        // Per-client copy for tests: dist/{client}/config/
        ...glob
          .sync("clients/*/config")
          .filter((dir) => fs.statSync(dir).isDirectory())
          .filter((dir) => !excludeClients.some((c) => dir.startsWith(`clients/${c}/`)))
          .filter((dir) => !excludePatterns.some((p) => dir.includes(p)))
          .map((dir) => {
            const client = dir.split("/")[1].replace(/^_/, "");
            return {
              from: path.resolve(__dirname, dir, "**/*.json"),
              to: path.resolve(__dirname, `dist/${client}/config/[name][ext]`),
              noErrorOnMissing: true,
            };
          }),
      ],
    }),
  ],
};
