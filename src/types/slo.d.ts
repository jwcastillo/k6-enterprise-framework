/** SLA/SLO compliance types for k6 Enterprise Framework (Phase 2) */

/** SLO evaluation status (traffic-light model) */
export type SloStatus = "cumple" | "en_riesgo" | "incumple";

/** Single SLO metric definition */
export interface SloMetric {
  /** Metric name (e.g., "http_req_duration_p95", "error_rate") */
  name: string;
  /** Target value (upper bound for latency, upper bound for error rate) */
  target: number;
  /** Risk margin as decimal (0.10 = 10% — values within 10% of target are "en_riesgo") */
  riskMargin: number;
  /** Unit for display purposes */
  unit?: string;
}

/**
 * SLO definition for a service.
 * Stored in clients/{name}/config/slos.json
 *
 * @example
 * {
 *   "services": [{
 *     "serviceName": "users-api",
 *     "metrics": [
 *       { "name": "http_req_duration_p95", "target": 500, "riskMargin": 0.10, "unit": "ms" },
 *       { "name": "error_rate", "target": 0.01, "riskMargin": 0.10 }
 *     ]
 *   }]
 * }
 */
export interface SloConfig {
  services: SloServiceDefinition[];
}

/** SLO definitions for a single service */
export interface SloServiceDefinition {
  /** Service identifier (matches test tags or endpoint name) */
  serviceName: string;
  /** SLO metrics for this service */
  metrics: SloMetric[];
}

/** Result of evaluating a single SLO metric against execution data */
export interface SloEvaluation {
  /** Service name */
  service: string;
  /** Metric name */
  metric: string;
  /** Target value from SLO definition */
  target: number;
  /** Actual measured value */
  actual: number;
  /** Evaluation status */
  status: SloStatus;
  /** Unit for display */
  unit?: string;
}

/** Aggregated SLO compliance for a monthly report */
export interface SloComplianceReport {
  /** Client identifier */
  client: string;
  /** Month in YYYY-MM format */
  month: string;
  /** Generation timestamp */
  generatedAt: string;
  /** Per-service compliance data */
  services: SloServiceCompliance[];
  /** Overall compliance percentage */
  overallCompliancePercent: number;
}

/** Monthly compliance data for a single service */
export interface SloServiceCompliance {
  /** Service name */
  serviceName: string;
  /** Per-metric compliance */
  metrics: SloMetricCompliance[];
  /** Trend over last 3 months */
  trend: "mejorando" | "estable" | "degradandose";
}

/** Monthly compliance data for a single metric */
export interface SloMetricCompliance {
  /** Metric name */
  metric: string;
  /** Target value */
  target: number;
  /** Number of executions that met the SLO */
  passingExecutions: number;
  /** Total executions in the period */
  totalExecutions: number;
  /** Compliance percentage */
  compliancePercent: number;
  /** Periods of non-compliance with report links */
  violations: SloViolation[];
}

/** Record of a specific SLO violation */
export interface SloViolation {
  /** Timestamp of the violating execution */
  timestamp: string;
  /** Actual value that violated the SLO */
  actualValue: number;
  /** Link to the execution report */
  reportLink: string;
}
