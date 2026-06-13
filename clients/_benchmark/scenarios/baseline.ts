/**
 * T-048: Benchmark baseline test
 *
 * Measures pure framework overhead against a local mock server
 * that responds in < 1ms. The difference between raw k6 HTTP
 * and framework-wrapped HTTP is the framework overhead.
 *
 * Run: ./bin/run-test.sh --client _benchmark --scenario baseline --profile smoke
 */

import http from "k6/http";
import { check } from "k6";
import {
  buildK6Options,
  standardSetup,
  standardTeardown,
} from "../../../src/core/execution-engine";
import { statusCheck, runChecks } from "../../../src/core/check-system";
import { RequestHelper } from "../../../src/helpers/request-helper";

export const options = buildK6Options();

export function setup(): ReturnType<typeof standardSetup> {
  return standardSetup({ name: "benchmark-baseline", client: "_benchmark" });
}

export default function (_data: ReturnType<typeof setup>): void {
  // Phase 1: Raw k6 HTTP (no framework wrappers)
  const rawStart = Date.now();
  const rawRes = http.get(`${__ENV["K6_BENCHMARK_URL"] ?? "http://127.0.0.1:9999"}/api/ping`);
  const rawElapsed = Date.now() - rawStart;

  check(rawRes, { "raw: status 200": (r) => r.status === 200 });

  // Phase 2: Framework-wrapped HTTP (RequestHelper + checks)
  const wrappedStart = Date.now();
  const benchHelper = new RequestHelper(__ENV["K6_BENCHMARK_URL"] ?? "http://127.0.0.1:9999");
  const wrappedRes = benchHelper.get("/api/ping", undefined, { tags: { benchmark: "wrapped" } });
  const wrappedElapsed = Date.now() - wrappedStart;

  runChecks(wrappedRes, [statusCheck(200)]);

  // Phase 3: Framework overhead = wrapped - raw
  const overhead = wrappedElapsed - rawElapsed;

  // Report as custom metrics via console (parsed by benchmark runner)
  if (__ENV["K6_DEBUG"] === "true") {
    console.log(
      `[benchmark] raw=${rawElapsed}ms wrapped=${wrappedElapsed}ms overhead=${overhead}ms`
    );
  }
}

export function teardown(data: ReturnType<typeof setup>): void {
  standardTeardown(data);
}
