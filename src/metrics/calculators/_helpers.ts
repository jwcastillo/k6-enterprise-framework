/**
 * Internal helpers shared by every MetricsCalculator in this directory.
 *
 * These were duplicated inline in each calculator file (m/na in 10 files,
 * avg in 7, percentile in 3); pulling them here keeps the calculator bodies
 * focused on their domain logic.
 */

import { avg, MetricCategory, MetricResult, evalThreshold, naMetric } from "../types";

// Re-export avg so existing `import { avg } from "./_helpers"` keeps working.
export { avg };

/** Construct a MetricResult, auto-evaluating threshold status if a threshold is supplied. */
export function m(
  id: string,
  name: string,
  category: MetricCategory,
  value: number,
  unit: string,
  threshold: string | undefined,
  description: string
): MetricResult {
  const status = threshold ? evalThreshold(value, threshold) : "pass";
  return { id, name, category, value, unit, threshold, status, description, source: "k6" };
}

/** Construct an N/A MetricResult. */
export function na(
  id: string,
  name: string,
  category: MetricCategory,
  unit: string,
  naReason: string
): MetricResult {
  return naMetric(id, name, category, unit, naReason);
}

/** P-th percentile via sorted-index lookup. Returns 0 for empty input. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}
