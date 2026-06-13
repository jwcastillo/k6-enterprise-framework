/**
 * 15-smoke-baseline — Framework smoke + baseline health check
 *
 * Verifies the target is reachable and responds within SLO thresholds.
 * Use as the first test in any CI/CD pipeline.
 *
 * Expected results:
 *   - All checks pass (green)
 *   - P95 < 500ms
 *   - Error rate < 1%
 *
 * Run:
 *   ./bin/run-test.sh --client=examples --scenario=integration/15-smoke-baseline --profile=smoke
 */

import http from "k6/http";
import { check, group, sleep } from "k6";

export const options = {
  vus: 1,
  duration: "15s",
  thresholds: {
    http_req_duration: ["p(95)<1000"],
    http_req_failed:   ["rate<0.01"],
    checks:            ["rate>0.95"],
  },
};

const BASE_URL = __ENV["BASE_URL"] ?? "https://httpbin.test.k6.io";

export default function (): void {
  group("Health check", () => {
    const res = http.get(`${BASE_URL}/get`);
    check(res, {
      "status 200": r => r.status === 200,
      "response time < 1s": r => r.timings.duration < 1000,
      "content-type is JSON": r => (r.headers["Content-Type"] ?? "").includes("application/json"),
      "body not empty": r => (r.body as string).length > 0,
    });
    sleep(0.5);
  });

  group("POST endpoint", () => {
    const res = http.post(
      `${BASE_URL}/post`,
      JSON.stringify({ health: "check", ts: Date.now() }),
      { headers: { "Content-Type": "application/json" } },
    );
    check(res, {
      "POST status 200": r => r.status === 200,
      "POST response time < 1s": r => r.timings.duration < 1000,
    });
  });
}
