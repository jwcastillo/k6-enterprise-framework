/**
 * T-262: GPT-inspired overall results score — pure scoring function.
 *
 * Extracted from metrics-engine.ts calculate() to make the scoring logic
 * reusable across the engine and the HTML report generator.
 *
 * Weighting: pass=1.0, warn=0.5, fail=0; na metrics excluded.
 * Grade: A >=90, B >=80, C >=70, D >=60, F <60.
 * Healthy: value >= 90 (GPT healthy-instance convention).
 * Defaults to 100/A/true when denominator is 0 (empty or all-na report).
 */

// ── Score function ────────────────────────────────────────────────────────────

/**
 * Compute the GPT-inspired overall results score from pass/warn/fail counts.
 *
 * This is the exact same formula previously inlined in MetricsEngine.calculate().
 * Extracted to allow the HTML report generator to derive a score from
 * `BuiltSummary.checks` when `extendedMetrics.score` is not available.
 *
 * @example
 *   scoreFromCounts({ pass: 10, warn: 0, fail: 0 })
 *   // → { value: 100, grade: "A", healthy: true }
 *
 *   scoreFromCounts({ pass: 1, warn: 1, fail: 0 })
 *   // → { value: 75, grade: "C", healthy: false }
 *
 *   scoreFromCounts({ pass: 0, warn: 0, fail: 0 })
 *   // → { value: 100, grade: "A", healthy: true } (empty → perfect score)
 */
export function scoreFromCounts(counts: {
  pass: number;
  warn: number;
  fail: number;
}): { value: number; grade: "A" | "B" | "C" | "D" | "F"; healthy: boolean } {
  const { pass, warn, fail } = counts;
  const scorable = pass + warn + fail;
  const value =
    scorable === 0
      ? 100
      : Math.round(((pass * 1.0 + warn * 0.5) / scorable) * 100);
  const grade: "A" | "B" | "C" | "D" | "F" =
    value >= 90
      ? "A"
      : value >= 80
        ? "B"
        : value >= 70
          ? "C"
          : value >= 60
            ? "D"
            : "F";
  return { value, grade, healthy: value >= 90 };
}
