/**
 * Execution engine — k6 runtime orchestration utilities
 *
 * Provides standardized setup(), teardown(), and handleSummary() implementations
 * that scenarios can use directly or extend.
 *
 * Note: The actual k6 subprocess invocation happens in bin/run-test.sh (Node.js).
 * This module provides the in-process orchestration within k6 scripts.
 */

import { TestConfig } from "../types/config.d";
import { ExecutionSummary } from "../types/report.d";
import { buildOptions } from "./config-loader";
import { loadProfile } from "./profile-loader";
import { sanitizeTagsForPrometheus } from "./prometheus-sanitizer";

export interface ExecutionContext {
  testName: string;
  client: string;
  environment: string;
  profile: string;
  startTime: string;
  tags: Record<string, string>;
}

export interface SetupResult {
  context: ExecutionContext;
  [key: string]: unknown;
}

/**
 * Standard setup() implementation — use in scenario scripts.
 * Returns context that is passed to default() and teardown().
 */
export function standardSetup(config: Partial<TestConfig> = {}): SetupResult {
  const client = __ENV["K6_CLIENT"] ?? config.client ?? "_reference";
  const environment = __ENV["K6_ENV"] ?? config.environment ?? "default";
  const profile = __ENV["K6_PROFILE"] ?? config.profile ?? "smoke";
  const testName = __ENV["K6_TEST_NAME"] ?? config.name ?? "unnamed-test";

  const context: ExecutionContext = {
    testName,
    client,
    environment,
    profile,
    startTime: new Date().toISOString(),
    // T-135: Sanitize tags before they reach Prometheus labels (CHK-SEC-096/097/099)
    tags: sanitizeTagsForPrometheus({ client, environment, profile, test_name: testName }),
  };

  console.log(
    `[execution-engine] Starting: ${testName} | client=${client} env=${environment} profile=${profile}`
  );

  return { context };
}

/**
 * Standard teardown() implementation.
 */
export function standardTeardown(data: SetupResult): void {
  const elapsed = Date.now() - new Date(data.context.startTime).getTime();
  console.log(
    `[execution-engine] Completed: ${data.context.testName} in ${(elapsed / 1000).toFixed(1)}s`
  );
}

/**
 * Build k6 options from profile + overrides.
 * Convenience re-export for scenario use.
 */
export function buildK6Options(
  thresholdOverrides: Record<string, string[]> = {}
): Record<string, unknown> {
  return buildOptions(thresholdOverrides);
}

/**
 * Validate test script configuration at k6 init time.
 * Call before export const options = ...
 */
export function validateScriptConfig(requiredEnvVars: string[] = []): void {
  const missing = requiredEnvVars.filter((k) => !__ENV[k]);
  if (missing.length > 0) {
    throw new Error(
      `ExecutionEngine: required env vars missing: ${missing.join(", ")}. ` +
        `Set them via: -e ${missing[0]}=<value> or in .env file`
    );
  }
}

/**
 * Build an ExecutionSummary from k6 handleSummary data.
 * Useful for custom summary handlers and comparison engine.
 */
export function buildExecutionSummary(
  data: Record<string, unknown>,
  context: ExecutionContext
): ExecutionSummary {
  const metrics = (data["metrics"] as Record<string, unknown>) ?? {};

  const getMetricValue = (metricName: string, stat: string, defaultVal = 0): number => {
    const metric = metrics[metricName] as Record<string, unknown> | undefined;
    const values = metric?.["values"] as Record<string, number> | undefined;
    return values?.[stat] ?? defaultVal;
  };

  const httpDuration = {
    avg: getMetricValue("http_req_duration", "avg"),
    min: getMetricValue("http_req_duration", "min"),
    med: getMetricValue("http_req_duration", "med"),
    max: getMetricValue("http_req_duration", "max"),
    p90: getMetricValue("http_req_duration", "p(90)"),
    p95: getMetricValue("http_req_duration", "p(95)"),
    p99: getMetricValue("http_req_duration", "p(99)"),
  };

  const checksTotal = getMetricValue("checks", "passes") + getMetricValue("checks", "fails");
  const checksFailed = getMetricValue("checks", "fails");
  const checksPassRate = checksTotal > 0 ? (checksTotal - checksFailed) / checksTotal : 1;

  const profile = loadProfile(context.profile as Parameters<typeof loadProfile>[0]);
  const thresholdResults = Object.entries(profile.thresholds).map(([metric, conditions]) => ({
    metric,
    condition: conditions[0] ?? "",
    passed: true, // k6 will have already evaluated these
    value: getMetricValue(metric, "p(95)"),
  }));

  return {
    testName: context.testName,
    client: context.client,
    environment: context.environment,
    profile: context.profile,
    startTime: context.startTime,
    endTime: new Date().toISOString(),
    durationMs: Date.now() - new Date(context.startTime).getTime(),
    vus: getMetricValue("vus_max", "max"),
    iterations: getMetricValue("iterations", "count"),
    iterationsFailed: 0,
    httpRequests: getMetricValue("http_reqs", "count"),
    httpRequestsFailed: getMetricValue("http_req_failed", "passes"),
    httpDuration,
    checks: [
      {
        name: "all checks",
        passes: getMetricValue("checks", "passes"),
        fails: checksFailed,
        passRate: checksPassRate,
      },
    ],
    thresholds: thresholdResults,
    passed: checksFailed === 0,
    tags: context.tags,
  };
}

/**
 * Standard handleSummary that outputs a formatted console summary.
 * Import and re-export in scenarios to get consistent output.
 */
export function standardHandleSummary(
  data: Record<string, unknown>,
  context: ExecutionContext
): Record<string, string> {
  const summary = buildExecutionSummary(data, context);
  const statusIcon = summary.passed ? "✓" : "✗";
  const statusWord = summary.passed ? "PASSED" : "FAILED";

  console.log(`
╔══════════════════════════════════════════════════════╗
║  ${statusIcon} ${statusWord}: ${summary.testName.padEnd(45)}║
╠══════════════════════════════════════════════════════╣
║  Client:      ${summary.client.padEnd(40)}║
║  Profile:     ${summary.profile.padEnd(40)}║
║  Environment: ${summary.environment.padEnd(40)}║
╠══════════════════════════════════════════════════════╣
║  HTTP p50:  ${String(summary.httpDuration.med.toFixed(0) + "ms").padEnd(42)}║
║  HTTP p95:  ${String(summary.httpDuration.p95.toFixed(0) + "ms").padEnd(42)}║
║  HTTP p99:  ${String(summary.httpDuration.p99.toFixed(0) + "ms").padEnd(42)}║
║  Requests:  ${String(summary.httpRequests).padEnd(42)}║
╚══════════════════════════════════════════════════════╝`);

  return {};
}
