#!/usr/bin/env node
/**
 * SEC-02: CLI authentication gate for bin/run-test.sh
 *
 * Bridges run-test.sh Step 2a into src/core/cli-auth.validateCliAuth().
 * Exits 0 on auth success or when K6_AUTH_TOKEN unset (permissive mode).
 * Exits 1 with stderr message on failure.
 *
 * Usage:
 *   node bin/check-cli-auth.js [--token=<provided-token>]
 *   K6_AUTH_TOKEN_PROVIDED=<token> node bin/check-cli-auth.js
 *   node bin/check-cli-auth.js --print-user   # echoes resolved userId to stdout
 */

"use strict";

const path = require("path");

// ── ts-node registration ───────────────────────────────────────────────────────
// Mirrors the pattern from bin/validate-config.js:35-41
// ts-node must be resolvable from the k6-framework root (node_modules/ts-node).
try {
  // Attempt resolution from the framework root so npm worktree / monorepo setups work
  let tsNodePath;
  try {
    tsNodePath = require.resolve("ts-node", { paths: [path.resolve(__dirname, "..")] });
  } catch {
    tsNodePath = "ts-node"; // fall back to ambient require
  }
  require(tsNodePath).register({
    project: path.resolve(__dirname, "../tsconfig.json"),
    transpileOnly: true,
    compilerOptions: { module: "CommonJS" },
  });
} catch (e) {
  console.error(`[check-cli-auth] ERROR: ts-node unavailable: ${e.message}`);
  console.error("[check-cli-auth] Install ts-node: npm install --save-dev ts-node");
  process.exit(1);
}

// ── Import core function ───────────────────────────────────────────────────────
const { validateCliAuth } = require("../src/core/cli-auth");

// ── Argument parsing ───────────────────────────────────────────────────────────
function getArg(name) {
  const prefix = `--${name}=`;
  const m = process.argv.find((a) => a.startsWith(prefix));
  return m ? m.slice(prefix.length) : undefined;
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  require("./_help").printHelp({
    name: "check-cli-auth",
    description: "RBAC CLI authentication gate for bin/run-test.sh (SEC-02)",
    usage: "node bin/check-cli-auth.js [--token=<value>] [--print-user]",
    flags: [
      {
        flag: "--token=<value>",
        description: "Provide auth token (alternative: K6_AUTH_TOKEN_PROVIDED env)",
      },
      { flag: "--print-user", description: "Echo resolved userId to stdout on success" },
      { flag: "--help, -h", description: "Show this help and exit" },
    ],
    examples: [
      "node bin/check-cli-auth.js --token=abc123",
      "K6_AUTH_TOKEN_PROVIDED=abc123 node bin/check-cli-auth.js --print-user",
    ],
  });
  process.exit(0);
}

// Token can come from --token=<value> flag or K6_AUTH_TOKEN_PROVIDED env var
const provided = getArg("token") ?? process.env["K6_AUTH_TOKEN_PROVIDED"];

// ── Auth check ────────────────────────────────────────────────────────────────
const result = validateCliAuth(provided);

if (!result.authenticated) {
  console.error(`[check-cli-auth] Auth failed: ${result.reason ?? "Access denied"}`);
  process.exit(1);
}

// Optionally echo userId so run-test.sh can capture it (e.g. for audit context)
if (process.argv.includes("--print-user")) {
  process.stdout.write(result.userId + "\n");
}

process.exit(0);
