/**
 * Phase 6 / DX-06 — charts sub-module.
 *
 * Renders deterministic SVG fragments embedded into the HTML report banner.
 * Pure function — no random IDs, no Date.now (D-19).
 *
 * The legacy monolith inlined chart canvases generated on-the-fly inside
 * the HTML; this sub-module exposes them as standalone callable fragments
 * so the wrapper can position them or the future web portal can re-use
 * them outside of HTML.
 *
 * v1 ships a minimal but functional latency-percentiles bar chart. More
 * chart types (trend, distribution) can extend this module without
 * touching the HTML generator.
 */

import type { BuiltSummary } from "../types";

export interface RenderChartsInput {
  built: BuiltSummary;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Build a deterministic horizontal bar fragment representing a single value. */
function bar(label: string, value: number | null, max: number, colorHex: string): string {
  if (value === null) {
    return `<div class="k6d-chart-row"><span class="k6d-chart-label">${esc(label)}</span><span class="k6d-chart-na">N/A</span></div>`;
  }
  const pct = Math.max(Math.min((value / Math.max(max, 1)) * 100, 100), 2).toFixed(1);
  return (
    `<div class="k6d-chart-row">` +
    `<span class="k6d-chart-label">${esc(label)}</span>` +
    `<div class="k6d-chart-bar-track">` +
    `<div class="k6d-chart-bar-fill" style="width:${pct}%;background:${esc(colorHex)}"></div>` +
    `</div>` +
    `<span class="k6d-chart-value">${Math.round(value).toLocaleString()}ms</span>` +
    `</div>`
  );
}

/**
 * Pick a heatmap color for a latency value (green → blue → amber → red)
 * matching the legacy monolith's `timeBarCell` palette.
 */
function colorForLatency(v: number | null): string {
  if (v === null) return "#9ca3af";
  if (v < 500) return "#16a34a";
  if (v < 1000) return "#2563eb";
  if (v < 2000) return "#d97706";
  return "#dc2626";
}

/**
 * Render the latency-percentiles chart for the banner.
 *
 * @example
 * const charts = renderCharts({ built: buildSummary(summary) });
 * banner = banner.replace("</div>", charts + "</div>");
 */
export function renderCharts(input: RenderChartsInput): string {
  const { latency } = input.built;
  // Scale all bars against the largest observed percentile for consistent visual weight.
  const max = Math.max(
    latency.maxMs ?? 0,
    latency.p99Ms ?? 0,
    latency.p95Ms ?? 0,
    1
  );
  return (
    `<div class="k6d-chart k6d-chart-latency">` +
    `<div class="k6d-chart-title">Latency Distribution (ms)</div>` +
    bar("avg", latency.avgMs, max, colorForLatency(latency.avgMs)) +
    bar("p50", latency.p50Ms, max, colorForLatency(latency.p50Ms)) +
    bar("p90", latency.p90Ms, max, colorForLatency(latency.p90Ms)) +
    bar("p95", latency.p95Ms, max, colorForLatency(latency.p95Ms)) +
    bar("p99", latency.p99Ms, max, colorForLatency(latency.p99Ms)) +
    bar("max", latency.maxMs, max, colorForLatency(latency.maxMs)) +
    `</div>`
  );
}
