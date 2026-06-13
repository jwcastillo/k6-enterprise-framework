/**
 * Metrics Engine — Shared Types (T-180)
 *
 * Defines the MetricsCalculator interface, MetricResult, and MetricsReport
 * that all domain calculators implement and consume.
 */

// ── Core metric result ────────────────────────────────────────────────────────

export type MetricStatus = "pass" | "warn" | "fail" | "na";
export type MetricCategory =
  | "performance"
  | "throughput"
  | "error"
  | "saturation"
  | "sla"
  | "stability"
  | "scalability"
  | "chaos"
  | "security"
  | "observability"
  | "data-integrity";

export interface MetricResult {
  /** Unique metric ID, e.g. "PERF-001" */
  id: string;
  /** Human-readable name */
  name: string;
  /** Domain category */
  category: MetricCategory;
  /** Computed value (null if N/A) */
  value: number | null;
  /** Display unit: "ms", "%", "RPS", "bytes", etc. */
  unit: string;
  /** Threshold expression, e.g. "p95 < 500ms" */
  threshold?: string;
  /** Evaluated threshold status */
  status: MetricStatus;
  /** Human-readable description */
  description: string;
  /** Data source used (k6-native, prometheus, external) */
  source: "k6" | "prometheus" | "derived" | "external";
  /** Why metric is N/A (when status === "na") */
  naReason?: string;
}

// ── Input types ───────────────────────────────────────────────────────────────

/**
 * Raw k6 metrics map from handleSummary data.metrics
 */
export type K6MetricsMap = Record<string, { values?: Record<string, number>; type?: string }>;

/**
 * External metrics fetched from Prometheus or other sources.
 * Key = metric name (e.g. "cpu_usage"), value = array of {ts, value} samples.
 */
export type ExternalMetrics = Record<string, Array<{ ts: number; value: number }>>;

/**
 * Full input to the metrics engine calculation pipeline.
 */
export interface MetricsEngineInput {
  /** Raw k6 handleSummary data.metrics */
  k6Metrics: K6MetricsMap;
  /** External time-series metrics (Prometheus, CloudWatch, etc.) */
  externalMetrics?: ExternalMetrics;
  /** Test duration in milliseconds */
  durationMs: number;
  /** VU count at peak */
  vusMax: number;
  /** Execution context metadata */
  context: {
    client: string;
    environment: string;
    profile: string;
    testName: string;
    startTime: string;
  };
  /** SLO configuration for SLA calculator */
  sloConfig?: SlaSloConfig;
  /** Chaos configuration (if chaos test) */
  chaosConfig?: ChaosEngineConfig;
}

/**
 * Inline SLO targets consumed by the SLA calculator.
 * Distinct from the framework-wide SloConfig in types/slo.d.ts which describes
 * the full multi-service SLO definition file format used by core/slo-evaluator.
 */
export interface SlaSloConfig {
  /** e.g. 0.999 = 99.9% */
  availabilityTarget: number;
  /** p95 latency target in ms */
  latencyP95TargetMs: number;
  /** p99 latency target in ms */
  latencyP99TargetMs?: number;
  /** Minimum RPS target */
  throughputTargetRps?: number;
  /** Rolling error budget window in days */
  errorBudgetWindowDays?: number;
}

/** @deprecated renamed to SlaSloConfig — collided with types/slo.d.ts::SloConfig which describes the full SLO file format. */
export type SloConfig = SlaSloConfig;

export interface ChaosEngineConfig {
  faults: Array<{ type: string; rate: number }>;
}

// ── Output types ──────────────────────────────────────────────────────────────

/**
 * Full metrics report produced by MetricsEngine.calculate()
 */
export interface MetricsReport {
  generatedAt: string;
  durationMs: number;
  /** All metric results grouped by category */
  byCategory: Partial<Record<MetricCategory, MetricResult[]>>;
  /** Flat list for serialization */
  all: MetricResult[];
  /** Quick summary counts */
  summary: {
    total: number;
    pass: number;
    warn: number;
    fail: number;
    na: number;
  };
  /**
   * GPT-inspired overall results score (0-100).
   *
   * Weighting: pass=1.0, warn=0.5, fail=0; na metrics excluded from denominator.
   * Grade: A >=90, B >=80, C >=70, D >=60, F <60.
   * Healthy: value >= 90 (GPT healthy-instance convention).
   * Defaults to 100/A/true when denominator is 0 (empty or all-na report).
   */
  score?: {
    value: number;
    grade: "A" | "B" | "C" | "D" | "F";
    healthy: boolean;
  };
}

// ── Calculator interface ──────────────────────────────────────────────────────

/**
 * T-180: Interface that every domain calculator must implement.
 */
export interface MetricsCalculator {
  readonly category: MetricCategory;
  calculate(input: MetricsEngineInput): MetricResult[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Read a k6 metric stat safely, returning 0 if not present.
 */
export function k6Stat(metrics: K6MetricsMap, name: string, stat: string, defaultVal = 0): number {
  return metrics[name]?.values?.[stat] ?? defaultVal;
}

/**
 * Build an N/A metric result.
 */
export function naMetric(
  id: string,
  name: string,
  category: MetricCategory,
  unit: string,
  naReason: string
): MetricResult {
  return {
    id,
    name,
    category,
    value: null,
    unit,
    status: "na",
    description: naReason,
    source: "external",
    naReason,
  };
}

/**
 * Evaluate a threshold: returns "pass", "warn", or "fail".
 * Supports: "< N", "<= N", "> N", ">= N", "== N"
 */
export function evalThreshold(
  value: number,
  threshold: string,
  warnMultiplier = 1.1
): MetricStatus {
  const match = threshold.match(/^([<>]=?|==)\s*([\d.]+)/);
  if (!match) return "pass";
  const [, op, rawN] = match;
  const n = parseFloat(rawN);
  let passes: boolean;
  switch (op) {
    case "<":
      passes = value < n;
      break;
    case "<=":
      passes = value <= n;
      break;
    case ">":
      passes = value > n;
      break;
    case ">=":
      passes = value >= n;
      break;
    case "==":
      passes = value === n;
      break;
    default:
      passes = true;
  }
  if (passes) return "pass";
  // Warn zone: within warnMultiplier of threshold
  const warnN = op.startsWith("<") ? n * warnMultiplier : n / warnMultiplier;
  const warns = op.startsWith("<") ? value < warnN : value > warnN;
  return warns ? "warn" : "fail";
}

/**
 * Simple linear regression slope (y per x unit).
 * Returns 0 if fewer than 2 data points.
 */
export function linearRegressionSlope(points: Array<{ x: number; y: number }>): number {
  const n = points.length;
  if (n < 2) return 0;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumXX - sumX * sumX;
  return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
}

/**
 * Arithmetic mean of a number array. Returns 0 for empty input.
 */
export function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * Standard deviation of a number array.
 */
export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}
