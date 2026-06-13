/**
 * T-047: Advanced chaos injection with differentiated reporting (k6-safe functions only).
 *
 * Node-only loadChaosConfig moved to src/node/chaos-injection-node.ts in Phase 4 (ARC-06).
 *
 * Extends T-020 chaos-testing pattern with:
 * - Additional fault types: corruption, partial timeout, rate limiting
 * - Differentiated reporting (chaos errors vs service errors)
 * - Deterministic fault distribution (< 5% variance)
 *
 * k6-safe functions can be called from k6 runtime via pre-configured env.
 */

import {
  ChaosConfig,
  ChaosType,
  ChaosFaultRule,
  ChaosReportBreakdown,
} from "../types/mock.d";

// -- Deterministic fault selection -----------------------------------------------

/**
 * Fault injection state -- tracks counters for deterministic distribution.
 */
interface ChaosState {
  totalRequests: number;
  faultCounters: Map<ChaosType, number>;
  serviceErrors: number;
  chaosInjectedErrors: number;
}

let chaosState: ChaosState = createFreshState();

function createFreshState(): ChaosState {
  return {
    totalRequests: 0,
    faultCounters: new Map(),
    serviceErrors: 0,
    chaosInjectedErrors: 0,
  };
}

/**
 * Reset chaos state (call between test runs).
 */
export function resetChaosState(): void {
  chaosState = createFreshState();
}

/**
 * Determine if a fault should be injected for this request.
 * Uses deterministic round-robin to achieve target probability with < 5% variance.
 *
 * For a fault with probability 0.10, every 10th request will be faulted.
 * This is more deterministic than pure random selection.
 */
function shouldInjectFault(rule: ChaosFaultRule): boolean {
  if (rule.probability <= 0) return false;
  if (rule.probability >= 1) return true;

  // Deterministic: inject every N-th request
  const interval = Math.round(1 / rule.probability);
  const currentCount = chaosState.faultCounters.get(rule.type) ?? 0;
  chaosState.faultCounters.set(rule.type, currentCount + 1);

  return (currentCount + 1) % interval === 0;
}

// -- Fault generators ------------------------------------------------------------

/** Result of a chaos fault evaluation */
export interface ChaosFaultResult {
  /** Whether a fault was injected */
  injected: boolean;
  /** Type of fault injected (null if no fault) */
  type: ChaosType | null;
  /** Fault-specific details */
  details: Record<string, unknown>;
}

/**
 * Evaluate chaos rules for a single request.
 * Returns the first applicable fault (rules are evaluated in order).
 */
export function evaluateChaosRules(
  config: ChaosConfig,
): ChaosFaultResult {
  chaosState.totalRequests++;

  for (const rule of config.faults) {
    if (shouldInjectFault(rule)) {
      chaosState.chaosInjectedErrors++;
      return generateFault(rule);
    }
  }

  return { injected: false, type: null, details: {} };
}

/**
 * Generate a specific fault based on the rule configuration.
 */
function generateFault(rule: ChaosFaultRule): ChaosFaultResult {
  const params = rule.params ?? {};

  switch (rule.type) {
    case "latency":
      return {
        injected: true,
        type: "latency",
        details: {
          delayMs: (params["delayMs"] as number) ?? 2000,
        },
      };

    case "http_error":
      return {
        injected: true,
        type: "http_error",
        details: {
          statusCode: (params["statusCode"] as number) ?? 503,
          body: params["body"] ?? { error: "Chaos: Service Unavailable" },
        },
      };

    case "disconnect":
      return {
        injected: true,
        type: "disconnect",
        details: {
          afterBytes: (params["afterBytes"] as number) ?? 0,
        },
      };

    case "corruption":
      return {
        injected: true,
        type: "corruption",
        details: {
          corruptionType: (params["corruptionType"] as string) ?? "malformed_json",
          // Possible types: malformed_json, missing_fields, truncated, wrong_type
        },
      };

    case "partial_timeout":
      return {
        injected: true,
        type: "partial_timeout",
        details: {
          // Connection succeeds but response never completes
          initialBytes: (params["initialBytes"] as number) ?? 10,
          hangMs: (params["hangMs"] as number) ?? 30000,
        },
      };

    case "rate_limit":
      return {
        injected: true,
        type: "rate_limit",
        details: {
          statusCode: 429,
          retryAfterSec: (params["retryAfterSec"] as number) ?? 30,
          body: { error: "Too Many Requests", retryAfter: (params["retryAfterSec"] as number) ?? 30 },
        },
      };

    default:
      return { injected: false, type: null, details: {} };
  }
}

// -- Service error tracking ------------------------------------------------------

/**
 * Record a service error (not injected by chaos).
 * Call this when the actual service under test returns an error.
 */
export function recordServiceError(): void {
  chaosState.serviceErrors++;
}

// -- Report breakdown ------------------------------------------------------------

/**
 * Build the differentiated error breakdown for reports.
 * Separates chaos-injected errors from genuine service errors.
 */
export function buildChaosReportBreakdown(
  config: ChaosConfig,
): ChaosReportBreakdown {
  return {
    serviceErrors: chaosState.serviceErrors,
    chaosInjectedErrors: chaosState.chaosInjectedErrors,
    chaosConfig: config,
  };
}

/**
 * Format chaos report section for HTML.
 */
export function formatChaosForHtml(breakdown: ChaosReportBreakdown): string {
  const totalErrors = breakdown.serviceErrors + breakdown.chaosInjectedErrors;

  const faultRows = breakdown.chaosConfig.faults
    .map(
      (f) =>
        `<tr>
      <td>${f.type}</td>
      <td>${(f.probability * 100).toFixed(1)}%</td>
      <td>${JSON.stringify(f.params ?? {})}</td>
    </tr>`,
    )
    .join("\n");

  return `
<div class="chaos-report">
  <h3>Chaos Injection Report</h3>
  <p>Target service: <strong>${breakdown.chaosConfig.targetService}</strong></p>

  <div class="error-breakdown">
    <h4>Error Breakdown</h4>
    <table>
      <tr><td>Total errors</td><td><strong>${totalErrors}</strong></td></tr>
      <tr><td>Service errors (genuine)</td><td>${breakdown.serviceErrors}</td></tr>
      <tr><td>Chaos-injected errors</td><td>${breakdown.chaosInjectedErrors}</td></tr>
    </table>
  </div>

  <div class="fault-config">
    <h4>Fault Configuration</h4>
    <table>
      <thead><tr><th>Fault Type</th><th>Probability</th><th>Parameters</th></tr></thead>
      <tbody>${faultRows}</tbody>
    </table>
  </div>
</div>`;
}

/**
 * Format chaos report section for JSON summary.
 */
export function formatChaosForJson(
  breakdown: ChaosReportBreakdown,
): Record<string, unknown> {
  return {
    chaosReport: {
      targetService: breakdown.chaosConfig.targetService,
      serviceErrors: breakdown.serviceErrors,
      chaosInjectedErrors: breakdown.chaosInjectedErrors,
      totalRequests: chaosState.totalRequests,
      faultDistribution: Object.fromEntries(chaosState.faultCounters),
      chaosConfig: {
        faults: breakdown.chaosConfig.faults.map((f) => ({
          type: f.type,
          probability: f.probability,
          params: f.params,
        })),
      },
    },
  };
}
