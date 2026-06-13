/** Mock server and chaos injection types for k6 Enterprise Framework (Phase 2) */

/** Latency configuration — fixed value or normal distribution */
export type LatencyConfig =
  | number
  | { mean: number; stddev: number };

/** Response template with dynamic variable support */
export interface MockResponseTemplate {
  /** HTTP status code */
  status: number;
  /** Response headers */
  headers?: Record<string, string>;
  /**
   * Response body template. Supports dynamic variables:
   * - {{counter}} — auto-incrementing integer
   * - {{timestamp}} — current ISO 8601 timestamp
   * - {{uuid}} — random UUID v4
   * - {{randomInt(min,max)}} — random integer in range
   */
  body: string | Record<string, unknown>;
  /** Simulated latency in ms (fixed or distribution) */
  latency?: LatencyConfig;
}

/** Single mock endpoint definition */
export interface MockEndpoint {
  /** URL path pattern (e.g., "/api/users", "/api/users/:id") */
  path: string;
  /** HTTP method */
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";
  /** Response template */
  response: MockResponseTemplate;
  /** Error rate as decimal (0.0 to 1.0) — fraction of requests that return error */
  errorRate?: number;
  /** Error response when error rate triggers */
  errorResponse?: MockResponseTemplate;
}

/**
 * Mock server configuration for a dependency.
 * Stored in clients/{name}/mocks/{dependency}.json
 *
 * @example
 * {
 *   "name": "payments-api",
 *   "port": 9090,
 *   "endpoints": [{
 *     "path": "/api/payments",
 *     "method": "POST",
 *     "response": { "status": 200, "body": {"id": "{{uuid}}", "status": "processed"}, "latency": 50 },
 *     "errorRate": 0.05,
 *     "errorResponse": { "status": 503, "body": {"error": "Service Unavailable"} }
 *   }]
 * }
 */
export interface MockConfig {
  /** Dependency name */
  name: string;
  /** Port to listen on (0 for auto-assign) */
  port?: number;
  /** Endpoint definitions */
  endpoints: MockEndpoint[];
}

// ── Chaos Injection Types ─────────────────────────────────────────────────────

/**
 * Types of fault injection available.
 * - latency: add artificial delay
 * - http_error: return HTTP error status
 * - disconnect: close connection abruptly
 * - corruption: return malformed/partial response
 * - partial_timeout: accept connection but delay response indefinitely
 * - rate_limit: return 429 with Retry-After header
 */
export type ChaosType =
  | "latency"
  | "http_error"
  | "disconnect"
  | "corruption"
  | "partial_timeout"
  | "rate_limit";

/** Single chaos fault rule */
export interface ChaosFaultRule {
  /** Type of fault to inject */
  type: ChaosType;
  /** Probability of fault occurring (0.0 to 1.0) */
  probability: number;
  /** Type-specific parameters */
  params?: Record<string, unknown>;
}

/**
 * Chaos injection configuration.
 * Stored in clients/{name}/config/chaos.json
 *
 * @example
 * {
 *   "enabled": false,
 *   "targetService": "payments-api",
 *   "faults": [
 *     { "type": "latency", "probability": 0.20, "params": { "delayMs": 2000 } },
 *     { "type": "http_error", "probability": 0.10, "params": { "statusCode": 503 } },
 *     { "type": "rate_limit", "probability": 0.05, "params": { "retryAfterSec": 30 } }
 *   ]
 * }
 */
export interface ChaosConfig {
  /** Must be explicitly enabled — prevents accidental activation */
  enabled: boolean;
  /** Target service or dependency name */
  targetService: string;
  /** Fault injection rules */
  faults: ChaosFaultRule[];
}

/** Differentiated error breakdown in reports */
export interface ChaosReportBreakdown {
  /** Errors from the actual service under test */
  serviceErrors: number;
  /** Errors injected by chaos configuration */
  chaosInjectedErrors: number;
  /** Chaos configuration that was active */
  chaosConfig: ChaosConfig;
}
