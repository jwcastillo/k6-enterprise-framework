/**
 * Phase 6 / DX-06 — message-builder.
 *
 * Builds the `message-<ISO>.md` artifact body — a short notification-grade
 * Markdown intended for Slack / chat. Pure function: same input → same
 * output. Schema preserved from the legacy monolith for D-20 backward
 * compatibility.
 */

import type { BuiltSummary, RunMeta } from "./types";
import { SLA_DEFAULTS } from "./types";

function formatTimestamp(ts: string): string {
  const m = ts.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
  if (!m) return ts;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}

function fmtMs(v: number | null, decimals = 1): string {
  if (v === null) return "N/A";
  return v.toFixed(decimals) + "ms";
}

function statusEmoji(exitCode: number): string {
  if (exitCode === 0) return "PASSED";
  if (exitCode === 99) return "THRESHOLD_FAILURE";
  return "FAILED";
}

export interface BuildMessageInput {
  built: BuiltSummary;
  meta: RunMeta;
}

/**
 * Render the message Markdown body.
 *
 * @example
 * const md = buildMessage({ built: buildSummary(summary), meta });
 * fs.writeFileSync(messagePath, md);
 */
export function buildMessage(input: BuildMessageInput): string {
  const { built, meta } = input;
  const status = statusEmoji(meta.exitCode);

  const slaRows = [
    `| p95 < ${SLA_DEFAULTS.p95Ms}ms | ${
      built.latency.p95Ms !== null ? built.latency.p95Ms.toFixed(0) + "ms" : "N/A"
    } | ${built.sla.p95Ok === null ? "—" : built.sla.p95Ok ? "PASS" : "FAIL"} |`,
    `| p99 < ${SLA_DEFAULTS.p99Ms}ms | ${
      built.latency.p99Ms !== null ? built.latency.p99Ms.toFixed(0) + "ms" : "N/A"
    } | ${built.sla.p99Ok === null ? "—" : built.sla.p99Ok ? "PASS" : "FAIL"} |`,
    `| Error rate < ${SLA_DEFAULTS.errorRatePct}% | ${
      built.errorRatePct !== null ? built.errorRatePct.toFixed(3) + "%" : "N/A"
    } | ${built.sla.errorRateOk === null ? "—" : built.sla.errorRateOk ? "PASS" : "FAIL"} |`,
    `| Checks >= ${SLA_DEFAULTS.checksPct}% | ${built.checks.rate.toFixed(1)}% | ${
      built.sla.checksOk ? "PASS" : "FAIL"
    } |`,
  ].join("\n");

  const labelChip = meta.runLabel ? ` · Label: **${meta.runLabel}**` : "";

  const lines = [
    `## Performance Test — ${status}`,
    "",
    `**${meta.client}** · ${meta.scenario} · ${meta.profile} · ${meta.env}`,
    `${formatTimestamp(meta.timestamp)} · Run ID: \`${meta.runId}\`${labelChip}`,
    "",
    "### Metrics",
    "",
    "| Metric | Value |",
    "|--------|-------|",
    `| Checks | ${built.checks.rate.toFixed(1)}% (${built.checks.pass}/${built.checks.total}) |`,
    `| Avg Response | ${fmtMs(built.latency.avgMs)} |`,
    `| p95 Response | ${fmtMs(built.latency.p95Ms)} |`,
    `| p99 Response | ${fmtMs(built.latency.p99Ms)} |`,
    `| Error Rate | ${built.errorRatePct !== null ? built.errorRatePct.toFixed(3) + "%" : "N/A"} |`,
    `| Throughput | ${
      built.http.ratePerSec !== null ? built.http.ratePerSec.toFixed(1) + " req/s" : "N/A"
    } |`,
    `| APDEX | ${
      built.apdex.score !== null ? built.apdex.score.toFixed(2) : "N/A"
    } (${built.apdex.label}) |`,
    `| Max VUs | ${built.maxVus !== null ? String(built.maxVus) : "N/A"} |`,
    "",
    `### SLA Status: ${built.sla.pass ? "PASS" : "FAIL"}`,
    "",
    "| Rule | Value | Status |",
    "|------|-------|--------|",
    slaRows,
    "",
    "---",
    `_k6 Enterprise Framework · Run ID: ${meta.runId}_`,
    "",
  ];
  return lines.join("\n");
}
