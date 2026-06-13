/**
 * 08-rate-limiting — Adaptive rate limiting with backoff
 *
 * Detects 429 Too Many Requests and applies backoff before retrying.
 * Demonstrates resilient API clients.
 *
 * Expected results:
 *   - Eventually succeeds after backing off
 *   - Tracks and reports 429 occurrences
 *
 * Run:
 *   ./bin/run-test.sh --client=examples --scenario=api/08-rate-limiting --profile=smoke
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

export const options = {
  vus: 2,
  duration: "30s",
  thresholds: {
    http_req_duration: ["p(95)<3000"],
    http_req_failed: ["rate<0.1"],
  },
};

const BASE_URL    = __ENV["BASE_URL"] ?? "https://httpbin.test.k6.io";
const rateLimited = new Counter("rate_limited_requests");

function requestWithBackoff(url: string, maxRetries = 3): ReturnType<typeof http.get> | null {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = http.get(url);

    if (res.status === 429) {
      rateLimited.add(1);
      const retryAfter = parseInt(res.headers["Retry-After"] ?? "2", 10);
      sleep(Math.min(retryAfter, 10)); // cap at 10s
      continue;
    }

    return res;
  }
  return null;
}

export default function (): void {
  // httpbin /status/200 always returns 200 — demonstrates the pattern
  const res = requestWithBackoff(`${BASE_URL}/status/200`);

  if (res) {
    check(res, { "status 200 after backoff": r => r.status === 200 });
  } else {
    check(null, { "max retries on rate limit": () => false });
  }
}
