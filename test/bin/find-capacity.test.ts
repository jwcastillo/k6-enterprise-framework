/**
 * Capacity search — step evaluation and the ramp → binary → confirm algorithm.
 *
 * Ported from the LATAM framework (bin/testing/find-capacity.js).
 * runStep is faked here: no k6, no network.
 */

import { describe, it, expect } from "vitest";

const { evaluateSummary, search, usesProfileOptions, scenarioSourcePath } = require("../../bin/find-capacity.js");

const summaryAt = (iterations: number, extra: Record<string, unknown> = {}) => ({
  metrics: {
    iterations: { count: iterations },
    ...extra,
  },
});

const step = { rps: 100, durationSeconds: 30, minAchievedRatio: 0.95, exitCode: 0 };

describe("evaluateSummary", () => {
  it("passes when the rate was achieved and no threshold was crossed", () => {
    expect(evaluateSummary(summaryAt(3000), step)).toEqual([]);
  });

  it("fails on a crossed threshold", () => {
    const summary = summaryAt(3000, {
      http_req_duration: { "p(95)": 900, thresholds: { "p(95)<500": true } },
    });
    expect(evaluateSummary(summary, step)[0]).toContain("threshold crossed");
  });

  it("fails when the generator dropped iterations", () => {
    const summary = summaryAt(3000, { dropped_iterations: { count: 12 } });
    expect(evaluateSummary(summary, step)[0]).toContain("12 dropped iterations");
  });

  it("fails when the achieved rate is below the requested one", () => {
    // 2400 iterations / 30s = 80/s, under 95% of 100/s
    expect(evaluateSummary(summaryAt(2400), step)[0]).toContain("below 95% of requested 100/s");
  });

  it("reports exit 99 even when the summary shows no crossed threshold", () => {
    expect(evaluateSummary(summaryAt(3000), { ...step, exitCode: 99 })).toEqual([
      "run exited 99 (thresholds or gate failed)",
    ]);
  });
});

describe("search", () => {
  /** A target that sustains up to `ceiling` rps and fails above it. */
  const targetWithCeiling = (ceiling: number, calls: number[] = []) => (rps: number) => {
    calls.push(rps);
    return Promise.resolve({ passed: rps <= ceiling, reasons: rps <= ceiling ? [] : ["over ceiling"], summaryPath: null });
  };

  const base = { startRps: 10, maxRps: 1000, resolutionRps: 5, retries: 0, confirmRuns: 1 };

  it("lands within the resolution of the real ceiling", async () => {
    const result = await search({ ...base, runStep: targetWithCeiling(137) });
    expect(result.highestSustainableRps).toBeLessThanOrEqual(137);
    expect(result.highestSustainableRps).toBeGreaterThan(137 - base.resolutionRps - 1);
    expect(result.firstFailingRps).toBeGreaterThan(137);
    expect(result.confirmed).toBe(true);
  });

  it("ramps exponentially before searching", async () => {
    const calls: number[] = [];
    await search({ ...base, runStep: targetWithCeiling(137, calls) });
    expect(calls.slice(0, 5)).toEqual([10, 20, 40, 80, 160]);
  });

  it("stops at maxRps when nothing fails", async () => {
    const result = await search({ ...base, maxRps: 80, runStep: targetWithCeiling(10_000) });
    expect(result.highestSustainableRps).toBe(80);
    expect(result.firstFailingRps).toBeNull();
  });

  it("returns 0 when even the starting rate fails", async () => {
    const result = await search({ ...base, runStep: targetWithCeiling(0) });
    expect(result.highestSustainableRps).toBe(0);
    expect(result.firstFailingRps).toBe(10);
  });

  it("retries a failed rate before giving up on it", async () => {
    let firstAttempt = true;
    const flaky = (rps: number) => {
      // 20 rps fails once, then behaves
      const fails = rps > 40 || (rps === 20 && firstAttempt);
      if (rps === 20) firstAttempt = false;
      return Promise.resolve({ passed: !fails, reasons: fails ? ["flake"] : [], summaryPath: null });
    };
    const result = await search({ ...base, retries: 1, runStep: flaky });
    expect(result.highestSustainableRps).toBeGreaterThan(20);
  });

  it("steps down when the confirmation runs fail", async () => {
    let confirmed = 0;
    // Passes the search, then fails the first confirmation at its ceiling
    const runStep = (rps: number) => {
      const passing = rps <= 40;
      if (passing && rps === 40) confirmed++;
      return Promise.resolve({
        passed: passing && !(rps === 40 && confirmed > 1),
        reasons: [],
        summaryPath: null,
      });
    };
    const result = await search({ ...base, confirmRuns: 2, runStep });
    expect(result.highestSustainableRps).toBeLessThan(40);
  });

  it("records every step with its phase", async () => {
    const result = await search({ ...base, runStep: targetWithCeiling(137) });
    expect(new Set(result.steps.map((s: { phase: string }) => s.phase))).toEqual(
      new Set(["ramp", "binary", "confirm"])
    );
  });

  it("waits between steps but not before the first", async () => {
    let waits = 0;
    const result = await search({ ...base, runStep: targetWithCeiling(137), wait: async () => { waits++; } });
    expect(waits).toBe(result.steps.length - 1);
  });
});

describe("usesProfileOptions", () => {
  it("accepts a scenario that builds its options from the profile", () => {
    expect(usesProfileOptions("export const options = buildOptions();")).toBe(true);
    expect(usesProfileOptions("export const options = buildK6Options({});")).toBe(true);
    expect(usesProfileOptions("const o = profileToOptions('load');")).toBe(true);
  });

  it("rejects a scenario with hardcoded options — every step would run the same load", () => {
    expect(usesProfileOptions('export const options = { vus: 5, duration: "20s" };')).toBe(false);
  });

  it("does not match the word in prose or an import alone", () => {
    expect(usesProfileOptions("// buildOptions is the recommended way")).toBe(false);
  });
});

describe("scenarioSourcePath", () => {
  it("resolves a scenario under the client's scenarios directory", () => {
    expect(scenarioSourcePath("my-team", "api/checkout")).toMatch(
      /clients\/my-team\/scenarios\/api\/checkout\.ts$/
    );
  });

  it("keeps an explicit extension", () => {
    expect(scenarioSourcePath("my-team", "api/checkout.ts")).toMatch(/checkout\.ts$/);
    expect(scenarioSourcePath("my-team", "api/checkout.js")).toMatch(/checkout\.js$/);
  });
});
