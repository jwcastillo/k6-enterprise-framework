/** T-013: PerformanceHelper — Metricas de rendimiento programaticas */

export interface PercentileResult {
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

export interface AggregateResult {
  avg: number;
  min: number;
  max: number;
  stddev: number;
  count: number;
}

export interface BaselineComparison {
  metric: string;
  baseline: number;
  current: number;
  deltaPercent: number;
  withinThreshold: boolean;
}

const MIN_SAMPLES_WARNING = 30;

export class PerformanceHelper {
  /** Calculate percentiles from a sorted or unsorted array of values */
  static percentiles(values: number[]): PercentileResult {
    if (values.length === 0) {
      return { p50: 0, p90: 0, p95: 0, p99: 0 };
    }
    if (values.length < MIN_SAMPLES_WARNING) {
      console.warn(
        `PerformanceHelper: only ${values.length} samples — percentile accuracy may be low (min recommended: ${MIN_SAMPLES_WARNING})`
      );
    }
    const sorted = [...values].sort((a, b) => a - b);
    const pct = (p: number): number => {
      const idx = (p / 100) * (sorted.length - 1);
      const lo = Math.floor(idx);
      const hi = Math.ceil(idx);
      return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
    };
    return {
      p50: Math.round(pct(50) * 100) / 100,
      p90: Math.round(pct(90) * 100) / 100,
      p95: Math.round(pct(95) * 100) / 100,
      p99: Math.round(pct(99) * 100) / 100,
    };
  }

  /** Aggregate statistics for a set of values */
  static aggregate(values: number[]): AggregateResult {
    if (values.length === 0) {
      return { avg: 0, min: 0, max: 0, stddev: 0, count: 0 };
    }
    const count = values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((s, v) => s + v, 0) / count;
    const variance = values.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / count;
    const stddev = Math.sqrt(variance);
    return {
      avg: Math.round(avg * 100) / 100,
      min,
      max,
      stddev: Math.round(stddev * 100) / 100,
      count,
    };
  }

  /** Compare a current value against a baseline with threshold (percent) */
  static compareBaseline(
    metric: string,
    baseline: number,
    current: number,
    thresholdPercent = 10
  ): BaselineComparison {
    const deltaPercent = baseline === 0 ? 0 : ((current - baseline) / baseline) * 100;
    return {
      metric,
      baseline,
      current,
      deltaPercent: Math.round(deltaPercent * 100) / 100,
      withinThreshold: Math.abs(deltaPercent) <= thresholdPercent,
    };
  }

  /** Evaluate a threshold expression (e.g. "p(95)<500") against a value */
  static evaluateThreshold(expression: string, value: number): boolean {
    const ltMatch = expression.match(/^.*?<\s*(\d+(?:\.\d+)?)$/);
    if (ltMatch) return value < parseFloat(ltMatch[1]);

    const lteMatch = expression.match(/^.*?<=\s*(\d+(?:\.\d+)?)$/);
    if (lteMatch) return value <= parseFloat(lteMatch[1]);

    const gtMatch = expression.match(/^.*?>\s*(\d+(?:\.\d+)?)$/);
    if (gtMatch) return value > parseFloat(gtMatch[1]);

    const gteMatch = expression.match(/^.*?>=\s*(\d+(?:\.\d+)?)$/);
    if (gteMatch) return value >= parseFloat(gteMatch[1]);

    throw new Error(`PerformanceHelper: unsupported threshold expression '${expression}'`);
  }
}
