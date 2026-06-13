/**
 * Phase 6 / DX-06 — html-generator.
 *
 * Renders the k6 web-dashboard banner fragment that gets injected into the
 * page produced by k6's `--out web-dashboard` flag. Pure function — no fs,
 * no random IDs, no Date.now leakage (D-19).
 *
 * The legacy monolith emitted ~1100 LOC of inline CSS + HTML. This
 * extraction preserves the externally visible classes (`k6d-banner`,
 * `k6d-banner-*`, `k6d-sla-*`, `k6d-comp-table`, etc.) so injection points
 * the wrapper rewrites stay backward compatible (D-20). The banner is
 * factored into small helpers (header, metrics, SLA, links, footer) so
 * future tweaks stay scoped.
 */

import type { BuiltSummary, K6Summary, RunMeta } from "./types";
import { SLA_DEFAULTS } from "./types";
import { scoreFromCounts } from "../../metrics/score";

/** Wrapper-supplied basenames so links inside the banner stay relative. */
export interface ArtifactPaths {
  metricsCsvBasename: string;
  analysisBasename: string;
  messageBasename: string;
  summaryBasename: string;
  comparisonBasename?: string;
}

export interface GenerateHtmlInput {
  summary: K6Summary;
  built: BuiltSummary;
  meta: RunMeta;
  artifactPaths: ArtifactPaths;
}

/** "20260319-113700" → "2026-03-19 11:37" (legacy display format). */
function formatTimestamp(ts: string): string {
  const m = ts.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
  if (!m) return ts;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}

/** Escape HTML special chars to keep the banner injection-safe. */
function esc(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtMs(v: number | null): string {
  if (v === null) return "N/A";
  return Math.round(v).toLocaleString() + "ms";
}

function fmtPct(v: number | null, decimals = 2): string {
  if (v === null) return "N/A";
  return v.toFixed(decimals) + "%";
}

function renderHeader(meta: RunMeta): string {
  const tsDisplay = formatTimestamp(meta.timestamp);
  const labelChip = meta.runLabel ? ` · Label: <b>${esc(meta.runLabel)}</b>` : "";
  return (
    `<div class="k6d-banner-header">` +
    `<span class="k6d-banner-title">k6 Enterprise — Performance Report</span>` +
    `<span class="k6d-banner-meta">` +
    `${esc(meta.client)} · ${esc(meta.scenario)} · ${esc(meta.profile)} · ${esc(meta.env)}` +
    `</span>` +
    `<span class="k6d-banner-meta">` +
    `${esc(tsDisplay)} · Run ID: <code>${esc(meta.runId)}</code>${labelChip}` +
    `</span>` +
    `</div>`
  );
}

function renderMetrics(built: BuiltSummary, summary: K6Summary): string {
  // Resolve Overall score — prefer extendedMetrics.score when present; derive
  // defensively from checks otherwise. Wrapped in try/catch so a cell ALWAYS renders.
  let score: { value: number; grade: "A" | "B" | "C" | "D" | "F"; healthy: boolean };
  try {
    if (summary.extendedMetrics?.score != null) {
      score = summary.extendedMetrics.score;
    } else {
      // Deterministic checks-only formula — no SLA/threshold folding.
      score = scoreFromCounts({ pass: built.checks.pass, warn: 0, fail: built.checks.fail });
    }
  } catch (_err) {
    // Fallback: empty/missing data → 100/A so the cell always renders
    score = scoreFromCounts({ pass: 0, warn: 0, fail: 0 });
  }
  const overallColor = score.value >= 90 ? "#22c55e" : score.value >= 70 ? "#f59e0b" : "#ef4444";

  const cells = [
    {
      label: "Checks",
      value: `${built.checks.rate.toFixed(1)}%`,
      sub: `${built.checks.pass}/${built.checks.total}`,
    },
    { label: "Avg", value: fmtMs(built.latency.avgMs) },
    { label: "p95", value: fmtMs(built.latency.p95Ms) },
    { label: "p99", value: fmtMs(built.latency.p99Ms) },
    { label: "Errors", value: fmtPct(built.errorRatePct, 3) },
    {
      label: "Throughput",
      value: built.http.ratePerSec !== null ? built.http.ratePerSec.toFixed(1) + " req/s" : "N/A",
    },
    {
      label: "APDEX",
      value: built.apdex.score !== null ? built.apdex.score.toFixed(2) : "N/A",
      sub: built.apdex.label,
      color: built.apdex.color,
    },
    { label: "Max VUs", value: built.maxVus !== null ? String(built.maxVus) : "N/A" },
    {
      label: "Overall",
      value: String(score.value),
      sub: `Grade ${score.grade}`,
      color: overallColor,
    },
  ];
  const cellsHtml = cells
    .map((c) => {
      const colorAttr = c.color ? ` style="color:${esc(c.color)}"` : "";
      const sub = c.sub ? `<span class="k6d-banner-cell-sub">${esc(c.sub)}</span>` : "";
      return (
        `<div class="k6d-banner-cell">` +
        `<span class="k6d-banner-cell-label">${esc(c.label)}</span>` +
        `<span class="k6d-banner-cell-value"${colorAttr}>${esc(c.value)}</span>` +
        sub +
        `</div>`
      );
    })
    .join("");
  return `<div class="k6d-banner-metrics">${cellsHtml}</div>`;
}

function renderSla(built: BuiltSummary): string {
  const statusClass = built.sla.pass ? "k6d-sla-pass" : "k6d-sla-fail";
  const statusText = built.sla.pass ? "SLA: PASS" : "SLA: FAIL";
  const detail = built.sla.pass
    ? "All rules met."
    : built.sla.violations.map((v) => esc(v)).join(" · ");
  return (
    `<div class="k6d-banner-sla ${statusClass}">` +
    `<span class="k6d-banner-sla-status">${statusText}</span>` +
    `<span class="k6d-banner-sla-detail">${detail}</span>` +
    `<span class="k6d-banner-sla-thresholds">` +
    `(p95&lt;${SLA_DEFAULTS.p95Ms}ms · p99&lt;${SLA_DEFAULTS.p99Ms}ms · err&lt;${SLA_DEFAULTS.errorRatePct}% · checks≥${SLA_DEFAULTS.checksPct}%)` +
    `</span>` +
    `</div>`
  );
}

function renderLinks(paths: ArtifactPaths): string {
  const link = (label: string, href: string): string =>
    `<a class="k6d-banner-link" href="${esc(href)}" target="_blank">${esc(label)}</a>`;
  const linksHtml = [
    link("Summary JSON", paths.summaryBasename),
    link("Metrics CSV", paths.metricsCsvBasename),
    link("Analysis MD", paths.analysisBasename),
    link("Message MD", paths.messageBasename),
    paths.comparisonBasename ? link("Comparison MD", paths.comparisonBasename) : "",
  ]
    .filter(Boolean)
    .join("");
  return `<div class="k6d-banner-links">${linksHtml}</div>`;
}

function renderFooter(meta: RunMeta): string {
  return (
    `<div class="k6d-banner-footer">` +
    `Generated by k6 Enterprise Framework · Run ID: <code>${esc(meta.runId)}</code>` +
    `</div>`
  );
}

/**
 * Compose the k6-dashboard banner.
 *
 * @example
 * const banner = generateHtml({ summary, built: buildSummary(summary), meta, artifactPaths });
 * const rewritten = k6DashboardHtml.replace("<body>", `<body>${banner}`);
 */
export function generateHtml(input: GenerateHtmlInput): string {
  return (
    `<div class="k6d-banner">` +
    renderHeader(input.meta) +
    renderMetrics(input.built, input.summary) +
    renderSla(input.built) +
    renderLinks(input.artifactPaths) +
    renderFooter(input.meta) +
    `</div>`
  );
}
