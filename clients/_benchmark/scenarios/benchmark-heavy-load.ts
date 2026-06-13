/**
 * T-153: Benchmark heavy-load scenario
 *
 * Uses ramping-arrival-rate executor to find max sustainable throughput.
 * Pairs with the mock server for predictable responses.
 *
 * Run:
 *   node bin/mock-server.js --port=9999 --no-log &
 *   ./bin/run-test.sh --client=_benchmark --scenario=benchmark-heavy-load --profile=smoke
 */

import http from "k6/http";
import { check } from "k6";
import { Trend, Counter } from "k6/metrics";

const BENCHMARK_URL = __ENV["K6_BENCHMARK_URL"] ?? "http://127.0.0.1:9999";

// Custom metrics for overhead tracking
const frameworkOverhead = new Trend("framework_overhead_ms", true);
const highVuWarnings = new Counter("high_vu_warnings");

export const options = {
  scenarios: {
    // ramping-arrival-rate: find max throughput (T-153 requirement)
    ramp_throughput: {
      executor: "ramping-arrival-rate",
      startRate: 10,
      timeUnit: "1s",
      preAllocatedVUs: 50,
      maxVUs: 200,
      stages: [
        { duration: "1m", target: 50 }, // ramp to 50 req/s
        { duration: "2m", target: 100 }, // ramp to 100 req/s
        { duration: "1m", target: 200 }, // ramp to 200 req/s
        { duration: "1m", target: 0 }, // ramp down
      ],
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<100", "p(99)<200"],
    http_req_failed: ["rate<0.01"],
    framework_overhead_ms: ["p(95)<5"], // overhead < 5ms at p95
  },
  tags: {
    client: "_benchmark",
    test: "heavy-load",
  },
};

export default function (): void {
  const activeVUs = __VU;

  // Warn if VU count suggests distributed execution is needed
  if (activeVUs > 5000) {
    highVuWarnings.add(1);
    console.warn(
      `[benchmark] VU count ${activeVUs} > 5000. ` +
        "Consider distributed execution. See docs/DISTRIBUTED_TESTING.md"
    );
  }

  // Phase 1: raw HTTP baseline
  const rawStart = Date.now();
  const rawRes = http.get(`${BENCHMARK_URL}/api/users`, { tags: { phase: "raw" } });
  const rawMs = Date.now() - rawStart;

  check(rawRes, {
    "raw: status 200": (r) => r.status === 200,
    "raw: has users array": (r) => {
      try {
        return Array.isArray(JSON.parse(r.body as string).users);
      } catch {
        return false;
      }
    },
  });

  // Phase 2: framework-wrapped (simulated overhead measurement)
  const wrappedStart = Date.now();
  const wrappedRes = http.get(`${BENCHMARK_URL}/api/users`, {
    headers: { "X-Framework-Wrapped": "true" },
    tags: { phase: "wrapped" },
  });
  const wrappedMs = Date.now() - wrappedStart;

  check(wrappedRes, { "wrapped: status 200": (r) => r.status === 200 });

  // Record overhead
  frameworkOverhead.add(Math.max(0, wrappedMs - rawMs));
}
