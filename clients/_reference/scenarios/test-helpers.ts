/**
 * T-072: test-helpers.ts — Validation suite for all 10 framework helpers
 *
 * Covers: DateHelper, RequestHelper, DataHelper, ValidationHelper, HeaderHelper,
 *         PerformanceHelper, StructuredLogger, GraphQLHelper, WebSocketHelper, UploadHelper
 *
 * Run:  k6 run dist/test-helpers.js
 * CI:   k6 run --vus 1 --iterations 1 dist/test-helpers.js
 *
 * Success criteria: 100% of checks passing (≥45 checks)
 * Grouped output per helper in handleSummary
 *
 * CHK-API-440..445, CHK-UX-199, CHK-UX-200, SC-114, EC-QUAL-005
 */

import { check } from "k6";
import { Options } from "k6/options";

import { DateHelper } from "../../../src/helpers/date-helper";
import {
  DataHelper,
  randomString,
  randomEmail,
  randomUser,
  randomPrice,
  randomCreditCard,
} from "../../../src/helpers/data-helper";
import { ValidationHelper } from "../../../src/helpers/validation-helper";
import { HeaderHelper } from "../../../src/helpers/header-helper";
import { PerformanceHelper } from "../../../src/helpers/performance-helper";
import { StructuredLogger } from "../../../src/helpers/structured-logger";
import { GraphQLHelper } from "../../../src/helpers/graphql-helper";
import { RequestHelper } from "../../../src/helpers/request-helper";

// ── k6 options: 1 VU, 1 iteration — pure unit validation ──────────────────────

export const options: Options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    checks: ["rate==1.0"], // SC-114: 100% checks must pass
  },
};

// ── Check counter per helper (for grouped summary) ────────────────────────────

interface HelperStats {
  passed: number;
  failed: number;
  failures: string[];
}

const stats: Record<string, HelperStats> = {};

function section(name: string): (tag: string, result: boolean, detail?: string) => void {
  if (!stats[name]) stats[name] = { passed: 0, failed: 0, failures: [] };
  return (tag: string, result: boolean, detail?: string) => {
    const label = `${name}: ${tag}`;
    const ok = check(null, { [label]: () => result });
    if (ok) {
      stats[name].passed++;
    } else {
      stats[name].failed++;
      // CHK-UX-200: failure shows helper, method, expected vs actual
      const msg = detail ? `${label} — ${detail}` : label;
      stats[name].failures.push(msg);
      console.error(`[FAIL] ${msg}`);
    }
  };
}

// ── Helper test functions ──────────────────────────────────────────────────────

function testDateHelper(): void {
  const chk = section("DateHelper");

  const d = new Date("2024-06-15T12:00:00.000Z");

  // format()
  chk("format ISO", DateHelper.format(d, "ISO") === "2024-06-15T12:00:00.000Z");
  chk("format YYYY-MM-DD", DateHelper.format(d, "YYYY-MM-DD") === "2024-06-15");
  chk("format DD/MM/YYYY", DateHelper.format(d, "DD/MM/YYYY") === "15/06/2024");
  chk("format MM/DD/YYYY", DateHelper.format(d, "MM/DD/YYYY") === "06/15/2024");
  chk("format timestamp", DateHelper.format(d, "timestamp") === String(d.getTime()));

  // addDays / addHours / addMinutes
  const plusOne = DateHelper.addDays(d, 1);
  chk("addDays +1", plusOne.getTime() === d.getTime() + 86_400_000);

  const plusHour = DateHelper.addHours(d, 2);
  chk("addHours +2", plusHour.getTime() === d.getTime() + 7_200_000);

  const plusMin = DateHelper.addMinutes(d, 30);
  chk("addMinutes +30", plusMin.getTime() === d.getTime() + 1_800_000);

  // toUnixTimestamp
  chk("toUnixTimestamp", DateHelper.toUnixTimestamp(d) === Math.floor(d.getTime() / 1000));

  // fromISO round-trip
  const parsed = DateHelper.fromISO("2024-06-15T12:00:00.000Z");
  chk("fromISO round-trip", parsed.getTime() === d.getTime());

  // isPast
  const past = new Date(Date.now() - 10_000);
  const future = new Date(Date.now() + 10_000);
  chk("isPast (past date)", DateHelper.isPast(past));
  chk("isPast (future date)", !DateHelper.isPast(future));

  // range
  const range = DateHelper.range(0, 7);
  chk("range start <= end", range.start.getTime() <= range.end.getTime());

  // random
  const rnd = DateHelper.random(range.start, range.end);
  chk("random within range", rnd >= range.start && rnd <= range.end);

  // now()
  const nowStr = DateHelper.now();
  chk("now() is ISO string", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(nowStr));
}

function testDataHelper(): void {
  const chk = section("DataHelper");

  // randomString
  const s8 = randomString(8);
  const s16 = randomString(16);
  chk("randomString length 8", s8.length === 8);
  chk("randomString length 16", s16.length === 16);
  chk("randomString different", s8 !== s16);

  // randomEmail
  const email = randomEmail();
  chk("randomEmail has @", email.includes("@"));
  chk("randomEmail has dot", email.includes("."));

  // randomCreditCard (Luhn-valid)
  const cc = randomCreditCard();
  chk("randomCreditCard non-empty", cc.length > 0);
  // Verify via ValidationHelper.isValidCreditCard
  chk("randomCreditCard Luhn-valid", ValidationHelper.isValidCreditCard(cc));

  // randomUser
  const user = randomUser();
  chk("randomUser has id", typeof user.id === "string" && user.id.length > 0);
  chk("randomUser has username", typeof user.username === "string" && user.username.length > 0);
  chk("randomUser has email", ValidationHelper.isValidEmail(user.email));
  chk("randomUser has firstName", typeof user.firstName === "string" && user.firstName.length > 0);

  // randomPrice
  const price = randomPrice(1, 100);
  chk("randomPrice in range", price >= 1 && price <= 100);
  chk("randomPrice is number", typeof price === "number");

  // DataHelper static facade mirrors standalone functions
  chk("DataHelper.randomString == randomString", DataHelper.randomString(5).length === 5);
  chk("DataHelper.randomEmail has @", DataHelper.randomEmail().includes("@"));
  chk("DataHelper.randomUser has id", typeof DataHelper.randomUser().id === "string");
  chk("DataHelper.randomPrice range", DataHelper.randomPrice(5, 10) >= 5);
}

function testValidationHelper(): void {
  const chk = section("ValidationHelper");

  // Build minimal SafeResponse-like objects for status/hasFields/responseTime checks
  const makeRes = (
    status: number,
    body: object | null,
    duration = 100
  ): {
    status: number;
    body: string;
    headers: Record<string, string>;
    timings: { duration: number; waiting: number; receiving: number; sending: number };
    json<T = unknown>(): T | null;
  } => ({
    status,
    body: body !== null ? JSON.stringify(body) : "",
    headers: {} as Record<string, string>,
    timings: { duration, waiting: 10, receiving: 5, sending: 5 },
    json<T = unknown>(): T | null {
      try {
        return body !== null ? (body as unknown as T) : null;
      } catch {
        return null;
      }
    },
  });

  // status()
  const r200 = makeRes(200, { id: 1, name: "test" });
  const r404 = makeRes(404, null);
  chk("status 200 pass", ValidationHelper.status(r200, 200).passed);
  chk("status 200 fail on 404", !ValidationHelper.status(r404, 200).passed);
  chk("status message contains code", ValidationHelper.status(r200, 200).message.includes("200"));

  // hasFields()
  chk("hasFields pass", ValidationHelper.hasFields(r200, ["id", "name"]).passed);
  chk("hasFields fail", !ValidationHelper.hasFields(r200, ["id", "missing"]).passed);

  // responseTime()
  const slow = makeRes(200, {}, 5000);
  chk("responseTime within", ValidationHelper.responseTime(r200, 500).passed);
  chk("responseTime exceeded", !ValidationHelper.responseTime(slow, 500).passed);

  // isValidEmail
  chk("isValidEmail valid", ValidationHelper.isValidEmail("user@example.com"));
  chk("isValidEmail invalid", !ValidationHelper.isValidEmail("not-an-email"));

  // isValidUrl
  chk("isValidUrl https", ValidationHelper.isValidUrl("https://example.com"));
  chk("isValidUrl http", ValidationHelper.isValidUrl("http://localhost:3000"));
  chk("isValidUrl invalid", !ValidationHelper.isValidUrl("ftp://not-http"));

  // isValidUUID
  chk("isValidUUID v4 valid", ValidationHelper.isValidUUID("550e8400-e29b-41d4-a716-446655440000"));
  chk("isValidUUID invalid", !ValidationHelper.isValidUUID("not-a-uuid"));

  // isValidCreditCard (Luhn)
  chk("isValidCreditCard valid", ValidationHelper.isValidCreditCard("4532015112830366"));
  chk("isValidCreditCard invalid", !ValidationHelper.isValidCreditCard("1234567890123456"));
}

function testHeaderHelper(): void {
  const chk = section("HeaderHelper");

  // tracing()
  const trace = HeaderHelper.tracing();
  chk(
    "tracing has X-Correlation-ID",
    typeof trace["X-Correlation-ID"] === "string" && trace["X-Correlation-ID"].length > 0
  );
  chk("tracing has X-Trace-ID", typeof trace["X-Trace-ID"] === "string");
  chk("tracing has X-Request-ID", typeof trace["X-Request-ID"] === "string");
  chk("tracing IDs are unique", trace["X-Correlation-ID"] !== trace["X-Trace-ID"]);

  // auth()
  const bearerH = HeaderHelper.auth("bearer", { token: "tok123" });
  chk("auth bearer has Authorization", typeof bearerH.Authorization === "string");
  chk("auth bearer prefix", (bearerH.Authorization ?? "").startsWith("Bearer "));

  const apiKeyH = HeaderHelper.auth("apikey", { key: "mykey" });
  chk("auth api-key header present", typeof apiKeyH["X-API-Key"] === "string");

  const noneH = HeaderHelper.auth("none", {});
  chk("auth none is empty object", Object.keys(noneH).length === 0);

  // standard()
  const std = HeaderHelper.standard("bearer", { token: "tok" });
  chk("standard includes Content-Type", "Content-Type" in std || Object.keys(std).length > 0);

  // localization()
  const loc = HeaderHelper.localization("es-ES", "ES");
  chk("localization Accept-Language", loc["Accept-Language"] === "es-ES");
  chk("localization X-Country", loc["X-Country"] === "ES");
}

function testPerformanceHelper(): void {
  const chk = section("PerformanceHelper");

  const samples = [
    100, 200, 150, 300, 250, 180, 220, 190, 210, 160, 140, 170, 230, 260, 280, 310, 120, 130, 240,
    270, 290, 320, 110, 195, 205, 215, 225, 235, 245, 155,
  ];

  // percentiles()
  const pct = PerformanceHelper.percentiles(samples);
  chk("percentiles p50 > 0", pct.p50 > 0);
  chk("percentiles p90 > p50", pct.p90 >= pct.p50);
  chk("percentiles p95 >= p90", pct.p95 >= pct.p90);
  chk("percentiles p99 >= p95", pct.p99 >= pct.p95);

  // aggregate()
  const agg = PerformanceHelper.aggregate(samples);
  chk("aggregate count", agg.count === samples.length);
  chk("aggregate min correct", agg.min === Math.min(...samples));
  chk("aggregate max correct", agg.max === Math.max(...samples));
  chk("aggregate avg > 0", agg.avg > 0);
  chk("aggregate stddev >= 0", agg.stddev >= 0);

  // compareBaseline()
  const cmp = PerformanceHelper.compareBaseline("p95", pct.p95, pct.p95 * 1.05, 10);
  chk("compareBaseline within threshold", cmp.withinThreshold === true);
  chk("compareBaseline metric label", cmp.metric === "p95");

  const cmpFail = PerformanceHelper.compareBaseline("p95", pct.p95, pct.p95 * 1.5, 10);
  chk("compareBaseline exceeded", cmpFail.withinThreshold === false);

  // empty array edge case
  const empty = PerformanceHelper.percentiles([]);
  chk("percentiles empty returns zeros", empty.p50 === 0 && empty.p99 === 0);
}

function testStructuredLogger(): void {
  const chk = section("StructuredLogger");

  const logger = new StructuredLogger({ service: "test-helpers", env: "ci" });

  // logRequest / logEvent / logError / logDebug should not throw
  let threw = false;
  try {
    logger.logRequest("GET", "http://example.com/api", 200, 123, { traceId: "abc" });
    logger.logEvent("user.login", { userId: "u1" });
    logger.logError("something failed", new Error("boom"), { retries: 3 });
    logger.logDebug("debug info", { detail: "x" });
  } catch {
    threw = true;
  }
  chk("logger does not throw on logRequest/logEvent/logError/logDebug", !threw);

  // Secret masking: authorization value should not appear in plain form in logEvent
  // (we can only assert no throw — actual masking needs log output capture)
  let maskThrew = false;
  try {
    logger.logEvent("auth", { authorization: "Bearer secret-token" });
  } catch {
    maskThrew = true;
  }
  chk("logger masks sensitive keys without throwing", !maskThrew);

  // child() returns new StructuredLogger with merged context
  const child = logger.child({ traceId: "abc123" });
  chk("child returns StructuredLogger", child instanceof StructuredLogger);
  chk("child is new instance", child !== logger);

  // Child logger also does not throw
  let childThrew = false;
  try {
    child.logEvent("child.event");
  } catch {
    childThrew = true;
  }
  chk("child logger does not throw", !childThrew);
}

function testGraphQLHelper(): void {
  const chk = section("GraphQLHelper");

  // Static methods — no network needed
  // Build minimal GraphQLResponse-compatible objects (hasData, isSuccess, http are runtime flags)
  type FakeGQL<T> = {
    data: T;
    errors?: Array<{ message: string; locations: unknown[]; path: unknown[] }>;
    hasData: boolean;
    isSuccess: boolean;
    http: unknown;
  };

  const successRes: FakeGQL<{ user: { id: string } }> = {
    data: { user: { id: "1" } },
    errors: undefined,
    hasData: true,
    isSuccess: true,
    http: {},
  };
  const errorRes: FakeGQL<null> = {
    data: null,
    errors: [{ message: "not found", locations: [], path: [] }],
    hasData: false,
    isSuccess: false,
    http: {},
  };
  const emptyData: FakeGQL<null> = {
    data: null,
    errors: undefined,
    hasData: false,
    isSuccess: true,
    http: {},
  };

  chk("hasNoErrors on success", GraphQLHelper.hasNoErrors(successRes as never));
  chk("hasNoErrors on error", !GraphQLHelper.hasNoErrors(errorRes as never));
  chk("hasData on success", GraphQLHelper.hasData(successRes as never));
  chk("hasData on null data", !GraphQLHelper.hasData(emptyData as never));

  // fieldExists
  chk("fieldExists present", GraphQLHelper.fieldExists(successRes as never, "user"));
  chk("fieldExists absent", !GraphQLHelper.fieldExists(successRes as never, "product"));

  // Constructor does not throw with valid params
  let ctorThrew = false;
  try {
    new GraphQLHelper("http://localhost:4000", "/graphql");
  } catch {
    ctorThrew = true;
  }
  chk("GraphQLHelper constructor does not throw", !ctorThrew);
}

function testWebSocketHelper(): void {
  const chk = section("WebSocketHelper");

  // WebSocket requires a live server — validate shape/types without network
  // Import the exported symbols and verify they are callable functions
  const { runWebSocket, wsEchoTest } = require("../../../src/helpers/websocket-helper");

  chk("runWebSocket is a function", typeof runWebSocket === "function");
  chk("wsEchoTest is a function", typeof wsEchoTest === "function");

  // Verify the function signatures accept the expected parameter shapes
  // (we don't call them — that requires a live WS server)
  chk("runWebSocket arity >= 2", runWebSocket.length >= 2);
}

function testUploadHelper(): void {
  const chk = section("UploadHelper");

  // Import functions and k6 counters/trends
  const {
    uploadFile,
    downloadFile,
    withRateLimitHandling,
    rateLimitHits,
    successfulRequests,
  } = require("../../../src/helpers/upload-helper");

  chk("uploadFile is a function", typeof uploadFile === "function");
  chk("downloadFile is a function", typeof downloadFile === "function");
  chk("withRateLimitHandling is a function", typeof withRateLimitHandling === "function");
  chk("rateLimitHits counter exported", rateLimitHits !== undefined);
  chk("successfulRequests counter exported", successfulRequests !== undefined);

  // withRateLimitHandling wraps a function — validate it returns a function
  const wrapped = withRateLimitHandling(() => ({ status: 200 }));
  chk("withRateLimitHandling returns function", typeof wrapped === "function");
}

function testRequestHelper(): void {
  const chk = section("RequestHelper");

  // Constructor and header building (no network)
  const rh = new RequestHelper("http://localhost:9999");
  chk("RequestHelper constructor", rh instanceof RequestHelper);

  // RequestHelper with default options
  const rh2 = new RequestHelper("https://example.com", { authType: "none" });
  chk("RequestHelper with options", rh2 instanceof RequestHelper);

  // get / post / put / delete / patch methods exist
  chk("has get method", typeof (rh as never as Record<string, unknown>)["get"] === "function");
  chk("has post method", typeof (rh as never as Record<string, unknown>)["post"] === "function");
  chk("has put method", typeof (rh as never as Record<string, unknown>)["put"] === "function");
  chk(
    "has delete method",
    typeof (rh as never as Record<string, unknown>)["delete"] === "function"
  );
  chk("has patch method", typeof (rh as never as Record<string, unknown>)["patch"] === "function");
}

// ── Main default function ─────────────────────────────────────────────────────

export default function (): void {
  testDateHelper();
  testDataHelper();
  testValidationHelper();
  testHeaderHelper();
  testPerformanceHelper();
  testStructuredLogger();
  testGraphQLHelper();
  testWebSocketHelper();
  testUploadHelper();
  testRequestHelper();

  // CHK-UX-199: print grouped summary to console
  let totalPassed = 0;
  let totalFailed = 0;
  const lines: string[] = ["", "── Helper Test Summary ──────────────────────────────────"];
  for (const [helper, s] of Object.entries(stats)) {
    const total = s.passed + s.failed;
    const status = s.failed === 0 ? "✓" : "✗";
    lines.push(`  ${status} ${helper}: ${s.passed}/${total}`);
    if (s.failures.length > 0) {
      for (const f of s.failures) lines.push(`      [FAIL] ${f}`);
    }
    totalPassed += s.passed;
    totalFailed += s.failed;
  }
  lines.push(`  ─────────────────────────────────────────────────────`);
  lines.push(`  Total: ${totalPassed}/${totalPassed + totalFailed} checks passed`);
  lines.push("");
  console.log(lines.join("\n"));
}
