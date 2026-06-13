/**
 * Phase 6 / DX-06 — summary-builder unit tests.
 *
 * Pure function: known input (small k6 summary fixture) → known output.
 * No fs, no snapshot — direct field assertions keep regressions explicit.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { buildSummary } from "../../../src/reporting/artifacts/summary-builder";
import type { K6Summary } from "../../../src/reporting/artifacts/types";

function loadFixture(): K6Summary {
  const raw = readFileSync(join(__dirname, "__fixtures__/k6-summary-small.json"), "utf8");
  return JSON.parse(raw) as K6Summary;
}

describe("buildSummary", () => {
  it("aggregates checks pass/fail/total/rate", () => {
    const built = buildSummary(loadFixture());
    expect(built.checks.pass).toBe(4990);
    expect(built.checks.fail).toBe(10);
    expect(built.checks.total).toBe(5000);
    expect(built.checks.rate).toBeCloseTo(99.8, 1);
  });

  it("extracts latency percentiles from http_req_duration", () => {
    const built = buildSummary(loadFixture());
    expect(built.latency.avgMs).toBeCloseTo(150.5, 3);
    expect(built.latency.minMs).toBe(20);
    expect(built.latency.p50Ms).toBe(120);
    expect(built.latency.p90Ms).toBe(350);
    expect(built.latency.p95Ms).toBe(500);
    expect(built.latency.p99Ms).toBe(1200);
    expect(built.latency.maxMs).toBe(3000);
  });

  it("converts http_req_failed value (fraction) to percent", () => {
    const built = buildSummary(loadFixture());
    expect(built.errorRatePct).toBeCloseTo(0.2, 4);
  });

  it("exposes maxVus + http.totalRequests + http.ratePerSec", () => {
    const built = buildSummary(loadFixture());
    expect(built.maxVus).toBe(50);
    expect(built.http.totalRequests).toBe(5000);
    expect(built.http.ratePerSec).toBe(100.0);
  });

  it("returns iterations count", () => {
    const built = buildSummary(loadFixture());
    expect(built.iterations).toBe(1000);
  });

  it("computes APDEX with label + color", () => {
    const built = buildSummary(loadFixture());
    // p50=120 (<500 → 0.5), p90=350 (<500 → 0.4) → satisfied = 0.9
    // p99=1200 (in [500, 2000) → 0.09 tolerating)
    // score = 0.9 + 0.09/2 = 0.945 → "Excellent" (>= 0.94)
    expect(built.apdex.score).toBeCloseTo(0.95, 2);
    expect(built.apdex.label).toBe("Excellent");
    expect(built.apdex.color).toBe("#16a34a");
  });

  it("downgrades APDEX label when latency degrades", () => {
    const fixture = loadFixture();
    // Push p90 above APDEX T to drop into the tolerating zone, lowering the score.
    fixture.metrics!["http_req_duration"]!["p(90)"] = 800;
    const built = buildSummary(fixture);
    // satisfied 0.5 (p50<500) + tolerating 0.4 (p90 in [500,2000)) + 0.09 (p99 in zone)
    // score = 0.5 + (0.4 + 0.09)/2 = 0.745 → "Fair"
    expect(built.apdex.label).toBe("Fair");
  });

  it("evaluates SLA against framework defaults (all pass on fixture)", () => {
    const built = buildSummary(loadFixture());
    expect(built.sla.p95Ok).toBe(true); // 500 < 2000
    expect(built.sla.p99Ok).toBe(true); // 1200 < 5000
    expect(built.sla.errorRateOk).toBe(true); // 0.2% < 1%
    expect(built.sla.checksOk).toBe(true); // 99.8% >= 95%
    expect(built.sla.pass).toBe(true);
    expect(built.sla.violations).toEqual([]);
  });

  it("flips SLA when p95 exceeds threshold", () => {
    const fixture = loadFixture();
    fixture.metrics!["http_req_duration"]!["p(95)"] = 2500;
    const built = buildSummary(fixture);
    expect(built.sla.p95Ok).toBe(false);
    expect(built.sla.pass).toBe(false);
    expect(built.sla.violations[0]).toContain("p95");
  });

  it("handles a missing metrics object without throwing", () => {
    const built = buildSummary({});
    expect(built.checks.total).toBe(0);
    expect(built.latency.avgMs).toBeNull();
    expect(built.errorRatePct).toBeNull();
    expect(built.apdex.score).toBeNull();
    expect(built.apdex.label).toBe("N/A");
  });

  it("is a pure function — calling twice returns equal results", () => {
    const a = buildSummary(loadFixture());
    const b = buildSummary(loadFixture());
    expect(a).toEqual(b);
  });
});
