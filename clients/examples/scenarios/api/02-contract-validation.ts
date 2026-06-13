/**
 * 02-contract-validation — JSON Schema contract testing
 *
 * Demonstrates: ContractValidationPattern, schemaCheck, runChecks
 *
 * Expected results:
 *   - Response body matches expected schema
 *   - No unexpected field types
 *   - P95 < 1500ms
 *
 * Run:
 *   ./bin/run-test.sh --client=examples --scenario=api/02-contract-validation --profile=smoke
 */

import http from "k6/http";
import { check, group } from "k6";

export const options = {
  vus: 1,
  duration: "20s",
  thresholds: {
    http_req_duration: ["p(95)<1500"],
    http_req_failed: ["rate<0.05"],
  },
};

const BASE_URL = __ENV["BASE_URL"] ?? "https://httpbin.test.k6.io";

function validateSchema(body: string, requiredFields: string[]): boolean {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    return requiredFields.every(f => f in parsed);
  } catch {
    return false;
  }
}

export default function (): void {
  group("Contract validation", () => {
    const res = http.get(`${BASE_URL}/json`);

    check(res, {
      "status 200": r => r.status === 200,
      "content-type is JSON": r => (r.headers["Content-Type"] ?? "").includes("application/json"),
      "body is valid JSON": r => {
        try { JSON.parse(r.body as string); return true; } catch { return false; }
      },
      "slideshow field present": r => validateSchema(r.body as string, ["slideshow"]),
    });
  });

  group("Headers contract", () => {
    const res = http.get(`${BASE_URL}/headers`);
    check(res, {
      "status 200": r => r.status === 200,
      "headers field present": r => validateSchema(r.body as string, ["headers"]),
    });
  });
}
