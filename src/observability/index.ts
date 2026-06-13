/** Barrel export -- k6 Enterprise Framework observability (Phase 2) */

// generator-health moved to src/node/ in Phase 4 (ARC-06). Import via @node/generator-health.

export {
  detectOverheadConditions,
  checkOverheadThreshold,
  formatWarningsForConsole,
  formatWarningsForJson,
} from "./overhead-detector";
export type { OverheadWarning } from "./overhead-detector";

// T-154: Pyroscope continuous profiling instrumentation (k6-safe symbols only)
// checkPyroscopeHealth moved to src/node/pyroscope-node.ts in Phase 4 (ARC-06, per D-37)
export {
  resolvePyroscopeConfig,
  buildPyroscopeHeader,
  withPyroscopeLabels,
  logPyroscopeStatus,
} from "./pyroscope-instrumentation";
export type { PyroscopeConfig, PyroscopeHealthResult } from "./pyroscope-instrumentation";

// T-158: Transparent distributed tracing instrumentation
// OBS2-03: Per-VU-iteration trace root cache + head-based sampling helpers
export {
  resolvePropagationFormat,
  buildTraceHeaders,
  withTracing,
  newTraceContext,
  isTracingEnabled,
  beginIteration,
  endIteration,
  currentTraceRoot,
  resolveSamplingRatio,
  shouldSampleIteration,
  buildIterationTraceHeaders,
} from "./tracing-instrumentation";
export type { PropagationFormat, TraceContext } from "./tracing-instrumentation";
