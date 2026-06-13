/**
 * T-154: Pyroscope continuous profiling instrumentation (k6-safe functions only).
 *
 * Node-only checkPyroscopeHealth moved to src/node/pyroscope-node.ts in Phase 4 (ARC-06,
 * per D-37). This file retains only the k6-runtime-safe functions that can be imported
 * by client scenarios.
 *
 * Automatically attaches Pyroscope profiling labels to k6 requests when
 * the observability stack is active (K6_PYROSCOPE_ENABLED=true).
 *
 * Design principles:
 * - Transparent: existing scripts require zero changes
 * - Graceful degradation: if Pyroscope is unreachable, test continues normally
 * - Label correlation: Pyroscope labels match Prometheus/Tempo tags for cross-signal navigation
 *
 * Node.js context for setup/teardown; compatible with k6 __ENV for runtime config.
 */

// -- Types -------------------------------------------------------------------------

export interface PyroscopeConfig {
  enabled: boolean;
  endpoint: string;
  appName: string;
  labels: Record<string, string>;
}

export interface PyroscopeHealthResult {
  reachable: boolean;
  latencyMs: number;
  error?: string;
}

// -- Config resolution -------------------------------------------------------------

/**
 * Resolve Pyroscope configuration from environment variables.
 * Called in Node.js context (bin/) before k6 execution.
 */
export function resolvePyroscopeConfig(env: Record<string, string | undefined>): PyroscopeConfig {
  return {
    enabled: env["K6_PYROSCOPE_ENABLED"] === "true",
    endpoint: env["K6_PYROSCOPE_ENDPOINT"] ?? env["PYROSCOPE_ENDPOINT"] ?? "http://localhost:4040",
    appName: `k6-${env["K6_CLIENT"] ?? "framework"}.${env["K6_PROFILE"] ?? "smoke"}`,
    labels: {
      client: env["K6_CLIENT"] ?? "unknown",
      profile: env["K6_PROFILE"] ?? "smoke",
      environment: env["K6_ENV"] ?? "default",
      test: env["K6_TEST_NAME"] ?? "unknown",
    },
  };
}

/**
 * Build the Pyroscope profiling header value for HTTP requests.
 * Format: "key=value,key2=value2" (Pyroscope push-based labels).
 */
export function buildPyroscopeHeader(config: PyroscopeConfig): string {
  const labelStr = Object.entries(config.labels)
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
  return `${config.appName}{${labelStr}}`;
}

/**
 * Build k6 params object with Pyroscope profiling headers injected.
 * Drop-in replacement for raw params -- transparent to existing scripts.
 *
 * @param baseParams - Existing k6 request params (headers, tags, etc.)
 * @param config - Resolved Pyroscope config
 * @returns Enhanced params with X-Pyroscope-App-Name header
 */
export function withPyroscopeLabels(
  baseParams: Record<string, unknown>,
  config: PyroscopeConfig,
): Record<string, unknown> {
  if (!config.enabled) return baseParams;

  const existingHeaders = (baseParams.headers as Record<string, string>) ?? {};
  return {
    ...baseParams,
    headers: {
      ...existingHeaders,
      "X-Pyroscope-App-Name": buildPyroscopeHeader(config),
    },
  };
}

/**
 * Log Pyroscope instrumentation status to console.
 * Called from run-test.sh wrapper via Node.js before k6 execution.
 */
export function logPyroscopeStatus(config: PyroscopeConfig, health: PyroscopeHealthResult): void {
  if (!config.enabled) {
    console.log("[pyroscope] Profiling disabled (K6_PYROSCOPE_ENABLED != true)");
    return;
  }

  if (health.reachable) {
    console.log(
      `[pyroscope] ✓ Connected to ${config.endpoint} (${health.latencyMs}ms) -- ` +
      `app: ${config.appName}, labels: ${JSON.stringify(config.labels)}`,
    );
  } else {
    console.warn(
      `[pyroscope] ⚠ Unreachable (${health.error ?? "unknown error"}) -- ` +
      "test will continue without profiling. Check --profile observability stack.",
    );
  }
}
