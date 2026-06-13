/**
 * 04-retry-backoff — Retry with exponential backoff
 *
 * Demonstrates: framework RetryPattern, exponential backoff with jitter,
 * RequestHelper integration. Previously this file rolled its own retry loop —
 * it now uses the canonical withRetry() from src/patterns/retry-pattern.ts.
 *
 * Expected results:
 *   - Retries up to 3 times on 5xx
 *   - Each retry waits exponentially longer (with ±10% jitter)
 *   - Final success rate > 95%
 *
 * Run:
 *   ./bin/run-test.sh --client=examples --scenario=api/04-retry-backoff --profile=smoke
 */

import { check } from "k6";
import { RequestHelper } from "../../../../src/helpers/request-helper";
import { withRetry } from "../../../../src/patterns/retry-pattern";

export const options = {
  vus: 2,
  duration: "30s",
  thresholds: {
    http_req_duration: ["p(95)<3000"],
    http_req_failed: ["rate<0.1"],
  },
};

const BASE_URL = __ENV["BASE_URL"] ?? "https://httpbin.test.k6.io";
const client = new RequestHelper(BASE_URL);

export default function (): void {
  const result = withRetry(() => client.get("/get"), {
    maxAttempts: 3,
    baseDelaySeconds: 0.5,
    retryOnError: true,
  });

  check(result.value, {
    "retry: eventually succeeded": (r) => r.status === 200,
  });
  check(result, {
    "retry: completed within maxAttempts": (r) => r.attempts <= 3,
  });
}
