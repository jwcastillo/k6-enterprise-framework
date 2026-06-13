/**
 * Phase 6 / DX-06 — csv-generator unit tests.
 *
 * Pure function: known k6 summary → known CSV body. Direct row assertions
 * (snapshot would be over-broad for a 1-table CSV).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { generateCsv } from "../../../src/reporting/artifacts/csv-generator";
import type { K6Summary } from "../../../src/reporting/artifacts/types";

function loadFixture(): K6Summary {
  const raw = readFileSync(join(__dirname, "__fixtures__/k6-summary-small.json"), "utf8");
  return JSON.parse(raw) as K6Summary;
}

describe("generateCsv", () => {
  it("returns a CSV string with a header row first", () => {
    const csv = generateCsv(loadFixture());
    const lines = csv.split("\n");
    expect(lines[0]).toBe("metric,type,count,rate,avg,min,med,max,p90,p95,p99");
  });

  it("contains one row per metric in the input", () => {
    const csv = generateCsv(loadFixture());
    const lines = csv.trim().split("\n");
    // 1 header + 9 metrics in the fixture
    expect(lines).toHaveLength(10);
  });

  it("formats numeric fields with the legacy precision (3 decimals)", () => {
    const csv = generateCsv(loadFixture());
    const durRow = csv.split("\n").find((l) => l.startsWith("http_req_duration,"));
    expect(durRow).toBeDefined();
    // avg=150.5 → "150.500", p(95)=500 → "500.000", etc.
    expect(durRow).toContain("150.500");
    expect(durRow).toContain("500.000");
    expect(durRow).toContain("1200.000");
  });

  it("emits empty fields when the source metric lacks a value", () => {
    const csv = generateCsv(loadFixture());
    // http_reqs is a counter (no avg/min/med/max/percentiles)
    const reqsRow = csv.split("\n").find((l) => l.startsWith("http_reqs,"));
    expect(reqsRow).toBeDefined();
    // Format: name,type,count,rate,avg,min,med,max,p90,p95,p99
    // Should have count=5000, rate=100.0000, rest empty
    expect(reqsRow).toMatch(/^http_reqs,counter,5000,100\.0000,,,,,,,$/);
  });

  it("terminates with a trailing newline (POSIX text-file convention)", () => {
    const csv = generateCsv(loadFixture());
    expect(csv.endsWith("\n")).toBe(true);
  });

  it("returns just the header when metrics are absent", () => {
    const csv = generateCsv({});
    expect(csv).toBe("metric,type,count,rate,avg,min,med,max,p90,p95,p99\n");
  });

  it("is deterministic across invocations", () => {
    const a = generateCsv(loadFixture());
    const b = generateCsv(loadFixture());
    expect(a).toBe(b);
  });
});
