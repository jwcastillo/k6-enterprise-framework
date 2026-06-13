/**
 * T-039: SLO Evaluator per service
 *
 * Evaluates Service Level Objectives against execution results.
 * SLOs are defined in clients/{name}/config/slos.json.
 *
 * Three-state classification:
 * - cumple: actual value is within the target
 * - en_riesgo: actual value is within the risk margin of the target
 * - incumple: actual value exceeds the target
 *
 * Integrates with the existing reporting pipeline (HTML + JSON).
 *
 * Note: Runs in Node.js context (bin/), NOT in k6 goja runtime.
 */

import {
  SloConfig,
  SloServiceDefinition,
  SloEvaluation,
  SloStatus,
} from "../types/slo.d";
import { ExecutionSummary } from "../types/report.d";
import { ClientContext } from "../types/client.d";

const path = require("path") as typeof import("path");
const fs = require("fs") as typeof import("fs");

// ── Config loading ────────────────────────────────────────────────────────────

/**
 * Load SLO configuration for a client.
 * Returns null if no slos.json exists (SLO evaluation is optional).
 */
export function loadSloConfig(clientContext: ClientContext): SloConfig | null {
  const sloPath = path.join(clientContext.configDir, "slos.json");

  if (!fs.existsSync(sloPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(sloPath, "utf-8");
    return JSON.parse(content) as SloConfig;
  } catch (err) {
    throw new Error(
      `SLO Evaluator: failed to parse ${sloPath}: ${(err as Error).message}`,
    );
  }
}

/**
 * Find SLO definitions for a specific service.
 * Returns null if no SLOs are defined for this service.
 */
export function findServiceSlos(
  config: SloConfig,
  serviceName: string,
): SloServiceDefinition | null {
  return (
    config.services.find((s) => s.serviceName === serviceName) ?? null
  );
}

// ── Metric extraction ─────────────────────────────────────────────────────────

/**
 * Extract the actual metric value from an execution summary.
 * Maps SLO metric names to execution summary fields.
 */
function extractMetricValue(
  summary: ExecutionSummary,
  metricName: string,
): number | null {
  const metricMap: Record<string, () => number> = {
    // Latency metrics
    http_req_duration_avg: () => summary.httpDuration.avg,
    http_req_duration_p90: () => summary.httpDuration.p90,
    http_req_duration_p95: () => summary.httpDuration.p95,
    http_req_duration_p99: () => summary.httpDuration.p99,
    http_req_duration_med: () => summary.httpDuration.med,
    http_req_duration_max: () => summary.httpDuration.max,
    // Error rate
    error_rate: () => {
      if (summary.httpRequests === 0) return 0;
      return summary.httpRequestsFailed / summary.httpRequests;
    },
    // Check pass rate (inverted — lower is worse)
    check_failure_rate: () => {
      const total = summary.checks.reduce((sum, c) => sum + c.passes + c.fails, 0);
      if (total === 0) return 0;
      const fails = summary.checks.reduce((sum, c) => sum + c.fails, 0);
      return fails / total;
    },
    // Throughput
    throughput: () => {
      if (summary.durationMs === 0) return 0;
      return summary.httpRequests / (summary.durationMs / 1000);
    },
  };

  const extractor = metricMap[metricName];
  if (!extractor) return null;

  return extractor();
}

// ── Evaluation ────────────────────────────────────────────────────────────────

/**
 * Classify an SLO metric evaluation into one of three states.
 *
 * For upper-bound metrics (latency, error rate):
 * - cumple: actual < target * (1 - riskMargin)
 * - en_riesgo: actual >= target * (1 - riskMargin) AND actual <= target
 * - incumple: actual > target
 */
function classifySloStatus(
  actual: number,
  target: number,
  riskMargin: number,
): SloStatus {
  if (actual > target) {
    return "incumple";
  }

  const riskThreshold = target * (1 - riskMargin);
  if (actual >= riskThreshold) {
    return "en_riesgo";
  }

  return "cumple";
}

/**
 * Evaluate all SLO metrics for a service against execution results.
 *
 * @param serviceDef - SLO definitions for the service
 * @param summary - Execution summary with actual metrics
 * @returns Array of evaluation results
 */
export function evaluateServiceSlos(
  serviceDef: SloServiceDefinition,
  summary: ExecutionSummary,
): SloEvaluation[] {
  const evaluations: SloEvaluation[] = [];

  for (const metric of serviceDef.metrics) {
    const actual = extractMetricValue(summary, metric.name);

    if (actual === null) {
      console.warn(
        `[slo-evaluator] Warning: metric '${metric.name}' not found in execution results. Skipping.`,
      );
      continue;
    }

    const status = classifySloStatus(actual, metric.target, metric.riskMargin);

    evaluations.push({
      service: serviceDef.serviceName,
      metric: metric.name,
      target: metric.target,
      actual,
      status,
      unit: metric.unit,
    });

    // Emit console warnings for at-risk or failing SLOs
    if (status === "en_riesgo") {
      console.warn(
        `[slo-evaluator] ⚠ SLO AT RISK: ${serviceDef.serviceName} / ${metric.name} ` +
          `— actual: ${actual.toFixed(2)}${metric.unit ?? ""}, target: ${metric.target}${metric.unit ?? ""} ` +
          `(within ${(metric.riskMargin * 100).toFixed(0)}% margin)`,
      );
    } else if (status === "incumple") {
      console.error(
        `[slo-evaluator] ✗ SLO VIOLATED: ${serviceDef.serviceName} / ${metric.name} ` +
          `— actual: ${actual.toFixed(2)}${metric.unit ?? ""}, target: ${metric.target}${metric.unit ?? ""}`,
      );
    }
  }

  return evaluations;
}

/**
 * Evaluate SLOs for a test execution.
 * Returns null if no SLOs are defined for the tested service.
 *
 * @param clientContext - Resolved client context
 * @param summary - Execution summary
 * @param serviceName - Optional service name override (defaults to test name)
 */
export function evaluateSlos(
  clientContext: ClientContext,
  summary: ExecutionSummary,
  serviceName?: string,
): SloEvaluation[] | null {
  const config = loadSloConfig(clientContext);
  if (!config) return null;

  const service = serviceName ?? summary.testName;
  const serviceDef = findServiceSlos(config, service);
  if (!serviceDef) return null;

  return evaluateServiceSlos(serviceDef, summary);
}

/**
 * Format SLO evaluations for inclusion in JSON summary reports.
 */
export function formatSloForJson(
  evaluations: SloEvaluation[],
): Record<string, unknown> {
  return {
    sloCompliance: evaluations.map((e) => ({
      service: e.service,
      metric: e.metric,
      target: e.target,
      actual: e.actual,
      status: e.status,
      unit: e.unit,
    })),
    sloSummary: {
      total: evaluations.length,
      passing: evaluations.filter((e) => e.status === "cumple").length,
      atRisk: evaluations.filter((e) => e.status === "en_riesgo").length,
      failing: evaluations.filter((e) => e.status === "incumple").length,
    },
  };
}

/**
 * Format SLO evaluations for inclusion in HTML reports.
 * Returns an HTML fragment with traffic-light indicators.
 */
export function formatSloForHtml(evaluations: SloEvaluation[]): string {
  if (evaluations.length === 0) return "";

  const statusIcon: Record<SloStatus, string> = {
    cumple: "🟢",
    en_riesgo: "🟡",
    incumple: "🔴",
  };

  const statusLabel: Record<SloStatus, string> = {
    cumple: "Cumple",
    en_riesgo: "En riesgo",
    incumple: "Incumple",
  };

  const rows = evaluations
    .map(
      (e) =>
        `<tr>
      <td>${e.service}</td>
      <td>${e.metric}</td>
      <td>${e.target}${e.unit ?? ""}</td>
      <td>${e.actual.toFixed(2)}${e.unit ?? ""}</td>
      <td>${statusIcon[e.status]} ${statusLabel[e.status]}</td>
    </tr>`,
    )
    .join("\n");

  return `
<div class="slo-compliance">
  <h3>SLA/SLO Compliance</h3>
  <table>
    <thead>
      <tr>
        <th>Servicio</th>
        <th>Metrica</th>
        <th>Objetivo</th>
        <th>Actual</th>
        <th>Estado</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</div>`;
}
