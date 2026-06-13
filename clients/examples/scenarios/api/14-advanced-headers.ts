/**
 * 14-advanced-headers — Advanced header management
 *
 * Demonstrates: custom headers, header correlation, locale negotiation,
 * X-Request-ID tracking, Content-Negotiation
 *
 * Run:
 *   ./bin/run-test.sh --client=examples --scenario=api/14-advanced-headers --profile=smoke
 */

import http from "k6/http";
import { check, group } from "k6";
import { uuid } from "../../../../src/helpers/data-helper";

export const options = {
  vus: 2,
  duration: "20s",
  thresholds: {
    http_req_duration: ["p(95)<1500"],
    http_req_failed: ["rate<0.05"],
  },
};

const BASE_URL = __ENV["BASE_URL"] ?? "https://httpbin.test.k6.io";

export default function (): void {
  group("X-Request-ID tracking", () => {
    const requestId = uuid();
    const res = http.get(`${BASE_URL}/headers`, {
      headers: { "X-Request-ID": requestId },
    });

    check(res, {
      "status 200": (r) => r.status === 200,
      "X-Request-Id echoed": (r) => {
        try {
          const body = JSON.parse(r.body as string) as Record<string, unknown>;
          const headers = body["headers"] as Record<string, string>;
          return headers["X-Request-Id"] === requestId;
        } catch {
          return false;
        }
      },
    });
  });

  group("Content negotiation", () => {
    const res = http.get(`${BASE_URL}/get`, {
      headers: {
        Accept: "application/json, text/plain;q=0.9",
        "Accept-Language": "en-US,es;q=0.8",
        "Accept-Encoding": "gzip, deflate",
      },
    });
    check(res, { "content-neg: 200": (r) => r.status === 200 });
  });

  group("Correlation chain", () => {
    const traceId = `trace-${uuid()}`;
    const spanId = `span-${uuid()}`;

    const res = http.get(`${BASE_URL}/headers`, {
      headers: {
        "X-Trace-ID": traceId,
        "X-Span-ID": spanId,
        "X-Client-ID": `k6-examples-vu${__VU}`,
      },
    });
    check(res, {
      "trace: 200": (r) => r.status === 200,
      "trace: X-Trace-Id echoed": (r) => {
        try {
          const headers = (JSON.parse(r.body as string) as Record<string, unknown>)[
            "headers"
          ] as Record<string, string>;
          return headers["X-Trace-Id"] === traceId;
        } catch {
          return false;
        }
      },
    });
  });
}
