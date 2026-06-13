/**
 * COV-03 — bin/compare-results.js spawn-based tests (D-08, D-09, D-10).
 *
 * Asserts the exit-code contract and dual-format input handling:
 *   - schemaVersion framework format
 *   - native k6 --summary-export format
 *   - missing-metric resilience
 *   - threshold-based regression detection
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(ROOT, "bin/compare-results.js");
const FIX = path.join(ROOT, "test/fixtures/compare-results");

function run(args: string[]): { code: number | null; stdout: string; stderr: string } {
  const r = spawnSync("node", [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: "utf-8",
    timeout: 20000,
  });
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

describe("bin/compare-results.js (COV-03)", () => {
  it("exits 0 when no metric exceeds the default 10% threshold", () => {
    const { code, stdout } = run([
      `--baseline=${FIX}/baseline-pass.json`,
      `--current=${FIX}/current-pass.json`,
    ]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/No degradation/i);
  });

  it("exits 1 when at least one metric degrades beyond threshold", () => {
    const { code, stdout } = run([
      `--baseline=${FIX}/baseline-regress.json`,
      `--current=${FIX}/current-regress.json`,
    ]);
    expect(code).toBe(1);
    expect(stdout).toMatch(/degraded beyond/i);
  });

  it("accepts a custom threshold via --threshold=", () => {
    // With a 50% threshold the 30% regression no longer trips
    const { code } = run([
      `--baseline=${FIX}/baseline-regress.json`,
      `--current=${FIX}/current-regress.json`,
      "--threshold=50",
    ]);
    expect(code).toBe(0);
  });

  it("handles missing metrics gracefully (current lacks a baseline metric)", () => {
    const { code, stdout, stderr } = run([
      `--baseline=${FIX}/baseline-missing-metric.json`,
      `--current=${FIX}/current-missing-metric.json`,
    ]);
    // Script should not crash; exit 0 or 1 depending on retained metrics
    expect([0, 1]).toContain(code);
    expect(stderr).not.toMatch(/Cannot read|TypeError|SyntaxError/);
    // Output mentions the retained common metric
    expect(stdout).toMatch(/http_req_duration/);
  });

  it("parses the k6 native --summary-export shape (top-level metrics)", () => {
    const { code, stdout, stderr } = run([
      `--baseline=${FIX}/baseline-native-k6.json`,
      `--current=${FIX}/current-native-k6.json`,
    ]);
    expect([0, 1]).toContain(code);
    expect(stderr).not.toMatch(/Cannot read|TypeError|SyntaxError/);
    expect(stdout).toMatch(/http_req_duration/);
  });

  it("emits --help and exits 0", () => {
    const { code, stdout } = run(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/baseline.*current/i);
  });

  it("exits 1 when --baseline or --current is missing", () => {
    const { code, stderr } = run([`--current=${FIX}/current-pass.json`]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/baseline.*current.*required/i);
  });

  it("exits 1 when a fixture file does not exist", () => {
    const { code, stderr } = run([
      `--baseline=${FIX}/does-not-exist.json`,
      `--current=${FIX}/current-pass.json`,
    ]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/Cannot read/i);
  });
});
