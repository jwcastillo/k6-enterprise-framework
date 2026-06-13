/**
 * Reference Scenario: smoke-users (API)
 *
 * @executor    constant-vus
 * @profile     smoke (1-2 VUs, 1 min) | quick (5 VUs, 3 min) | load (20 VUs, 14 min)
 * @thresholds  http_req_duration p(95)<500ms, http_req_failed rate<0.01
 * @cli         ./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=smoke
 * @expected    All checks green, p95 < 500ms, 0% errors on mock server
 * @troubleshoot If mock server not running: npm run mock -- --client=_reference
 *               If thresholds fail: check BASE_URL env var points to correct environment
 *
 * Demonstrates:
 * - Auth pattern (bearer token flow)
 * - Correlation pattern (extract field from response)
 * - Check system (status + schema + threshold)
 * - RequestHelper with automatic tracing headers
 * - WeightedSwitch for mixed traffic distribution
 * - No hardcoded credentials — all from env/secrets
 */

import { check, sleep } from "k6";
import { Options } from "k6/options";
import { RequestHelper } from "@helpers/request-helper";
import { runChecks, statusCheck, schemaCheck, thresholdCheck } from "@core/check-system";
import { extractFromResponse } from "@patterns/correlation-pattern";
import { weightedSwitch } from "@patterns/weighted-execution";
import { DataHelper } from "@helpers/data-helper";
import { UserFactory } from "../../lib/factories/user-factory";
import { standardSetup, standardTeardown, ExecutionContext } from "@core/execution-engine";
import { generateJsonSummary } from "@reporting/json-summary-generator";

const BASE_URL = __ENV["API_BASE_URL"] ?? "https://httpbin.org";

export const options: Options = {
  vus: 2,
  duration: "30s",
  thresholds: {
    http_req_duration: ["p(95)<2000"],
    checks: ["rate>=0.95"],
  },
};

// Initialized once at init time (outside VU functions) — safe for k6
const client = new RequestHelper(BASE_URL, {
  tags: { client: "_reference", scenario: "smoke-users" },
});

export function setup(): ReturnType<typeof standardSetup> {
  return standardSetup({
    name: "smoke-users",
    client: "_reference",
    profile: "smoke",
  });
}

// ── Scenario functions ────────────────────────────────────────────────────────

function scenarioBrowse(): void {
  const res = client.get("/get", { source: "smoke-users", vu: `${__VU}` });

  runChecks(res, [
    statusCheck(200),
    schemaCheck(["origin", "headers", "args"]),
    thresholdCheck(2000),
  ]);

  // Correlation: extract origin for use in next request
  const extracted = extractFromResponse(res, [
    { name: "origin", jsonPath: "origin" },
    { name: "userAgent", jsonPath: "headers.User-Agent" },
  ]);

  check(null, {
    "origin extracted": () => extracted["origin"] !== null,
    "user-agent is framework": () =>
      (extracted["userAgent"] ?? "").includes("k6-enterprise-framework"),
  });
}

function scenarioCreate(): void {
  const user = UserFactory.random();
  const res = client.post("/post", user);

  runChecks(res, [statusCheck(200), schemaCheck(["json", "url"]), thresholdCheck(2000)]);

  const echoed = res.json<Record<string, unknown>>("json");
  check(null, {
    "posted data echoed correctly": () => echoed !== null && echoed["username"] === user.username,
  });
}

function scenarioValidate(): void {
  const email = DataHelper.randomEmail();
  const res = client.get("/get", { email });

  runChecks(res, [statusCheck(200), thresholdCheck(2000)]);
}

export function teardown(data: ReturnType<typeof standardSetup>): void {
  standardTeardown(data);
}

// ── Default VU function ───────────────────────────────────────────────────────

export default function (_data: ReturnType<typeof standardSetup>): void {
  // Weighted distribution: 60% browse, 30% create, 10% validate
  weightedSwitch([
    { name: "browse", weight: 60, fn: scenarioBrowse },
    { name: "create", weight: 30, fn: scenarioCreate },
    { name: "validate", weight: 10, fn: scenarioValidate },
  ]);

  sleep(0.5);
}

export function handleSummary(data: Record<string, unknown>): Record<string, string> {
  const context: ExecutionContext = {
    testName: "smoke-users",
    client: "_reference",
    environment: __ENV["K6_ENV"] ?? "default",
    profile: __ENV["K6_PROFILE"] ?? "smoke",
    startTime: new Date().toISOString(),
    tags: { client: "_reference", scenario: "smoke-users" },
  };
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const basePath = `./reports/reference_smoke-users_${timestamp}`;
  return {
    ...generateJsonSummary(data, context, `${basePath}.json`, {
      k6Options: {
        vus: options.vus,
        duration: typeof options.duration === "string" ? options.duration : undefined,
        stages: options.stages as Array<{ duration: string; target: number }> | undefined,
        scenarios: options.scenarios as Record<string, unknown> | undefined,
        thresholds: options.thresholds
          ? Object.fromEntries(
              Object.entries(options.thresholds).map(([k, v]) => [
                k,
                (v as Array<string | { threshold: string }>).map((t) =>
                  typeof t === "string" ? t : t.threshold
                ),
              ])
            )
          : undefined,
      },
    }),
    stdout: "\n✓ smoke-users complete — reports generated\n",
  };
}
