/** Report data structure types for k6 Enterprise Framework */

export interface MetricSummary {
  avg: number;
  min: number;
  med: number;
  max: number;
  p90: number;
  p95: number;
  p99: number;
}

export interface CheckResult {
  name: string;
  passes: number;
  fails: number;
  passRate: number;
}

export interface ThresholdResult {
  metric: string;
  condition: string;
  passed: boolean;
  value: number;
}

export interface ExecutionSummary {
  testName: string;
  client: string;
  environment: string;
  profile: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  vus: number;
  iterations: number;
  iterationsFailed: number;
  httpRequests: number;
  httpRequestsFailed: number;
  httpDuration: MetricSummary;
  checks: CheckResult[];
  thresholds: ThresholdResult[];
  passed: boolean;
  tags: Record<string, string>;
}

export interface ComparisonResult {
  baseline: ExecutionSummary;
  current: ExecutionSummary;
  regressions: RegressionDetail[];
  improvements: RegressionDetail[];
  passed: boolean;
}

export interface RegressionDetail {
  metric: string;
  baseline: number;
  current: number;
  deltaPercent: number;
  threshold: number;
  exceeded: boolean;
}
