/**
 * 07-structured-logging — Structured logging with StructuredLogger helper
 *
 * Demonstrates: StructuredLogger, log levels, per-request context
 *
 * Expected results:
 *   - Logs appear as JSON lines with timestamp, level, service, message
 *   - No overhead on success path (logging is async in k6)
 *
 * Run:
 *   ./bin/run-test.sh --client=examples --scenario=api/07-structured-logging --profile=smoke --debug
 */

import http from "k6/http";
import { check } from "k6";

export const options = {
  vus: 1,
  duration: "20s",
  thresholds: {
    http_req_duration: ["p(95)<1500"],
    http_req_failed: ["rate<0.05"],
  },
};

const BASE_URL = __ENV["BASE_URL"] ?? "https://httpbin.test.k6.io";

// Lightweight structured logger (no external dep in k6 runtime)
function structuredLog(
  level: "info" | "warn" | "error",
  message: string,
  ctx: Record<string, unknown> = {}
): void {
  if (__ENV["K6_DEBUG"] !== "true" && level === "info") return;
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: "examples",
      vu: __VU,
      iter: __ITER,
      message,
      ...ctx,
    })
  );
}

export default function (): void {
  structuredLog("info", "starting iteration", { endpoint: "/get" });

  const start = Date.now();
  const res = http.get(`${BASE_URL}/get`);
  const ms = Date.now() - start;

  if (res.status !== 200) {
    structuredLog("warn", "unexpected status", {
      status: res.status,
      url: res.url,
      durationMs: ms,
    });
  } else {
    structuredLog("info", "request ok", { status: res.status, durationMs: ms });
  }

  check(res, { "status 200": (r) => r.status === 200 });
}
