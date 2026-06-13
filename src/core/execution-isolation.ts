/**
 * T-030: Execution isolation between clients
 *
 * Ensures that each test execution operates in a fully isolated context:
 * - Only the active client's env vars are visible
 * - Secrets resolve exclusively from the active client's namespace
 * - Metrics are tagged with the active client's identifier
 * - Temp files and artifacts go to client-isolated directories
 * - Error messages don't leak information about other clients
 *
 * This module provides the isolation wrapper around execution-engine.
 * Runs in Node.js context (bin/run-test.sh).
 */

import { ClientContext } from "../types/client.d";
import { resolveClient } from "./client-resolver";

const path = require("path") as typeof import("path");
const fs = require("fs") as typeof import("fs");
const os = require("os") as typeof import("os");

// ── Isolated environment builder ──────────────────────────────────────────────

/**
 * Build an isolated environment map for a client execution.
 * Only the active client's env vars and framework globals are included.
 *
 * @param clientContext - Resolved client context
 * @param additionalEnv - Extra env vars to inject (e.g., from CLI args)
 * @returns Sanitized environment map
 */
export function buildIsolatedEnv(
  clientContext: ClientContext,
  additionalEnv: Record<string, string> = {}
): Record<string, string> {
  const env: Record<string, string> = {};

  // 1. Inherit system essentials (PATH, HOME, TERM, etc.)
  const ALLOWED_SYSTEM_VARS = [
    "PATH",
    "HOME",
    "USER",
    "SHELL",
    "TERM",
    "LANG",
    "LC_ALL",
    "TZ",
    "TMPDIR",
    "DISPLAY",
    "XDG_RUNTIME_DIR",
  ];
  for (const key of ALLOWED_SYSTEM_VARS) {
    if (process.env[key]) {
      env[key] = process.env[key]!;
    }
  }

  // 2. Framework-level vars (K6_* prefixed)
  const FRAMEWORK_VARS = [
    "K6_CLIENT",
    "K6_ENV",
    "K6_PROFILE",
    "K6_TEST_NAME",
    "K6_STRUCTURED_LOGS",
    "K6_DEBUG",
    "K6_USER",
    "K6_AUDIT_USER",
    "K6_SECRETS_BACKENDS",
  ];
  for (const key of FRAMEWORK_VARS) {
    if (process.env[key]) {
      env[key] = process.env[key]!;
    }
  }

  // 3. Client-specific env vars from .env file
  const clientEnv = loadClientEnvFile(clientContext);
  Object.assign(env, clientEnv);

  // 4. Client-specific secrets (K6_SECRET_* prefixed for this client only)
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("K6_SECRET_") && value) {
      env[key] = value;
    }
  }

  // 5. Override with explicit client identifiers
  env["K6_CLIENT"] = clientContext.clientId;
  env["K6_CLIENT_ROOT"] = clientContext.rootDir;
  env["K6_CLIENT_CONFIG_DIR"] = clientContext.configDir;
  env["K6_CLIENT_DATA_DIR"] = clientContext.dataDir;
  env["K6_CLIENT_REPORTS_DIR"] = clientContext.reportsDir;

  // 6. Merge additional env (CLI args, etc.) — highest priority
  Object.assign(env, additionalEnv);

  return env;
}

/**
 * Load env vars from a client's .env file.
 * Format: KEY=VALUE, one per line. Lines starting with # are comments.
 */
function loadClientEnvFile(clientContext: ClientContext): Record<string, string> {
  const envFile = clientContext.envFile;
  const result: Record<string, string> = {};

  if (!fs.existsSync(envFile)) {
    return result;
  }

  const content = fs.readFileSync(envFile, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

// ── Temp directory isolation ──────────────────────────────────────────────────

/**
 * Create an isolated temporary directory for a client's execution.
 * Automatically cleaned up post-execution.
 *
 * @returns Path to the isolated temp directory
 */
export function createIsolatedTempDir(clientContext: ClientContext): string {
  const prefix = `k6-${clientContext.clientId}-`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return tmpDir;
}

/**
 * Clean up an isolated temporary directory.
 * Fails silently if the directory doesn't exist.
 */
export function cleanupIsolatedTempDir(tmpDir: string): void {
  try {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn(
      `[execution-isolation] Warning: failed to clean up temp dir: ${(err as Error).message}`
    );
  }
}

// ── Metric tag isolation ──────────────────────────────────────────────────────

/**
 * Build the standard metric tags for a client execution.
 * These tags are injected into k6 to ensure metrics are namespaced.
 */
export function buildIsolatedTags(
  clientContext: ClientContext,
  environment: string,
  profile: string,
  testName: string
): Record<string, string> {
  return {
    client: clientContext.clientId,
    environment,
    profile,
    test_name: testName,
    test_timestamp: new Date().toISOString(),
  };
}

// ── Error sanitization ────────────────────────────────────────────────────────

/**
 * Sanitize an error message to remove references to other clients or system paths.
 * Ensures that a client execution cannot leak information about:
 * - Other client names or paths
 * - Framework internal paths
 * - System-level paths beyond the client's scope
 *
 * @param error - The error to sanitize
 * @param activeClientId - The currently active client
 * @returns Sanitized error message
 */
export function sanitizeErrorForClient(error: Error | string, activeClientId: string): string {
  const msg = typeof error === "string" ? error : error.message;

  // Replace absolute paths with relative ones
  let sanitized = msg;

  // Remove references to the clients/ directory that might reveal other clients
  sanitized = sanitized.replace(/clients\/[a-zA-Z0-9_-]+/g, (match) => {
    const name = match.split("/")[1];
    if (name === activeClientId) return match;
    return "clients/[REDACTED]";
  });

  // Remove absolute filesystem paths (keep only relative parts)
  sanitized = sanitized.replace(/\/[^\s:]+\/k6-framework\//g, "k6-framework/");

  return sanitized;
}

// ── Execution context builder ─────────────────────────────────────────────────

// ── Path containment validation (T-127) ──────────────────────────────────────

/**
 * Validate that a report path resolves within the client's report namespace.
 * Prevents path traversal attacks where a crafted path could write outside
 * the expected reports/<clientId>/ directory.
 *
 * @param reportPath - The report path to validate
 * @param clientContext - The active client context
 * @param frameworkRoot - Absolute path to the framework root directory
 */
export function validateReportPath(
  reportPath: string,
  clientContext: ClientContext,
  frameworkRoot: string
): void {
  const resolved = path.resolve(reportPath);
  const reportsBase = path.resolve(frameworkRoot, "reports");
  const clientReportsDir = path.join(reportsBase, clientContext.clientId);

  // Allow paths inside reports/<clientId>/ only
  const insideClientDir =
    resolved === clientReportsDir || resolved.startsWith(clientReportsDir + path.sep);

  if (!insideClientDir) {
    throw new Error(
      `[execution-isolation] Report path '${path.basename(reportPath)}' ` +
        `resolves outside the namespace of client '${clientContext.clientId}'. ` +
        `Expected prefix: ${clientReportsDir}`
    );
  }
}

/** Full isolated execution context for a client test run */
export interface IsolatedExecutionContext {
  clientContext: ClientContext;
  env: Record<string, string>;
  tags: Record<string, string>;
  tempDir: string;
}

/**
 * Build a complete isolated execution context for a client.
 * Call this before spawning a k6 subprocess.
 *
 * @param clientName - Client identifier
 * @param environment - Target environment
 * @param profile - Load profile name
 * @param testName - Test scenario name
 * @param additionalEnv - Extra env vars
 * @param frameworkRoot - Optional framework root override
 */
export function buildIsolatedContext(
  clientName: string,
  environment: string,
  profile: string,
  testName: string,
  additionalEnv: Record<string, string> = {},
  frameworkRoot?: string
): IsolatedExecutionContext {
  const clientContext = resolveClient(clientName, frameworkRoot);

  const env = buildIsolatedEnv(clientContext, {
    K6_ENV: environment,
    K6_PROFILE: profile,
    K6_TEST_NAME: testName,
    ...additionalEnv,
  });

  const tags = buildIsolatedTags(clientContext, environment, profile, testName);
  const tempDir = createIsolatedTempDir(clientContext);

  return { clientContext, env, tags, tempDir };
}
