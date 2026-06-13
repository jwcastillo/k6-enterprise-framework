/** Benchmarking and generator health types for k6 Enterprise Framework (Phase 2) */

/** Binary compilation metadata embedded in compiled binaries */
export interface BinaryMetadata {
  /** Core framework version */
  coreVersion: string;
  /** Client config version */
  clientVersion: string;
  /** Build timestamp (ISO 8601) */
  buildDate: string;
  /** Git commit hash of the core */
  commitHash: string;
  /** Target platform (e.g., "linux/amd64") */
  platform: string;
  /** Client identifier */
  clientId: string;
}

/** Resource sample from the generator health monitor */
export interface HealthSample {
  /** Timestamp of the sample */
  timestamp: string;
  /** CPU usage percentage (0-100) */
  cpuPercent: number;
  /** Memory usage in bytes */
  memoryBytes: number;
  /** Memory usage percentage (0-100) */
  memoryPercent: number;
}

/** Aggregated generator health metrics for reports */
export interface GeneratorHealthMetrics {
  /** Peak CPU usage during the test */
  cpuMax: number;
  /** Average CPU usage */
  cpuAvg: number;
  /** Peak memory usage in bytes */
  memMax: number;
  /** Average memory usage in bytes */
  memAvg: number;
  /** Warnings emitted during execution */
  warnings: string[];
  /** All collected samples */
  samples: HealthSample[];
  /** Whether the generator was saturated at any point (CPU > 80%) */
  saturated: boolean;
}

/** Benchmark overhead breakdown */
export interface BenchmarkOverhead {
  /** Overhead of TypeScript compilation step (ms) */
  compilationMs: number;
  /** Per-request overhead of RequestHelper wrapper vs raw http (ms) */
  requestHelperOverheadMs: number;
  /** Config loading overhead per invocation (ms) */
  configLoadingMs: number;
  /** Check evaluation overhead per request (ms) */
  checkEvaluationMs: number;
  /** Structured logging overhead per log line (ms) */
  loggingOverheadMs: number;
  /** Total measured overhead per request (ms) */
  totalPerRequestMs: number;
  /** Maximum throughput achieved (requests/second) */
  maxThroughput: number;
}
