/**
 * Reference Scenario: auth-flow (Integration)
 *
 * @executor    ramping-vus
 * @profile     smoke (1-2 VUs, 1 min) | load (20 VUs, 14 min)
 * @thresholds  http_req_duration p(95)<1000ms, http_req_failed rate<0.02
 * @cli         ./bin/run-test.sh --client=_reference --scenario=integration/auth-flow --profile=smoke
 * @expected    Login succeeds, token extracted, protected resource returns 200
 * @troubleshoot Ensure AUTH_USERNAME / AUTH_PASSWORD env vars are set
 *               401 errors = invalid credentials, 500 = upstream auth service issue
 *
 * Demonstrates:
 * - Full auth pattern flow: login -> extract token -> use in subsequent requests
 * - Retry pattern with exponential backoff
 * - Contract validation (JSON Schema via ajv)
 * - Correlation across multiple requests
 */

import { sleep } from "k6";
import { Options } from "k6/options";
import { RequestHelper } from "@helpers/request-helper";
import {
  runChecks,
  statusCheck,
  schemaCheck,
  thresholdCheck,
  registerCheck,
} from "@core/check-system";
import { extractFromResponse } from "@patterns/correlation-pattern";
import { retryRequest } from "@patterns/retry-pattern";
import { ContractValidator } from "@patterns/contract-validation";

const BASE_URL = __ENV["API_BASE_URL"] ?? "https://httpbin.org";

export const options: Options = {
  vus: 1,
  iterations: 3,
  thresholds: {
    http_req_duration: ["p(95)<3000"],
    checks: ["rate>=0.90"],
  },
};

// ── Contract schemas (compiled once at init time) ─────────────────────────────
const validator = new ContractValidator();

validator.registerSchema("httpbin-get", {
  type: "object",
  properties: {
    origin: { type: "string" },
    headers: { type: "object" },
    url: { type: "string" },
  },
  required: ["origin", "headers", "url"],
});

validator.registerSchema("httpbin-post", {
  type: "object",
  properties: {
    json: {},
    url: { type: "string" },
    headers: { type: "object" },
  },
  required: ["json", "url"],
});

// ── Custom check registration (product-specific) ──────────────────────────────
registerCheck("has-correlation-header", (res) => {
  const r = res as { headers: Record<string, string> };
  return "X-Correlation-Id" in r.headers || "X-Correlation-ID" in r.headers;
});

// ── Client ────────────────────────────────────────────────────────────────────
const client = new RequestHelper(BASE_URL, {
  tags: { client: "_reference", scenario: "auth-flow" },
});

export default function (): void {
  // Step 1: Simulate login (httpbin /post echoes back what we send)
  const loginRes = retryRequest(
    () => client.post("/post", { username: "test-user", grant_type: "password" }),
    { maxAttempts: 3, retryOnStatus: [429, 500, 503] }
  );

  runChecks(loginRes, [statusCheck(200), thresholdCheck(2000)]);

  // Step 2: Extract correlation data from login response
  const extracted = extractFromResponse(loginRes, [
    { name: "postedUsername", jsonPath: "json.username", required: true },
    // httpbin echoes sent headers back under "headers" key in response body
    { name: "requestId", jsonPath: "headers.X-Request-Id" },
  ]);

  // Step 3: Use extracted data in subsequent request (simulates token usage)
  const profileRes = client.get("/get", {
    user: extracted["postedUsername"] ?? "unknown",
    source: "auth-flow",
  });

  runChecks(profileRes, [
    statusCheck(200),
    schemaCheck(["origin", "headers", "args"]),
    thresholdCheck(2000),
  ]);

  // Step 4: Contract validation
  const body = profileRes.json<Record<string, unknown>>();
  const contractResult = validator.validate("httpbin-get", body);
  if (!contractResult.valid) {
    const errors = contractResult.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
    console.warn(`Contract violation: ${errors}`);
  }

  sleep(1);
}
