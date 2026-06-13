/**
 * 01-auth-bearer — Bearer token authentication flow
 *
 * Demonstrates: AuthPattern, RequestHelper, statusCheck
 *
 * Expected results:
 *   - All requests return 200
 *   - Auth header is reflected in response
 *   - P95 < 1000ms (httpbin latency varies)
 *
 * Run:
 *   ./bin/run-test.sh --client=examples --scenario=api/01-auth-bearer --profile=smoke
 *
 * Troubleshooting:
 *   - If 401: check AUTH_TOKEN env var is set
 *   - If timeout: httpbin.test.k6.io may be slow — try again
 */

import http from "k6/http";
import { check, group } from "k6";

export const options = {
  vus: 2,
  duration: "30s",
  thresholds: {
    http_req_duration: ["p(95)<1500"],
    http_req_failed: ["rate<0.05"],
  },
};

const BASE_URL = __ENV["BASE_URL"] ?? "https://httpbin.test.k6.io";
const TOKEN = __ENV["AUTH_TOKEN"] ?? "example-bearer-token-123";

export default function (): void {
  group("Bearer auth flow", () => {
    // 1. Unauthenticated request — expect 200 (httpbin always accepts)
    const unauth = http.get(`${BASE_URL}/get`);
    check(unauth, { "unauthenticated: status 200": (r) => r.status === 200 });

    // 2. Authenticated request with Bearer token
    const res = http.get(`${BASE_URL}/bearer`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    check(res, {
      "bearer: status 200": (r) => r.status === 200,
      "bearer: authenticated field true": (r) => {
        try {
          return (JSON.parse(r.body as string) as Record<string, unknown>).authenticated === true;
        } catch {
          return false;
        }
      },
    });
  });
}
