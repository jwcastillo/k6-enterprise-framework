/**
 * Reference Scenario: checkout-flow (Mixed)
 *
 * @executor    constant-vus
 * @profile     smoke (1-2 VUs, 1 min) | load (20 VUs, 14 min) | stress (400 VUs, 25 min)
 * @thresholds  http_req_duration p(95)<800ms, http_req_failed rate<0.01
 * @cli         ./bin/run-test.sh --client=_reference --scenario=mixed/checkout-flow --profile=smoke
 * @expected    Full checkout flow completes: browse -> add-to-cart -> checkout, p95 < 800ms
 * @troubleshoot High error rate = check payment service mock is running
 *               Slow p95 = reduce VU count or increase think time
 *
 * Demonstrates:
 * - Auth + Correlation + Pagination patterns integrated (3+ patterns per T-004 AC#8)
 * - DataHelper for realistic test data generation
 * - PerformanceHelper for inline threshold evaluation
 * - WeightedSwitch for traffic distribution
 * - StructuredLogger for structured output
 */

import { sleep } from "k6";
import { Options } from "k6/options";
import { RequestHelper } from "@helpers/request-helper";
import {
  runChecks,
  statusCheck,
  schemaCheck,
  thresholdCheck,
} from "@core/check-system";
import { extractFromResponse, interpolate } from "@patterns/correlation-pattern";
import { initPagination, advancePagination } from "@patterns/pagination-pattern";
import { weightedSwitch } from "@patterns/weighted-execution";
import { DataHelper } from "@helpers/data-helper";
import { PerformanceHelper } from "@helpers/performance-helper";
import { StructuredLogger } from "@helpers/structured-logger";

const BASE_URL = __ENV["API_BASE_URL"] ?? "https://httpbin.org";

export const options: Options = {
  stages: [
    { duration: "10s", target: 2 },
    { duration: "20s", target: 3 },
    { duration: "10s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<2500"],
    checks: ["rate>=0.90"],
  },
};

const client = new RequestHelper(BASE_URL, {
  tags: { client: "_reference", scenario: "checkout-flow" },
});

const logger = new StructuredLogger({
  client: "_reference",
  scenario: "checkout-flow",
});

// Track durations for inline performance analysis
const durations: number[] = [];

// ── Scenario functions ────────────────────────────────────────────────────────

function browseCatalog(): void {
  // Pattern 1: Pagination
  const paginationConfig = {
    style: "offset" as const,
    pageSize: 2,
    itemsPath: "args",
  };
  let state = initPagination(paginationConfig);

  for (let page = 0; page < 2 && state.hasMore; page++) {
    const res = client.get("/get", {
      ...state.nextParams,
      catalog: "products",
    });
    runChecks(res, [statusCheck(200), thresholdCheck(2000)]);
    durations.push(res.timings.duration);
    state = advancePagination(state, res, paginationConfig);
    sleep(0.2);
  }
}

function addToCart(): void {
  // Pattern 2: Correlation — extract item ID from browse response, use in cart
  const browseRes = client.get("/get", { action: "browse" });
  runChecks(browseRes, [statusCheck(200), thresholdCheck(2000)]);

  const extracted = extractFromResponse(browseRes, [
    // httpbin echoes our sent headers under response.headers — use Content-Type as demo
    { name: "requestId", jsonPath: "headers.X-Request-Id" },
    { name: "traceId", jsonPath: "headers.X-Trace-Id" },
  ]);

  const cartPath = interpolate("/post", extracted); // demonstrates interpolation
  const item = {
    productId: DataHelper.randomString(8, "0123456789abcdef"),
    quantity: Math.floor(Math.random() * 3) + 1,
    price: DataHelper.randomPrice(5, 200),
    correlationId: extracted["requestId"],
  };

  const cartRes = client.post(cartPath, item);
  runChecks(cartRes, [statusCheck(200), schemaCheck(["json", "url"]), thresholdCheck(2000)]);

  durations.push(cartRes.timings.duration);
  logger.logEvent("cart.add", {
    productId: item.productId,
    quantity: item.quantity,
  });
}

function checkout(): void {
  // Pattern 3: Auth + Correlation combined
  const orderData = {
    orderId: DataHelper.randomString(12),
    items: DataHelper.randomPrice(10, 500),
    cardLast4: DataHelper.randomCreditCard().slice(-4),
    timestamp: new Date().toISOString(),
  };

  const res = client.post("/post", orderData, {
    extraHeaders: { "X-Idempotency-Key": DataHelper.randomString(16) },
  });

  runChecks(res, [statusCheck(200), schemaCheck(["json"]), thresholdCheck(3000)]);

  durations.push(res.timings.duration);
}

// ── Default VU function ───────────────────────────────────────────────────────

export default function (): void {
  weightedSwitch([
    { name: "browse-catalog", weight: 50, fn: browseCatalog },
    { name: "add-to-cart", weight: 35, fn: addToCart },
    { name: "checkout", weight: 15, fn: checkout },
  ]);

  sleep(0.5);
}

export function handleSummary(_data: Record<string, unknown>): Record<string, string> {
  if (durations.length >= 1) {
    const perf = PerformanceHelper.aggregate(durations);
    const pct = PerformanceHelper.percentiles(durations);
    console.log(
      `\n✓ checkout-flow summary — avg=${perf.avg.toFixed(0)}ms p95=${pct.p95.toFixed(0)}ms samples=${perf.count}`
    );
  }
  return {};
}
