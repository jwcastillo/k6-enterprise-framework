/**
 * T-158: Transparent distributed tracing instrumentation
 *
 * Automatically injects trace propagation headers into k6 HTTP requests
 * based on the K6_TEMPO_PROPAGATION environment variable.
 *
 * Supported propagation formats:
 *   w3c     — W3C traceparent (default, RFC 7230)
 *   b3      — Zipkin B3 single header
 *   jaeger  — Jaeger uber-trace-id
 *
 * Design: transparent — scripts do NOT need modification.
 * Import this module in your scenario's init context to activate.
 *
 * Usage in k6 scripts:
 *   import { withTracing, buildTraceHeaders } from "../../src/observability/tracing-instrumentation";
 *   import http from "k6/http";
 *
 *   export default function() {
 *     const res = http.get(url, withTracing({ tags: { scenario: "checkout" } }));
 *   }
 *
 * Or use jslib for full auto-instrumentation:
 *   import http from "https://jslib.k6.io/httpx/0.1.0/index.js";
 *   // httpx supports auto-tracing via beforeRequest hooks
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type PropagationFormat = "w3c" | "b3" | "jaeger";

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  sampled: boolean;
}

// ── ID generation ─────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random hex string of the given byte length.
 * k6 goja runtime compatible — uses Math.random() as fallback.
 */
function randomHex(bytes: number): string {
  // In k6 runtime, crypto.randomUUID is available in newer versions
  // Fall back to Math.random for compatibility
  let result = "";
  for (let i = 0; i < bytes * 2; i++) {
    result += Math.floor(Math.random() * 16).toString(16);
  }
  return result;
}

/**
 * Generate a new trace context (new trace root span).
 */
export function newTraceContext(sampled = true): TraceContext {
  return {
    traceId: randomHex(16), // 128-bit trace ID
    spanId: randomHex(8), // 64-bit span ID
    sampled,
  };
}

// ── Header builders ───────────────────────────────────────────────────────────

/**
 * Build W3C traceparent header value.
 * Format: 00-{traceId}-{spanId}-{flags}
 * Spec: https://www.w3.org/TR/trace-context/
 */
function buildW3cHeader(ctx: TraceContext): Record<string, string> {
  const flags = ctx.sampled ? "01" : "00";
  return {
    traceparent: `00-${ctx.traceId}-${ctx.spanId}-${flags}`,
    tracestate: `k6=framework`,
  };
}

/**
 * Build Zipkin B3 single header.
 * Format: {traceId}-{spanId}-{sampled}
 */
function buildB3Header(ctx: TraceContext): Record<string, string> {
  const sampled = ctx.sampled ? "1" : "0";
  return {
    b3: `${ctx.traceId}-${ctx.spanId}-${sampled}`,
  };
}

/**
 * Build Jaeger uber-trace-id header.
 * Format: {traceId}:{spanId}:{parentSpanId}:{flags}
 */
function buildJaegerHeader(ctx: TraceContext): Record<string, string> {
  const parent = ctx.parentSpanId ?? "0";
  const flags = ctx.sampled ? "1" : "0";
  return {
    "uber-trace-id": `${ctx.traceId}:${ctx.spanId}:${parent}:${flags}`,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Resolve the active propagation format from k6 __ENV.
 * Throws with a descriptive error for unsupported values.
 */
export function resolvePropagationFormat(): PropagationFormat {
  const VALID: PropagationFormat[] = ["w3c", "b3", "jaeger"];
  // In k6 runtime __ENV is globally available
  const raw = (typeof __ENV !== "undefined" ? __ENV["K6_TEMPO_PROPAGATION"] : undefined) ?? "w3c";
  const fmt = raw.toLowerCase() as PropagationFormat;

  if (!VALID.includes(fmt)) {
    throw new Error(`Unsupported propagation: '${raw}'. Use: ${VALID.join(", ")}`);
  }
  return fmt;
}

/**
 * Build trace headers for the active propagation format.
 * Generates a fresh trace context per call (new root span).
 */
export function buildTraceHeaders(
  format?: PropagationFormat,
  sampled = true
): Record<string, string> {
  const fmt = format ?? resolvePropagationFormat();
  const ctx = newTraceContext(sampled);

  switch (fmt) {
    case "b3":
      return buildB3Header(ctx);
    case "jaeger":
      return buildJaegerHeader(ctx);
    case "w3c":
    default:
      return buildW3cHeader(ctx);
  }
}

/**
 * Merge trace headers into existing k6 request params.
 * Transparent: pass the result directly to http.get/post/request.
 *
 * @example
 * const res = http.get(url, withTracing({ tags: { scenario: "checkout" } }));
 */
export function withTracing(
  baseParams: Record<string, unknown> = {},
  format?: PropagationFormat
): Record<string, unknown> {
  const traceHeaders = buildTraceHeaders(format);
  const existing = (baseParams.headers as Record<string, string>) ?? {};
  return {
    ...baseParams,
    headers: { ...existing, ...traceHeaders },
  };
}

/**
 * Check whether tracing is enabled via K6_TEMPO_ENABLED env var.
 */
export function isTracingEnabled(): boolean {
  return (typeof __ENV !== "undefined" ? __ENV["K6_TEMPO_ENABLED"] : undefined) === "true";
}

// ── Per-iteration trace root cache (OBS2-03) ──────────────────────────────────

/**
 * Per-VU iteration trace root cache.
 *
 * k6 isolates module-level state per VU, so each VU has its own private Map
 * instance. Keys are the k6 `__ITER` global (per-VU iteration counter); values
 * are the trace root TraceContext that all HTTP calls within that iteration
 * share (same traceId, fresh spanId per call via buildIterationTraceHeaders).
 *
 * NOT exported — internal state. Use beginIteration / endIteration /
 * currentTraceRoot to interact with the cache.
 */
const _iterationCache = new Map<number, TraceContext>();

/**
 * OBS2-03: Resolve the active __ITER value (or fall back to 0 when running
 * outside the k6 runtime — e.g. inside Vitest unit tests).
 */
function resolveIter(iter?: number): number {
  if (iter !== undefined) return iter;
  return typeof __ITER !== "undefined" ? __ITER : 0;
}

/**
 * OBS2-03: Resolve the head-based sampling ratio from `K6_TEMPO_SAMPLING_RATIO`.
 *
 * Default: 1.0 (sample every iteration). Out-of-range values are clamped to
 * the [0.0, 1.0] interval. Malformed (NaN) values fall back to 1.0.
 *
 * @example
 *   K6_TEMPO_SAMPLING_RATIO unset       -> 1.0
 *   K6_TEMPO_SAMPLING_RATIO="0.1"       -> 0.1
 *   K6_TEMPO_SAMPLING_RATIO="2.5"       -> 1.0 (clamped)
 *   K6_TEMPO_SAMPLING_RATIO="-0.3"      -> 0.0 (clamped)
 *   K6_TEMPO_SAMPLING_RATIO="abc"       -> 1.0 (NaN fallback)
 */
export function resolveSamplingRatio(): number {
  const raw =
    (typeof __ENV !== "undefined" ? __ENV["K6_TEMPO_SAMPLING_RATIO"] : undefined) ?? "1.0";
  let r = parseFloat(raw);
  if (Number.isNaN(r)) r = 1.0;
  return Math.max(0, Math.min(1, r));
}

/**
 * OBS2-03: Deterministic per-iteration Bernoulli draw used for head-based
 * sampling. Same `iter` always returns the same boolean — replay-friendly
 * and reproducibility-friendly for capacity testing.
 *
 * Implementation: Knuth multiplicative hash (32-bit unsigned), then mod 1000
 * compared against `floor(ratio * 1000)`.
 *
 * @example
 *   shouldSampleIteration(1.0, anyIter)  // always true
 *   shouldSampleIteration(0.0, anyIter)  // always false
 *   shouldSampleIteration(0.5, 42)       // deterministic — always the same boolean
 */
export function shouldSampleIteration(ratio: number, iter: number): boolean {
  const h = (iter * 2654435761) >>> 0;
  return h % 1000 < Math.floor(ratio * 1000);
}

/**
 * OBS2-03: Initialize (or return the cached) trace root for an iteration.
 *
 * Idempotent — calling beginIteration twice for the same iteration returns
 * the SAME TraceContext reference. This makes it safe to call from RequestHelper
 * as a lazy-init guard (`if (!currentTraceRoot()) beginIteration()`).
 *
 * Sampling decision precedence:
 *   1. Explicit `sampled` argument wins (used by tests / advanced scenarios).
 *   2. Otherwise the deterministic Bernoulli draw via shouldSampleIteration().
 *
 * @example
 *   // In a k6 scenario (rarely called directly — RequestHelper auto-inits):
 *   export default function() {
 *     beginIteration();                    // pin the iteration root
 *     const r1 = client.get("/a");         // span 1 in trace
 *     const r2 = client.get("/b");         // span 2 in same trace (shared traceId)
 *   }
 */
export function beginIteration(iter?: number, sampled?: boolean): TraceContext {
  const i = resolveIter(iter);
  const existing = _iterationCache.get(i);
  if (existing) return existing;

  const decision =
    sampled !== undefined ? sampled : shouldSampleIteration(resolveSamplingRatio(), i);
  const ctx = newTraceContext(decision);
  _iterationCache.set(i, ctx);
  return ctx;
}

/**
 * OBS2-03: Cleanup hook — clears the cached trace root for the given iteration.
 *
 * Optional. For short-lived VUs the Map is garbage-collected with the module
 * state at VU shutdown. Long-running VUs (e.g. soak profile, 100K+ iterations)
 * SHOULD call endIteration in teardown to prevent unbounded Map growth.
 *
 * Worst-case Map memory: ~10 MB per VU at 100K iterations (well within budget).
 *
 * @example
 *   export default function() {
 *     try {
 *       // ... iteration body
 *     } finally {
 *       endIteration();
 *     }
 *   }
 */
export function endIteration(iter?: number): void {
  const i = resolveIter(iter);
  _iterationCache.delete(i);
}

/**
 * OBS2-03: Return the cached trace root for an iteration, or null if
 * beginIteration was not called for it.
 *
 * Used by RequestHelper to (a) detect first-call-of-iteration for lazy-init
 * and (b) extract the shared traceId when building per-call span headers.
 */
export function currentTraceRoot(iter?: number): TraceContext | null {
  const i = resolveIter(iter);
  return _iterationCache.get(i) ?? null;
}

/**
 * OBS2-03: Build propagation headers keyed off the iteration's cached trace
 * root. Each call within the same iteration produces the SAME traceId but a
 * FRESH spanId — so a multi-step scenario emits 1 trace with N spans (one
 * span per HTTP call) instead of N traces with 1 span each.
 *
 * Lazy-inits the iteration root via beginIteration() if currentTraceRoot()
 * returns null — RequestHelper integration is transparent (scenarios do NOT
 * need to call beginIteration themselves).
 *
 * @example
 *   const headers = buildIterationTraceHeaders();         // w3c by default
 *   const headers = buildIterationTraceHeaders("b3");     // B3 single header
 */
export function buildIterationTraceHeaders(format?: PropagationFormat): Record<string, string> {
  const root = currentTraceRoot() ?? beginIteration();
  const fmt = format ?? resolvePropagationFormat();
  const childCtx: TraceContext = {
    traceId: root.traceId,
    spanId: randomHex(8),
    parentSpanId: root.spanId,
    sampled: root.sampled,
  };

  switch (fmt) {
    case "b3":
      return buildB3Header(childCtx);
    case "jaeger":
      return buildJaegerHeader(childCtx);
    case "w3c":
    default:
      return buildW3cHeader(childCtx);
  }
}
