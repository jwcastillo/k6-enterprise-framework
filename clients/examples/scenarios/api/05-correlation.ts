/**
 * 05-correlation — Data correlation between sequential requests
 *
 * Demonstrates: extracting data from response and using in next request
 * (e.g. create → read → update → delete lifecycle)
 *
 * Expected results:
 *   - Create returns 200 with body echoed
 *   - Read uses correlation ID from create response
 *   - P95 < 1500ms
 *
 * Run:
 *   ./bin/run-test.sh --client=examples --scenario=api/05-correlation --profile=smoke
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

export default function (): void {
  group("Create → Read correlation", () => {
    // Step 1: Create (POST) — extract correlation ID from response
    const payload = { userId: `user-${__VU}-${__ITER}`, action: "create" };
    const createRes = http.post(`${BASE_URL}/post`, JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
    });

    let correlationId: string | null = null;
    check(createRes, {
      "create: status 200": r => r.status === 200,
      "create: body echoes payload": r => {
        try {
          const body = JSON.parse(r.body as string) as Record<string, unknown>;
          const json = body["json"] as Record<string, string>;
          correlationId = json["userId"] ?? null;
          return correlationId !== null;
        } catch { return false; }
      },
    });

    // Step 2: Read — use correlated ID
    if (correlationId) {
      const readRes = http.get(`${BASE_URL}/anything?userId=${correlationId}`, {
        headers: { "X-Correlation-ID": correlationId },
      });
      check(readRes, {
        "read: status 200": r => r.status === 200,
        "read: correlation ID echoed in headers": r => {
          try {
            const body = JSON.parse(r.body as string) as Record<string, unknown>;
            const headers = body["headers"] as Record<string, string>;
            return headers["X-Correlation-Id"] === correlationId;
          } catch { return false; }
        },
      });
    }
  });
}
