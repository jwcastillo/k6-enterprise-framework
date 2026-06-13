/** T-007: Sistema de checks generico (status, schema, content, threshold) */

import { check } from "k6";
import { SafeResponse } from "@types-k6/safe-response";
import { captureUnexpectedResponse, CaptureContext } from "./error-capture";

export type CheckType = "status" | "schema" | "content" | "threshold" | "custom";

export interface CheckSpec {
  name: string;
  type: CheckType;
  fn: (response: SafeResponse) => boolean;
  /** Status codes considered acceptable for this spec (used for error capture). */
  expectedStatus?: number | number[];
}

export interface CheckSummary {
  name: string;
  type: CheckType;
  passed: boolean;
  expected?: string;
  actual?: string;
}

/** Registry of custom checks from product-specific layers */
const customChecks = new Map<string, (response: SafeResponse) => boolean>();

/** Register a custom check from the product-specific layer */
export function registerCheck(name: string, fn: (response: SafeResponse) => boolean): void {
  if (customChecks.has(name)) {
    throw new Error(
      `CheckSystem: check '${name}' already registered. Use a unique name to avoid conflicts.`
    );
  }
  customChecks.set(name, fn);
}

/** ── Built-in check factories ── */

/** Status code check */
export function statusCheck(expected: number): CheckSpec {
  return {
    name: `status is ${expected}`,
    type: "status",
    fn: (res) => res.status === expected,
    expectedStatus: expected,
  };
}

/** Status in range (e.g. 2xx) */
export function statusRangeCheck(min: number, max: number): CheckSpec {
  const range: number[] = [];
  for (let s = min; s <= max; s++) range.push(s);
  return {
    name: `status in ${min}-${max}`,
    type: "status",
    fn: (res) => res.status >= min && res.status <= max,
    expectedStatus: range,
  };
}

/** JSON field presence check */
export function schemaCheck(fields: string[]): CheckSpec {
  return {
    name: `body has fields: ${fields.join(", ")}`,
    type: "schema",
    fn: (res): boolean => {
      const body = res.json<Record<string, unknown>>();
      if (!body || typeof body !== "object") return false;
      return fields.every((f) => f in body);
    },
  };
}

/** Body content match check */
export function contentCheck(substring: string): CheckSpec {
  return {
    name: `body contains '${substring}'`,
    type: "content",
    fn: (res) => res.body.includes(substring),
  };
}

/** Response time threshold check */
export function thresholdCheck(maxMs: number): CheckSpec {
  return {
    name: `response time < ${maxMs}ms`,
    type: "threshold",
    fn: (res) => res.timings.duration < maxMs,
  };
}

/** Look up and apply a registered custom check */
export function customCheck(name: string): CheckSpec {
  const fn = customChecks.get(name);
  if (!fn) {
    throw new Error(
      `CheckSystem: custom check '${name}' not registered. Call registerCheck() first.`
    );
  }
  return { name, type: "custom", fn };
}

/**
 * Run a set of checks against a response using k6's native check() function.
 * Checks are fail-open (failures don't stop the test).
 * Returns true if ALL checks passed.
 *
 * If a status-type spec fails, the response body, trackId and status are
 * captured via captureUnexpectedResponse so that handleSummary() can persist
 * them. Pass `ctx` to enrich the captured entry with module/service/scenario.
 */
export function runChecks(
  response: SafeResponse,
  specs: CheckSpec[],
  ctx: CaptureContext = {}
): boolean {
  const checkMap: Record<string, (r: SafeResponse) => boolean> = {};
  for (const spec of specs) {
    checkMap[spec.name] = spec.fn;
  }
  const allPassed = check(response, checkMap);
  if (!allPassed) {
    for (const spec of specs) {
      if (spec.type === "status" && spec.expectedStatus !== undefined && !spec.fn(response)) {
        captureUnexpectedResponse(response, { ...ctx, expectedStatus: spec.expectedStatus });
        break;
      }
    }
  }
  return allPassed;
}

/**
 * Run checks and return individual results for detailed reporting.
 */
export function runChecksDetailed(
  response: SafeResponse,
  specs: CheckSpec[],
  ctx: CaptureContext = {}
): CheckSummary[] {
  return specs.map((spec) => {
    let passed = false;
    try {
      passed = spec.fn(response);
    } catch {
      passed = false;
    }
    // Still register with k6 check() for metrics
    check(response, { [spec.name]: () => passed });
    if (!passed && spec.type === "status" && spec.expectedStatus !== undefined) {
      captureUnexpectedResponse(response, { ...ctx, expectedStatus: spec.expectedStatus });
    }
    return { name: spec.name, type: spec.type, passed };
  });
}
