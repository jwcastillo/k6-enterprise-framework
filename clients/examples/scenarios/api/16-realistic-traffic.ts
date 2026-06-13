/**
 * 16-realistic-traffic — Realistic traffic simulation with arrival-rate executor
 *
 * Demonstrates open-model load testing where request rate is independent
 * of server response time, combined with realistic think times:
 *   - Arrival-rate executor (constant throughput)
 *   - Normally-distributed think times between requests
 *   - Iteration pacing for consistent throughput
 *   - Weighted endpoint mix (browse 60%, search 30%, create 10%)
 *
 * Run:
 *   ./bin/run-test.sh --client=examples --scenario=api/16-realistic-traffic --profile=throughput-medium
 */

import http from "k6/http";
import { check } from "k6";
import { profileToOptions } from "../../../../src/core/profile-loader";
import { thinkTimeNormal, pace } from "../../../../src/helpers/think-time-helper";

export const options = profileToOptions("throughput-medium");

const BASE_URL = __ENV["BASE_URL"] ?? "https://httpbin.test.k6.io";

// Target iteration duration: 5 seconds
const ITERATION_PACE_MS = 5000;

function browse(): void {
  const res = http.get(`${BASE_URL}/get?action=browse`);
  check(res, { "browse: 200": (r) => r.status === 200 });
}

function search(): void {
  const res = http.get(`${BASE_URL}/get?action=search&q=k6+framework`);
  check(res, { "search: 200": (r) => r.status === 200 });
}

function create(): void {
  const res = http.post(
    `${BASE_URL}/post`,
    JSON.stringify({ action: "create", vu: __VU, iter: __ITER }),
    { headers: { "Content-Type": "application/json" } },
  );
  check(res, { "create: 200": (r) => r.status === 200 });
}

export default function (): void {
  const iterStart = Date.now();

  // Weighted endpoint selection
  const roll = Math.random();
  if (roll < 0.6) {
    browse();
  } else if (roll < 0.9) {
    search();
  } else {
    create();
  }

  // Realistic think time: ~2s mean, 0.5s stddev (normally distributed)
  thinkTimeNormal(2, 0.5);

  // Pace the iteration to a fixed 5s window for consistent throughput
  pace(ITERATION_PACE_MS, iterStart);
}
