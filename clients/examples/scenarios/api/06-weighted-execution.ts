/**
 * 06-weighted-execution — Weighted random scenario selection
 *
 * Simulates realistic traffic distribution:
 *   60% → browse/GET
 *   30% → search
 *   10% → create/POST
 *
 * Demonstrates: WeightedExecutionPattern, realistic traffic mix
 *
 * Run:
 *   ./bin/run-test.sh --client=examples --scenario=api/06-weighted-execution --profile=smoke
 */

import http from "k6/http";
import { check } from "k6";

export const options = {
  vus: 3,
  duration: "30s",
  thresholds: {
    http_req_duration: ["p(95)<1500"],
    http_req_failed: ["rate<0.05"],
  },
};

const BASE_URL = __ENV["BASE_URL"] ?? "https://httpbin.test.k6.io";

// Weighted random selection
function pickWeighted<T>(choices: Array<{ weight: number; value: T }>): T {
  const total = choices.reduce((sum, c) => sum + c.weight, 0);
  let random = Math.random() * total;
  for (const choice of choices) {
    random -= choice.weight;
    if (random <= 0) return choice.value;
  }
  return choices[choices.length - 1].value;
}

function browse(): void {
  const res = http.get(`${BASE_URL}/get?action=browse`);
  check(res, { "browse: 200": (r) => r.status === 200 });
}

function search(): void {
  const res = http.get(`${BASE_URL}/get?action=search&q=k6+framework`);
  check(res, { "search: 200": (r) => r.status === 200 });
}

function create(): void {
  const res = http.post(`${BASE_URL}/post`, JSON.stringify({ action: "create", vu: __VU }), {
    headers: { "Content-Type": "application/json" },
  });
  check(res, { "create: 200": (r) => r.status === 200 });
}

export default function (): void {
  const scenario = pickWeighted([
    { weight: 60, value: browse },
    { weight: 30, value: search },
    { weight: 10, value: create },
  ]);
  scenario();
}
