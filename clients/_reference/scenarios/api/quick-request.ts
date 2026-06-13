/**
 * quick-request — Generic HTTP request from environment variables.
 *
 * Executes any HTTP method against any URL without creating a service client.
 * Ideal for CI pipelines, quick validations, and ad-hoc testing.
 *
 * Environment variables:
 *   REQUEST_URL             (required) Full URL, e.g. http://api.example.com/api/v1/orders
 *   REQUEST_METHOD          (optional) GET|POST|PUT|PATCH|DELETE  [default: GET]
 *   REQUEST_BODY            (optional) JSON string body for POST/PUT/PATCH
 *   REQUEST_BODY_FILE       (optional) Path to .json or .jsonl file (k6 open())
 *   REQUEST_HEADERS         (optional) JSON string of extra headers, e.g. '{"X-Api-Key":"abc"}'
 *   REQUEST_AUTH_TYPE       (optional) none|bearer|basic|apikey  [default: none]
 *   REQUEST_AUTH_TOKEN      (optional) Bearer token
 *   REQUEST_AUTH_USER       (optional) Basic auth username
 *   REQUEST_AUTH_PASS       (optional) Basic auth password
 *   REQUEST_ITERATIONS      (optional) Total iterations  [default: 1, or line count for JSONL]
 *   REQUEST_VUS             (optional) Virtual users     [default: 1]
 *   REQUEST_EXPECTED_STATUS (optional) Expected status: "200", "201", "200-299"  [default: 200]
 *
 * @cli k6 run dist/reference/api/quick-request.js -e REQUEST_URL=https://httpbin.org/get
 * @cli k6 run dist/reference/api/quick-request.js -e REQUEST_URL=http://api/orders -e REQUEST_METHOD=POST -e REQUEST_BODY='{"id":"1"}'
 * @cli ./bin/run-test.sh --client=_reference --scenario=api/quick-request -e REQUEST_URL=$URL
 */

import { sleep } from "k6";
import { Options } from "k6/options";
import { RequestHelper } from "@helpers/request-helper";
import { SafeResponse } from "@types-k6/safe-response";
import { runChecks, statusCheck, statusRangeCheck, thresholdCheck } from "@core/check-system";
import { AuthType } from "@types-k6/config.d";

// ── Init: parse environment variables ───────────────────────────────────────

const REQUEST_URL = __ENV["REQUEST_URL"];
if (!REQUEST_URL) {
  throw new Error("REQUEST_URL is required. Usage: k6 run ... -e REQUEST_URL=http://...");
}

const METHOD = (__ENV["REQUEST_METHOD"] || "GET").toUpperCase();
const AUTH_TYPE = (__ENV["REQUEST_AUTH_TYPE"] || "none") as AuthType;

// Parse extra headers
let extraHeaders: Record<string, string> = {};
if (__ENV["REQUEST_HEADERS"]) {
  extraHeaders = JSON.parse(__ENV["REQUEST_HEADERS"]);
}

// Auth credentials
const credentials: Record<string, string> = {};
if (AUTH_TYPE === "bearer" && __ENV["REQUEST_AUTH_TOKEN"]) {
  credentials.token = __ENV["REQUEST_AUTH_TOKEN"];
} else if (AUTH_TYPE === "basic") {
  credentials.username = __ENV["REQUEST_AUTH_USER"] || "";
  credentials.password = __ENV["REQUEST_AUTH_PASS"] || "";
} else if (AUTH_TYPE === "apikey") {
  credentials.apiKey = __ENV["REQUEST_AUTH_TOKEN"] || "";
}

// Parse expected status (single number or range like "200-299")
let expectedStatusLow = 200;
let expectedStatusHigh = 200;
if (__ENV["REQUEST_EXPECTED_STATUS"]) {
  const parts = __ENV["REQUEST_EXPECTED_STATUS"].split("-");
  expectedStatusLow = parseInt(parts[0], 10);
  expectedStatusHigh = parts.length > 1 ? parseInt(parts[1], 10) : expectedStatusLow;
}

// ── Load body (from env var or file) ────────────────────────────────────────

const bodies: (string | null)[] = [];

if (__ENV["REQUEST_BODY"]) {
  bodies.push(__ENV["REQUEST_BODY"]);
} else if (__ENV["REQUEST_BODY_FILE"]) {
  const raw = open(__ENV["REQUEST_BODY_FILE"]).trim();
  const isJsonl = __ENV["REQUEST_BODY_FILE"].endsWith(".jsonl");

  if (isJsonl) {
    // JSONL: one JSON per line → one iteration per line
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length > 0) bodies.push(trimmed);
    }
  } else if (raw.startsWith("[")) {
    // JSON array → one iteration per element
    const arr = JSON.parse(raw) as unknown[];
    for (const item of arr) bodies.push(JSON.stringify(item));
  } else {
    // Single JSON object
    bodies.push(raw);
  }
}

// If no body, push null (for GET requests)
if (bodies.length === 0) bodies.push(null);

// ── k6 options ──────────────────────────────────────────────────────────────

const vus = parseInt(__ENV["REQUEST_VUS"] || "1", 10);
const iterations = parseInt(__ENV["REQUEST_ITERATIONS"] || String(bodies.length), 10);

export const options: Options = {
  vus,
  iterations,
  thresholds: {
    http_req_failed: ["rate<0.10"],
    checks: ["rate>0.90"],
  },
};

// Extract base URL (protocol + host) and path from full URL
// k6 (goja) does not have the URL constructor — parse manually
const urlMatch = REQUEST_URL.match(/^(https?:\/\/[^/]+)(\/.*)?$/);
if (!urlMatch) {
  throw new Error(`Invalid REQUEST_URL: ${REQUEST_URL}. Must start with http:// or https://`);
}
const baseUrl = urlMatch[1];
const requestPath = urlMatch[2] || "/";

const client = new RequestHelper(baseUrl, {
  authType: AUTH_TYPE,
  credentials,
  extraHeaders,
  tags: { scenario: "quick-request", method: METHOD },
});

console.log(`[quick-request] ${METHOD} ${REQUEST_URL}`);
console.log(`[quick-request] VUs: ${vus}, Iterations: ${iterations}, Bodies: ${bodies.length}`);
if (AUTH_TYPE !== "none") console.log(`[quick-request] Auth: ${AUTH_TYPE}`);

// ── Execution ───────────────────────────────────────────────────────────────

function executeRequest(body: string | null): SafeResponse {
  switch (METHOD) {
    case "POST":
      return client.post(requestPath, body ? JSON.parse(body) : {});
    case "PUT":
      return client.put(requestPath, body ? JSON.parse(body) : {});
    case "PATCH":
      return client.patch(requestPath, body ? JSON.parse(body) : {});
    case "DELETE":
      return client.delete(requestPath);
    default:
      return client.get(requestPath);
  }
}

export default function (): void {
  // Cycle through bodies if iterations > bodies.length
  const bodyIndex = __ITER % bodies.length;
  const body = bodies[bodyIndex];

  const res = executeRequest(body);

  // Status check: single value or range
  const statusChecks =
    expectedStatusLow === expectedStatusHigh
      ? [statusCheck(expectedStatusLow)]
      : [statusRangeCheck(expectedStatusLow, expectedStatusHigh)];

  runChecks(res, [...statusChecks, thresholdCheck(30000)]);

  const ok = res.status >= expectedStatusLow && res.status <= expectedStatusHigh;

  if (ok) {
    if (__ITER < 10 || __ITER % 100 === 0) {
      console.log(
        `[${__ITER + 1}/${iterations}] ${res.status} ${METHOD} ${requestPath} (${res.timings.duration}ms)`
      );
    }
  } else {
    const preview = res.body.length > 200 ? res.body.substring(0, 200) + "..." : res.body;
    console.error(
      `[${__ITER + 1}/${iterations}] FAIL ${res.status} ${METHOD} ${requestPath} | ${preview}`
    );
  }

  sleep(0.1);
}
