#!/usr/bin/env node
/**
 * T-074: ES Module purity checker
 *
 * Verifies that all TypeScript files in src/ use ES module syntax
 * (import/export) and do NOT use CommonJS (require/module.exports).
 *
 * Exception: files in src/core/, src/observability/, src/patterns/
 * that explicitly use the dual-runtime require() pattern documented
 * in docs/SECURITY.md are allowlisted via .esmignore.
 *
 * Usage:
 *   node bin/testing/check-esm.js              # check all src/**\/*.ts
 *   node bin/testing/check-esm.js --files a.ts b.ts  # lint-staged mode
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const { glob } = require("glob");

const ROOT_DIR = path.resolve(__dirname, "../..");

// ── Allowlist: files that intentionally use require() for Node.js dual-context
const ALLOWLIST = new Set([
  "src/core/client-resolver.ts",
  "src/core/audit-logger.ts",
  "src/core/rbac.ts",
  "src/core/rbac-enforcer.ts",
  "src/core/slo-evaluator.ts",
  "src/core/threshold-manager.ts",
  "src/core/config-tracker.ts",
  "src/core/execution-isolation.ts",
  "src/core/report-isolation.ts",
  "src/core/check-system.ts",
  "src/core/cli.ts",
  "src/core/config-loader.ts",
  "src/core/execution-engine.ts",
  "src/core/profile-loader.ts",
  "src/core/secrets-manager.ts",
  "src/core/client-validator.ts",
  "src/observability/generator-health.ts",
  "src/observability/overhead-detector.ts",
  "src/patterns/mock-server.ts",
  "src/patterns/chaos-injection.ts",
]);

// ── CJS patterns to detect ────────────────────────────────────────────────────
const CJS_PATTERNS = [
  { re: /\brequire\s*\(/, label: "require() call" },
  { re: /\bmodule\.exports\b/, label: "module.exports" },
  { re: /\bexports\.\w+\s*=/, label: "exports.X = ..." },
];

// ── File collection ───────────────────────────────────────────────────────────

const isFilesMode = process.argv.includes("--files");
let filesToCheck;

if (isFilesMode) {
  // lint-staged passes files after --files
  const idx = process.argv.indexOf("--files");
  filesToCheck = process.argv.slice(idx + 1).filter(f => f.endsWith(".ts") && f.includes("src/"));
} else {
  filesToCheck = glob.sync("src/**/*.ts", { cwd: ROOT_DIR });
}

if (filesToCheck.length === 0) {
  process.exit(0);
}

// ── Check ─────────────────────────────────────────────────────────────────────

let violations = 0;

for (const file of filesToCheck) {
  // Normalize to relative path
  const rel = path.relative(ROOT_DIR, path.isAbsolute(file) ? file : path.join(ROOT_DIR, file));

  if (ALLOWLIST.has(rel)) continue;

  const content = fs.readFileSync(path.join(ROOT_DIR, rel), "utf-8");
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { re, label } of CJS_PATTERNS) {
      if (re.test(line)) {
        console.error(`${rel}:${i + 1}: CJS syntax detected (${label})`);
        console.error(`  ${line.trim()}`);
        console.error(`  → Use ES module syntax: import/export`);
        violations++;
      }
    }
  }
}

if (violations > 0) {
  console.error(`\n${violations} ESM violation(s) found. Fix before committing.`);
  process.exit(1);
}

process.exit(0);
