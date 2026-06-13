/**
 * Phase 6 / DX-06 — csv-generator.
 *
 * Emits the legacy `metrics-<ISO>.csv` body as a single string. Schema
 * preserved verbatim from `bin/generate-artifacts.js` for backward
 * compatibility (D-20):
 *
 *     metric,type,count,rate,avg,min,med,max,p90,p95,p99
 *
 * Pure function — no fs, no Date.now, deterministic for any given input.
 */

import type { K6MetricEntry, K6Summary } from "./types";

const HEADER = "metric,type,count,rate,avg,min,med,max,p90,p95,p99";

/**
 * Format a numeric field with the legacy precision. Returns "" when the
 * field is absent so the resulting CSV cell is empty (not "undefined").
 */
function num(v: number | undefined, decimals: number): string {
  return v !== undefined ? v.toFixed(decimals) : "";
}

/**
 * Render a single metric row matching the legacy CLI output. `count` is
 * emitted as-is (k6 already provides an integer); `rate` uses 4 decimals;
 * trend/duration fields use 3 decimals.
 */
function row(name: string, data: K6MetricEntry): string {
  return [
    name,
    data.type ?? "",
    data.count !== undefined ? String(data.count) : "",
    num(data.rate, 4),
    num(data.avg, 3),
    num(data.min, 3),
    num(data.med, 3),
    num(data.max, 3),
    num(data["p(90)"], 3),
    num(data["p(95)"], 3),
    num(data["p(99)"], 3),
  ].join(",");
}

/**
 * Build the metrics CSV body from a raw k6 summary.
 *
 * @example
 * const summary: K6Summary = JSON.parse(fs.readFileSync("summary.json", "utf8"));
 * fs.writeFileSync("metrics.csv", generateCsv(summary));
 */
export function generateCsv(summary: K6Summary): string {
  const metrics = summary.metrics ?? {};
  const lines = [HEADER];
  for (const [name, data] of Object.entries(metrics)) {
    lines.push(row(name, data));
  }
  return lines.join("\n") + "\n";
}
