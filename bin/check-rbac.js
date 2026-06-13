#!/usr/bin/env node
/**
 * SEC-01: RBAC execution-permission gate for bin/run-test.sh
 *
 * Bridges run-test.sh Step 2b into src/core/rbac-enforcer.enforceExecutionPermissions().
 * Exits 0 when the current user is allowed to run the given profile on the given client.
 * Exits 1 with a stderr message when access is denied.
 *
 * Honors K6_RBAC_PERMISSIVE=true (delegated to rbac.ts — no override logic here).
 *
 * Usage:
 *   node bin/check-rbac.js --client=<id> --profile=<name> [--user=<id>] [--root=<framework-root>]
 */

"use strict";

const path = require("path");
const fs = require("fs");

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
  console.error(`[check-rbac] ERROR: ts-node unavailable: ${e.message}`);
  console.error("[check-rbac] Install ts-node: npm install --save-dev ts-node");
  process.exit(1);
}

// ── Import core functions ─────────────────────────────────────────────────────
const { enforceExecutionPermissions } = require("../src/core/rbac-enforcer");
const { resolveCurrentUser } = require("../src/core/rbac");

// ── Argument parsing ───────────────────────────────────────────────────────────
function getArg(name) {
  const prefix = `--${name}=`;
  const m = process.argv.find((a) => a.startsWith(prefix));
  return m ? m.slice(prefix.length) : undefined;
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  require("./_help").printHelp({
    name: "check-rbac",
    description: "RBAC execution-permission gate for bin/run-test.sh (SEC-01)",
    usage:
      "node bin/check-rbac.js --client=<id> --profile=<name> [--user=<id>] [--root=<framework-root>]",
    flags: [
      { flag: "--client=<id>", description: "Client to authorize (required)" },
      { flag: "--profile=<name>", description: "Profile to authorize (required)" },
      { flag: "--user=<id>", description: "Override resolved user (defaults to current OS user)" },
      { flag: "--root=<path>", description: "Framework root (default: parent of bin/)" },
      { flag: "--help, -h", description: "Show this help and exit" },
    ],
    examples: [
      "node bin/check-rbac.js --client=myapp --profile=smoke",
      "node bin/check-rbac.js --client=myapp --profile=load --user=ci-bot",
    ],
  });
  process.exit(0);
}

const client = getArg("client");
const profile = getArg("profile");
const userArg = getArg("user");
const rootArg = getArg("root") ?? path.resolve(__dirname, "..");

if (!client) {
  console.error("[check-rbac] ERROR: --client is required");
  process.exit(1);
}
if (!profile) {
  console.error("[check-rbac] ERROR: --profile is required");
  process.exit(1);
}

// ── Build ClientContext ───────────────────────────────────────────────────────
// Try the framework's client-resolver helper first; fall back to inline construction.
let clientContext;
try {
  const cr = require("../src/core/client-resolver");
  if (typeof cr.resolveClientContext === "function") {
    clientContext = cr.resolveClientContext(client, rootArg);
  }
} catch (_e) {
  // client-resolver not available or does not export resolveClientContext — use inline
}

if (!clientContext) {
  const clientDir = path.join(rootArg, "clients", client);
  clientContext = {
    clientId: client,
    rootDir: clientDir,
    configDir: path.join(clientDir, "config"),
    dataDir: path.join(clientDir, "data"),
    libDir: path.join(clientDir, "lib"),
    scenariosDir: path.join(clientDir, "scenarios"),
    reportsDir: path.join(rootArg, "reports", client),
    envFile: path.join(rootArg, "envs", `${client}.env`),
    mocksDir: path.join(clientDir, "mocks"),
    brandingDir: path.join(clientDir, "branding"),
    isSubmodule: false,
    isSymlink: false,
  };
}

// ── RBAC enforcement ──────────────────────────────────────────────────────────
const user = userArg ?? resolveCurrentUser();

try {
  enforceExecutionPermissions(clientContext, profile, user);
  process.exit(0);
} catch (err) {
  console.error(`[check-rbac] ${err.message}`);
  process.exit(1);
}
