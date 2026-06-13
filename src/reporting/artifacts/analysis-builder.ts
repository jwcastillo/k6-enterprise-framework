/**
 * Phase 6 / DX-06 — analysis-builder.
 *
 * Builds the `analysis-<ISO>.md` artifact body — the LLM-structured
 * performance report containing run metadata, executive summary, points
 * of interest, detailed HTTP metrics, SLA compliance, APDEX, and so on.
 *
 * Pure function. No fs, no Date.now. The legacy monolith had 12 sections
 * inlined; this implementation focuses on the stable Sec 1..6 + 11 that
 * downstream consumers depend on. The wrapper is responsible for
 * optionally prepending the long-form LLM prompt template (which lives at
 * `docs/LLM_ANALYSIS_PROMPT.md`).
 */

import type { BuiltSummary, RunMeta } from "./types";
import { SLA_DEFAULTS } from "./types";

function formatTimestamp(ts: string): string {
  const m = ts.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
  if (!m) return ts;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}

function fmt(v: number | null, decimals = 1): string {
  if (v === null) return "N/A";
  return v.toFixed(decimals);
}

export interface BuildAnalysisInput {
  built: BuiltSummary;
  meta: RunMeta;
  /** Optional generator-health snapshot to inline in Sec 11. */
  generatorHealth?: {
    cpu?: number[];
    memory?: number[];
    loadAvg1m?: number;
    warnings?: string[];
    capturedAt?: string;
  };
}

function statusLabel(exitCode: number): string {
  if (exitCode === 0) return "PASSED";
  if (exitCode === 99) return "THRESHOLD_FAILURE";
  return "ERROR";
}

/**
 * Compose the analysis Markdown body.
 *
 * @example
 * const md = buildAnalysis({ built, meta, generatorHealth });
 * fs.writeFileSync(analysisPath, md);
 */
export function buildAnalysis(input: BuildAnalysisInput): string {
  const { built, meta, generatorHealth } = input;
  const status = statusLabel(meta.exitCode);

  // Sec 1: Run Metadata
  const sec1 = [
    "# k6 Performance Test — LLM Analysis Report",
    "",
    "> This document contains structured performance data for LLM-assisted analysis.",
    "> All numeric values are in milliseconds unless otherwise noted.",
    "",
    "## Run Metadata",
    "",
    "| Field | Value |",
    "|-------|-------|",
    `| Run ID | \`${meta.runId}\` |`,
    `| Client | ${meta.client} |`,
    `| Scenario | ${meta.scenario} |`,
    `| Profile | ${meta.profile} |`,
    `| Environment | ${meta.env} |`,
    `| Timestamp | ${formatTimestamp(meta.timestamp)} |`,
    meta.runLabel ? `| Run Label | \`${meta.runLabel}\` |` : null,
    `| Exit Code | ${meta.exitCode} |`,
    `| Overall Status | **${status}** |`,
    `| Max VUs | ${built.maxVus !== null ? built.maxVus : "N/A"} |`,
    `| Total Requests | ${built.http.totalRequests !== null ? built.http.totalRequests : "N/A"} |`,
    `| Total Iterations | ${built.iterations !== null ? built.iterations : "N/A"} |`,
    "",
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  // Sec 2: Executive Summary
  const summaryProse =
    `Test **${status}** (exit ${meta.exitCode}). ` +
    `p95=${fmt(built.latency.p95Ms)}, p99=${fmt(built.latency.p99Ms)}, avg=${fmt(built.latency.avgMs)}. ` +
    `Error rate: ${built.errorRatePct !== null ? built.errorRatePct.toFixed(3) + "%" : "N/A"}. ` +
    `Checks: ${built.checks.rate.toFixed(1)}% (${built.checks.pass}/${built.checks.total}). ` +
    `APDEX: ${built.apdex.score !== null ? built.apdex.score.toFixed(2) : "N/A"} (${built.apdex.label}). ` +
    `SLA: ${built.sla.pass ? "ALL PASS" : `${built.sla.violations.length} violation(s): ${built.sla.violations.join("; ")}`}.`;
  const sec2 = "## Executive Summary\n\n" + summaryProse + "\n\n";

  // Sec 4: HTTP Metrics (only the rows for metrics actually present)
  const httpMetrics: Array<[string, string]> = [
    ["http_req_duration", "Total Request Duration"],
    ["http_req_waiting", "Time to First Byte (TTFB)"],
    ["http_req_sending", "Request Sending Time"],
    ["http_req_receiving", "Response Receiving Time"],
    ["http_req_blocked", "Blocked / Connection Wait"],
    ["http_req_connecting", "TCP Connecting Time"],
    ["http_req_tls_handshaking", "TLS Handshake Time"],
    ["iteration_duration", "Iteration Duration"],
  ];
  const httpRows = httpMetrics
    .filter(([key]) => built.metrics[key]?.avg !== undefined)
    .map(([key, label]) => {
      const d = built.metrics[key]!;
      return `| ${label} | ${fmt(d.avg ?? null)} | ${fmt(d.min ?? null)} | ${fmt(d.med ?? null)} | ${fmt(d["p(90)"] ?? null)} | ${fmt(d["p(95)"] ?? null)} | ${fmt(d["p(99)"] ?? null)} | ${fmt(d.max ?? null)} |`;
    })
    .join("\n");
  const sec4 =
    "## Detailed HTTP Metrics\n\n" +
    "| Metric | avg | min | p50 | p90 | p95 | p99 | max |\n" +
    "|--------|-----|-----|-----|-----|-----|-----|-----|\n" +
    httpRows +
    "\n\n";

  // Sec 5: SLA Compliance
  const sec5 =
    "## SLA Compliance\n\n" +
    "| Rule | Threshold | Actual | Status |\n" +
    "|------|-----------|--------|--------|\n" +
    `| p95 response time | <${SLA_DEFAULTS.p95Ms}ms | ${
      built.latency.p95Ms !== null ? built.latency.p95Ms.toFixed(0) + "ms" : "N/A"
    } | ${built.sla.p95Ok === null ? "N/A" : built.sla.p95Ok ? "PASS" : "FAIL"} |\n` +
    `| p99 response time | <${SLA_DEFAULTS.p99Ms}ms | ${
      built.latency.p99Ms !== null ? built.latency.p99Ms.toFixed(0) + "ms" : "N/A"
    } | ${built.sla.p99Ok === null ? "N/A" : built.sla.p99Ok ? "PASS" : "FAIL"} |\n` +
    `| Error rate | <${SLA_DEFAULTS.errorRatePct}% | ${
      built.errorRatePct !== null ? built.errorRatePct.toFixed(3) + "%" : "N/A"
    } | ${built.sla.errorRateOk === null ? "N/A" : built.sla.errorRateOk ? "PASS" : "FAIL"} |\n` +
    `| Checks pass rate | >=${SLA_DEFAULTS.checksPct}% | ${built.checks.rate.toFixed(1)}% | ${
      built.sla.checksOk ? "PASS" : "FAIL"
    } |\n\n` +
    `**Overall SLA:** ${
      built.sla.pass ? "PASS — all rules met" : `FAIL — ${built.sla.violations.join("; ")}`
    }\n\n`;

  // Sec 6: APDEX
  const sec6 =
    "## APDEX Analysis\n\n" +
    "| Field | Value |\n" +
    "|-------|-------|\n" +
    `| APDEX Score | ${built.apdex.score !== null ? built.apdex.score.toFixed(2) : "N/A"} |\n` +
    `| Label | ${built.apdex.label} |\n` +
    `| T (Satisfied threshold) | ${SLA_DEFAULTS.apdexT}ms |\n` +
    `| F (Frustrated threshold) | ${SLA_DEFAULTS.apdexF}ms |\n` +
    "| Formula | (Satisfied + Tolerating/2) / Total |\n\n" +
    "APDEX scale: Excellent >=0.94 / Good >=0.85 / Fair >=0.70 / Poor >=0.50 / Unacceptable <0.50\n\n";

  // Sec 11: Generator Health (always present, even when empty)
  const gh = generatorHealth ?? {};
  const genCpu = gh.cpu?.[0];
  const genMem = gh.memory?.[0];
  const sec11 =
    "## Generator Health\n\n" +
    "| Metric | Value |\n" +
    "|--------|-------|\n" +
    `| CPU Usage | ${genCpu !== undefined ? genCpu + "%" : "N/A"} |\n` +
    `| Memory (RSS) | ${genMem !== undefined ? genMem + " MB" : "N/A"} |\n` +
    `| Load Average (1m) | ${gh.loadAvg1m !== undefined ? gh.loadAvg1m : "N/A"} |\n` +
    `| Captured At | ${gh.capturedAt ?? "N/A"} |\n` +
    `| Warnings | ${gh.warnings && gh.warnings.length > 0 ? gh.warnings.join("; ") : "None"} |\n\n` +
    "---\n" +
    `*Generated by k6 Enterprise Framework / Run ID: ${meta.runId}*\n`;

  return sec1 + sec2 + sec4 + sec5 + sec6 + sec11;
}
