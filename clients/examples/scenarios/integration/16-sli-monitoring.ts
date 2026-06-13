/**
 * 16-sli-monitoring — SLI tracking with full observability stack
 *
 * Demonstrates how to define and track SLIs using k6 custom metrics,
 * integrated with the framework's observability stack:
 *
 *   - Tempo:     Distributed trace headers (W3C traceparent) per request
 *   - Loki:      Structured JSON logs with trace_id correlation
 *   - Pyroscope: Profiling labels per request for CPU/memory correlation
 *
 * SLIs tracked:
 *   - Availability: % of successful (non-5xx) responses
 *   - Latency: response time distribution (p50, p95, p99)
 *   - Correctness: % of responses with valid payload
 *   - Throughput: sustained requests per second
 *
 * Observability env vars (set automatically in docker-compose):
 *   K6_TEMPO_ENABLED=true          — inject traceparent headers
 *   K6_TEMPO_PROPAGATION=w3c       — W3C, b3, or jaeger
 *   K6_STRUCTURED_LOGS=true        — emit JSON log lines for Loki
 *   K6_PYROSCOPE_ENABLED=true      — inject X-Pyroscope-App-Name headers
 *
 * Run (standalone):
 *   ./bin/run-test.sh --client=examples --scenario=integration/16-sli-monitoring --profile=smoke
 *
 * Run (with observability stack):
 *   docker compose --profile observability up -d
 *   K6_TEMPO_ENABLED=true K6_STRUCTURED_LOGS=true K6_PYROSCOPE_ENABLED=true \
 *     ./bin/run-test.sh --client=examples --scenario=integration/16-sli-monitoring --profile=smoke
 */

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Counter, Trend, Rate, Gauge } from "k6/metrics";
import { Options } from "k6/options";

// ── Framework observability integrations ────────────────────────────────────
import { withTracing, isTracingEnabled, newTraceContext } from "@observability/tracing-instrumentation";
import { withPyroscopeLabels, resolvePyroscopeConfig } from "@observability/pyroscope-instrumentation";
import { StructuredLogger } from "@helpers/structured-logger";

// ── SLI Custom Metrics ──────────────────────────────────────────────────────

/** SLI: Availability — tracks successful (non-server-error) responses */
const sliAvailability = new Rate("sli_availability");

/** SLI: Latency — response time distribution in milliseconds */
const sliLatency = new Trend("sli_latency_ms");

/** SLI: Correctness — responses with valid, expected payload */
const sliCorrectness = new Rate("sli_correctness");

/** SLI: Throughput — successful business transactions completed */
const sliThroughput = new Counter("sli_throughput_total");

/** SLI: Error budget — tracks error occurrences (inverse of availability) */
const sliErrors = new Counter("sli_errors_total");

/** Operational: current VU count for capacity correlation */
const activeVUs = new Gauge("sli_active_vus");

// ── Init context: resolve observability config once ─────────────────────────

const pyroscopeConfig = resolvePyroscopeConfig(__ENV);
const logger = new StructuredLogger({
  scenario: "16-sli-monitoring",
  client: __ENV["K6_CLIENT"] ?? "examples",
});

// ── Options with SLO-aligned thresholds ─────────────────────────────────────

export const options: Options = {
  scenarios: {
    sli_baseline: {
      executor: "ramping-vus",
      exec: "sliTest",
      startVUs: 1,
      stages: [
        { duration: "10s", target: 3 },
        { duration: "20s", target: 3 },
        { duration: "5s",  target: 0 },
      ],
    },
  },
  thresholds: {
    // SLI: Availability — SLO target: 99.9%
    sli_availability: [
      { threshold: "rate>0.999", abortOnFail: false },
      { threshold: "rate>0.99",  abortOnFail: true },
    ],

    // SLI: Latency — SLO targets: p95 < 800ms, p99 < 1500ms
    sli_latency_ms: ["p(50)<400", "p(95)<800", "p(99)<1500"],

    // SLI: Correctness — SLO target: > 95% correct responses
    sli_correctness: ["rate>0.95"],

    // Standard k6 metrics as SLI backing
    http_req_duration: ["p(95)<800", "p(99)<1500"],
    http_req_failed: ["rate<0.01"],
    checks: ["rate>0.95"],
  },
};

// ── Constants ───────────────────────────────────────────────────────────────

const BASE_URL = __ENV["BASE_URL"] ?? "https://httpbin.test.k6.io";

// ── Instrumented request helper ─────────────────────────────────────────────

/**
 * Build k6 request params with observability headers injected:
 * - traceparent (Tempo) when K6_TEMPO_ENABLED=true
 * - X-Pyroscope-App-Name when K6_PYROSCOPE_ENABLED=true
 */
function instrumentedParams(
  tags: Record<string, string> = {},
  extraHeaders: Record<string, string> = {},
): Record<string, unknown> {
  let params: Record<string, unknown> = {
    headers: { ...extraHeaders },
    tags,
  };

  // Inject W3C traceparent / b3 / jaeger headers for Tempo
  if (isTracingEnabled()) {
    params = withTracing(params);
  }

  // Inject Pyroscope profiling labels
  params = withPyroscopeLabels(params, pyroscopeConfig);

  return params;
}

// ── SLI Tracking ────────────────────────────────────────────────────────────

interface SliResult {
  available: boolean;
  correct: boolean;
  latencyMs: number;
  traceId?: string;
}

function recordSli(result: SliResult, operation: string): void {
  sliAvailability.add(result.available ? 1 : 0);
  sliCorrectness.add(result.correct ? 1 : 0);
  sliLatency.add(result.latencyMs);

  if (result.available && result.correct) {
    sliThroughput.add(1);
  }

  if (!result.available) {
    sliErrors.add(1);
    // Log error to Loki with trace correlation
    logger.logError(`SLI breach: ${operation} unavailable`, undefined, {
      operation,
      latencyMs: result.latencyMs,
      trace_id: result.traceId ?? "none",
    });
  }
}

function isAvailable(status: number): boolean {
  return status > 0 && status < 500;
}

function isCorrectPayload(body: string, expectedFields: string[]): boolean {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    return expectedFields.every((field) => field in parsed);
  } catch {
    return false;
  }
}

// ── Test Scenario ───────────────────────────────────────────────────────────

export function sliTest(): void {
  activeVUs.add(__VU);

  // Generate a trace context for this iteration (shared across groups)
  const traceCtx = newTraceContext();
  const iterLogger = logger.child({
    vu: __VU,
    iter: __ITER,
    trace_id: traceCtx.traceId,
  });

  // ── SLI: GET endpoint (read operation) ──
  group("SLI: Read Operation", () => {
    const params = instrumentedParams(
      { operation: "read", group: "sli-read" },
      { "Content-Type": "application/json" },
    );

    const res = http.get(`${BASE_URL}/get?service=httpbin-api&op=read`, params);

    const available = isAvailable(res.status);
    const correct = isCorrectPayload(res.body as string, ["args", "headers", "url"]);

    check(res, {
      "read: available (non-5xx)": () => available,
      "read: status 200": (r) => r.status === 200,
      "read: correct payload": () => correct,
      "read: latency < p95 SLO": (r) => r.timings.duration < 800,
    });

    recordSli({
      available,
      correct,
      latencyMs: res.timings.duration,
      traceId: traceCtx.traceId,
    }, "read");

    // Structured log for Loki
    iterLogger.logRequest("GET", `${BASE_URL}/get`, res.status, res.timings.duration, {
      operation: "read",
      sli_available: available,
      sli_correct: correct,
    });

    sleep(0.3);
  });

  // ── SLI: POST endpoint (write operation) ──
  group("SLI: Write Operation", () => {
    const payload = JSON.stringify({
      userId: `user-${__VU}`,
      action: "create",
      timestamp: Date.now(),
      data: { name: "SLI Test", iteration: __ITER },
    });

    const params = instrumentedParams(
      { operation: "write", group: "sli-write" },
      { "Content-Type": "application/json" },
    );

    const res = http.post(`${BASE_URL}/post`, payload, params);

    const available = isAvailable(res.status);
    const correct = isCorrectPayload(res.body as string, ["json", "headers", "url"]);

    check(res, {
      "write: available (non-5xx)": () => available,
      "write: status 200": (r) => r.status === 200,
      "write: correct payload": () => correct,
      "write: echoed data": () => {
        try {
          const body = JSON.parse(res.body as string) as Record<string, unknown>;
          return body.json !== undefined;
        } catch {
          return false;
        }
      },
    });

    recordSli({
      available,
      correct,
      latencyMs: res.timings.duration,
      traceId: traceCtx.traceId,
    }, "write");

    iterLogger.logRequest("POST", `${BASE_URL}/post`, res.status, res.timings.duration, {
      operation: "write",
      sli_available: available,
      sli_correct: correct,
    });

    sleep(0.2);
  });

  // ── SLI: Varied response codes (tests availability tracking) ──
  group("SLI: Status Validation", () => {
    const statuses = [200, 200, 200, 200, 201, 204, 200, 200, 200, 200];
    const targetStatus = statuses[__ITER % statuses.length];

    const params = instrumentedParams(
      { operation: "status-check", group: "sli-status" },
    );

    const res = http.get(`${BASE_URL}/status/${targetStatus}`, params);

    const available = isAvailable(res.status);
    const correct = res.status === targetStatus;

    check(res, {
      "status: available": () => available,
      "status: matches expected": () => correct,
    });

    recordSli({
      available,
      correct,
      latencyMs: res.timings.duration,
      traceId: traceCtx.traceId,
    }, "status-check");

    iterLogger.logRequest("GET", `${BASE_URL}/status/${targetStatus}`, res.status, res.timings.duration, {
      operation: "status-check",
      expected_status: targetStatus,
      sli_available: available,
    });

    sleep(0.2);
  });

  // ── SLI: Latency-sensitive endpoint ──
  group("SLI: Latency Sensitive", () => {
    const params = instrumentedParams(
      { operation: "latency-check", group: "sli-latency" },
    );

    const res = http.get(`${BASE_URL}/delay/0`, params);

    const available = isAvailable(res.status);
    const correct = isCorrectPayload(res.body as string, ["url"]);

    check(res, {
      "latency: available": () => available,
      "latency: correct": () => correct,
      "latency: within p50 SLO (400ms)": (r) => r.timings.duration < 400,
      "latency: within p95 SLO (800ms)": (r) => r.timings.duration < 800,
      "latency: within p99 SLO (1500ms)": (r) => r.timings.duration < 1500,
    });

    recordSli({
      available,
      correct,
      latencyMs: res.timings.duration,
      traceId: traceCtx.traceId,
    }, "latency-check");

    iterLogger.logRequest("GET", `${BASE_URL}/delay/0`, res.status, res.timings.duration, {
      operation: "latency-check",
      sli_available: available,
      sli_correct: correct,
      latency_p50_ok: res.timings.duration < 400,
      latency_p95_ok: res.timings.duration < 800,
    });

    sleep(0.3);
  });

  // ── Log iteration summary to Loki ──
  iterLogger.logEvent("sli_iteration_complete", {
    total_operations: 4,
  });
}
