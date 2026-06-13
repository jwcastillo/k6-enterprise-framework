/**
 * 09-ecommerce-flow — Multi-step e-commerce journey with SLI + observability
 *
 * Simulates: browse → search → view product → add to cart → checkout
 *
 * Demonstrates:
 *   - Multi-step flows, data correlation, realistic think times
 *   - Per-step SLI tracking (availability, latency, correctness)
 *   - Tempo:     W3C traceparent headers per request (distributed tracing)
 *   - Loki:      Structured JSON logs with trace_id for cross-signal correlation
 *   - Pyroscope: Profiling labels for CPU/memory analysis per test run
 *
 * Observability env vars (set automatically in docker-compose):
 *   K6_TEMPO_ENABLED=true          — inject traceparent headers
 *   K6_STRUCTURED_LOGS=true        — emit JSON log lines for Loki
 *   K6_PYROSCOPE_ENABLED=true      — inject X-Pyroscope-App-Name headers
 *
 * Run (standalone):
 *   ./bin/run-test.sh --client=examples --scenario=mixed/09-ecommerce-flow --profile=smoke
 *
 * Run (with observability stack):
 *   docker compose --profile observability up -d
 *   K6_TEMPO_ENABLED=true K6_STRUCTURED_LOGS=true K6_PYROSCOPE_ENABLED=true \
 *     ./bin/run-test.sh --client=examples --scenario=mixed/09-ecommerce-flow --profile=smoke
 */

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Counter, Trend, Rate } from "k6/metrics";

// ── Framework observability integrations ────────────────────────────────────
import { withTracing, isTracingEnabled, newTraceContext } from "@observability/tracing-instrumentation";
import { withPyroscopeLabels, resolvePyroscopeConfig } from "@observability/pyroscope-instrumentation";
import { StructuredLogger } from "@helpers/structured-logger";

// ── SLI Metrics ─────────────────────────────────────────────────────────────

/** SLI: Availability — non-5xx responses across all steps */
const sliAvailability = new Rate("sli_ecommerce_availability");

/** SLI: Latency — response time per step */
const sliLatency = new Trend("sli_ecommerce_latency_ms");

/** SLI: Correctness — valid payloads with expected fields */
const sliCorrectness = new Rate("sli_ecommerce_correctness");

/** SLI: Checkout latency — critical path for the business */
const sliCheckoutLatency = new Trend("sli_checkout_latency_ms");

/** SLI: Journey completion — full 5-step journey completed */
const sliJourneyCompletion = new Rate("sli_journey_completion");

/** Operational: count of completed business transactions */
const journeyCount = new Counter("sli_journeys_total");

// ── Init context: resolve observability config once ─────────────────────────

const pyroscopeConfig = resolvePyroscopeConfig(__ENV);
const logger = new StructuredLogger({
  scenario: "09-ecommerce-flow",
  client: __ENV["K6_CLIENT"] ?? "examples",
});

// ── Options ─────────────────────────────────────────────────────────────────

export const options = {
  vus: 2,
  duration: "30s",
  thresholds: {
    // Standard k6 thresholds
    http_req_duration: ["p(95)<2000"],
    http_req_failed: ["rate<0.05"],
    "group_duration{group:::Checkout}": ["p(95)<2000"],

    // SLI thresholds aligned with SLO targets (config/slos.json)
    sli_ecommerce_availability: ["rate>0.99"],
    sli_ecommerce_latency_ms: ["p(95)<1000", "p(99)<2000"],
    sli_ecommerce_correctness: ["rate>0.95"],
    sli_checkout_latency_ms: ["p(95)<1500"],
    sli_journey_completion: ["rate>0.95"],
  },
};

const BASE_URL = __ENV["BASE_URL"] ?? "https://httpbin.test.k6.io";

// ── Instrumented request helper ─────────────────────────────────────────────

function instrumentedParams(
  tags: Record<string, string> = {},
  extraHeaders: Record<string, string> = {},
): Record<string, unknown> {
  let params: Record<string, unknown> = {
    headers: { ...extraHeaders },
    tags,
  };

  if (isTracingEnabled()) {
    params = withTracing(params);
  }

  params = withPyroscopeLabels(params, pyroscopeConfig);

  return params;
}

// ── SLI helpers ─────────────────────────────────────────────────────────────

function trackSli(res: ReturnType<typeof http.get>, correctnessCheck: boolean): boolean {
  const available = res.status > 0 && res.status < 500;
  sliAvailability.add(available ? 1 : 0);
  sliLatency.add(res.timings.duration);
  sliCorrectness.add(correctnessCheck ? 1 : 0);
  return available && correctnessCheck;
}

// ── Test Scenario ───────────────────────────────────────────────────────────

export default function (): void {
  let productId: string | null = null;
  let cartId: string | null    = null;
  let stepsOk = 0;

  // One trace context per journey — all 5 steps share the same traceId
  const traceCtx = newTraceContext();
  const journeyLogger = logger.child({
    vu: __VU,
    iter: __ITER,
    trace_id: traceCtx.traceId,
  });

  group("Browse", () => {
    const params = instrumentedParams(
      { step: "browse", group: "ecommerce" },
      { "Content-Type": "application/json" },
    );

    const res = http.get(`${BASE_URL}/get?page=home`, params);
    const ok = check(res, { "browse: 200": r => r.status === 200 });
    if (trackSli(res, ok)) stepsOk++;

    journeyLogger.logRequest("GET", `${BASE_URL}/get?page=home`, res.status, res.timings.duration, {
      step: "browse",
      sli_ok: ok,
    });

    sleep(0.5);
  });

  group("Search", () => {
    const params = instrumentedParams(
      { step: "search", group: "ecommerce" },
      { "Content-Type": "application/json" },
    );

    const res = http.get(`${BASE_URL}/get?q=running+shoes&category=sports`, params);
    const ok = check(res, { "search: 200": r => r.status === 200 });
    if (trackSli(res, ok)) stepsOk++;
    productId = `PROD-${__VU}-${__ITER}`;

    journeyLogger.logRequest("GET", `${BASE_URL}/get?q=running+shoes`, res.status, res.timings.duration, {
      step: "search",
      sli_ok: ok,
    });

    sleep(0.3);
  });

  group("View product", () => {
    const params = instrumentedParams(
      { step: "view-product", group: "ecommerce" },
      { "Content-Type": "application/json" },
    );

    const res = http.get(`${BASE_URL}/anything?productId=${productId}`, params);
    const correct = check(res, {
      "product: 200": r => r.status === 200,
      "product: has args": r => {
        try { return "args" in (JSON.parse(r.body as string) as Record<string, unknown>); }
        catch { return false; }
      },
    });
    if (trackSli(res, correct)) stepsOk++;

    journeyLogger.logRequest("GET", `${BASE_URL}/anything`, res.status, res.timings.duration, {
      step: "view-product",
      productId,
      sli_ok: correct,
    });

    sleep(0.8);
  });

  group("Add to cart", () => {
    const payload = JSON.stringify({ productId, quantity: 1, userId: `user-${__VU}` });
    const params = instrumentedParams(
      { step: "add-to-cart", group: "ecommerce" },
      { "Content-Type": "application/json" },
    );

    const res = http.post(`${BASE_URL}/post`, payload, params);
    const ok = check(res, { "add to cart: 200": r => r.status === 200 });
    if (trackSli(res, ok)) stepsOk++;
    cartId = `CART-${__VU}-${__ITER}`;

    journeyLogger.logRequest("POST", `${BASE_URL}/post`, res.status, res.timings.duration, {
      step: "add-to-cart",
      productId,
      cartId,
      sli_ok: ok,
    });

    sleep(0.2);
  });

  group("Checkout", () => {
    const payload = JSON.stringify({
      cartId,
      payment: { method: "card", last4: "4242" },
      shipping: { address: "123 Test St" },
    });
    const params = instrumentedParams(
      { step: "checkout", group: "ecommerce" },
      { "Content-Type": "application/json" },
    );

    const res = http.post(`${BASE_URL}/post`, payload, params);
    const correct = check(res, {
      "checkout: 200": r => r.status === 200,
      "checkout: payload echoed": r => {
        try {
          const body = JSON.parse(r.body as string) as Record<string, unknown>;
          return "json" in body;
        } catch { return false; }
      },
    });

    // Checkout-specific SLI
    sliCheckoutLatency.add(res.timings.duration);
    if (trackSli(res, correct)) stepsOk++;

    journeyLogger.logRequest("POST", `${BASE_URL}/post`, res.status, res.timings.duration, {
      step: "checkout",
      cartId,
      sli_ok: correct,
      checkout_latency_ms: res.timings.duration,
    });

    sleep(0.5);
  });

  // SLI: Journey completion — all 5 steps must succeed
  const journeyComplete = stepsOk === 5;
  sliJourneyCompletion.add(journeyComplete ? 1 : 0);
  if (journeyComplete) journeyCount.add(1);

  // Log journey summary to Loki
  journeyLogger.logEvent("journey_complete", {
    steps_ok: stepsOk,
    steps_total: 5,
    journey_complete: journeyComplete,
  });
}
