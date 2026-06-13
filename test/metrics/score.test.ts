/**
 * Unit tests for scoreFromCounts (T-262).
 *
 * Covers: grade boundaries (A/B/C/D/F), scorable===0 → 100/A/true,
 * healthy flag at the 90 boundary, half-weight warn math.
 */

import { describe, it, expect } from "vitest";
import { scoreFromCounts } from "../../src/metrics/score";

describe("scoreFromCounts", () => {
  // ── Empty / zero counts ───────────────────────────────────────────────────

  it("returns 100/A/true when all counts are zero (empty report)", () => {
    const result = scoreFromCounts({ pass: 0, warn: 0, fail: 0 });
    expect(result).toEqual({ value: 100, grade: "A", healthy: true });
  });

  it("returns 100/A/true when only pass counts exist (scorable > 0, all pass)", () => {
    const result = scoreFromCounts({ pass: 10, warn: 0, fail: 0 });
    expect(result).toEqual({ value: 100, grade: "A", healthy: true });
  });

  // ── Grade A boundary (>= 90) ──────────────────────────────────────────────

  it("grade A at exactly 90 (healthy boundary)", () => {
    // 9 pass + 0 warn + 1 fail → (9 * 1.0 + 0) / 10 * 100 = 90
    const result = scoreFromCounts({ pass: 9, warn: 0, fail: 1 });
    expect(result.value).toBe(90);
    expect(result.grade).toBe("A");
    expect(result.healthy).toBe(true);
  });

  it("grade A at 100", () => {
    const result = scoreFromCounts({ pass: 5, warn: 0, fail: 0 });
    expect(result.value).toBe(100);
    expect(result.grade).toBe("A");
    expect(result.healthy).toBe(true);
  });

  // ── Grade B boundary (>= 80) ──────────────────────────────────────────────

  it("grade B at exactly 80", () => {
    // 8 pass + 0 warn + 2 fail → 80/100 = 80
    const result = scoreFromCounts({ pass: 8, warn: 0, fail: 2 });
    expect(result.value).toBe(80);
    expect(result.grade).toBe("B");
    expect(result.healthy).toBe(false);
  });

  it("grade B at 89 (just below A)", () => {
    // 89 pass + 0 warn + 11 fail → round(89/100*100) = 89
    const result = scoreFromCounts({ pass: 89, warn: 0, fail: 11 });
    expect(result.value).toBe(89);
    expect(result.grade).toBe("B");
    expect(result.healthy).toBe(false);
  });

  // ── Grade C boundary (>= 70) ──────────────────────────────────────────────

  it("grade C at exactly 70", () => {
    // 7 pass + 0 warn + 3 fail → 70
    const result = scoreFromCounts({ pass: 7, warn: 0, fail: 3 });
    expect(result.value).toBe(70);
    expect(result.grade).toBe("C");
    expect(result.healthy).toBe(false);
  });

  it("grade C at 79 (just below B)", () => {
    // 79 pass + 0 warn + 21 fail → 79
    const result = scoreFromCounts({ pass: 79, warn: 0, fail: 21 });
    expect(result.value).toBe(79);
    expect(result.grade).toBe("C");
    expect(result.healthy).toBe(false);
  });

  // ── Grade D boundary (>= 60) ──────────────────────────────────────────────

  it("grade D at exactly 60", () => {
    // 6 pass + 0 warn + 4 fail → 60
    const result = scoreFromCounts({ pass: 6, warn: 0, fail: 4 });
    expect(result.value).toBe(60);
    expect(result.grade).toBe("D");
    expect(result.healthy).toBe(false);
  });

  it("grade D at 69 (just below C)", () => {
    // 69 pass + 0 warn + 31 fail → 69
    const result = scoreFromCounts({ pass: 69, warn: 0, fail: 31 });
    expect(result.value).toBe(69);
    expect(result.grade).toBe("D");
    expect(result.healthy).toBe(false);
  });

  // ── Grade F boundary (< 60) ───────────────────────────────────────────────

  it("grade F at 59 (just below D)", () => {
    // 59 pass + 0 warn + 41 fail → 59
    const result = scoreFromCounts({ pass: 59, warn: 0, fail: 41 });
    expect(result.value).toBe(59);
    expect(result.grade).toBe("F");
    expect(result.healthy).toBe(false);
  });

  it("grade F at 0 (all fail)", () => {
    const result = scoreFromCounts({ pass: 0, warn: 0, fail: 10 });
    expect(result.value).toBe(0);
    expect(result.grade).toBe("F");
    expect(result.healthy).toBe(false);
  });

  // ── Healthy flag boundary ─────────────────────────────────────────────────

  it("healthy is true at exactly 90", () => {
    const result = scoreFromCounts({ pass: 9, warn: 0, fail: 1 });
    expect(result.healthy).toBe(true);
  });

  it("healthy is false at 89", () => {
    const result = scoreFromCounts({ pass: 89, warn: 0, fail: 11 });
    expect(result.healthy).toBe(false);
  });

  // ── Warn half-weight math ─────────────────────────────────────────────────

  it("half-weight warn: {pass:1, warn:1, fail:0} → value=75, grade=C", () => {
    // scorable = 2, numerator = 1*1.0 + 1*0.5 = 1.5 → 1.5/2*100 = 75
    const result = scoreFromCounts({ pass: 1, warn: 1, fail: 0 });
    expect(result.value).toBe(75);
    expect(result.grade).toBe("C");
    expect(result.healthy).toBe(false);
  });

  it("half-weight warn: {pass:0, warn:10, fail:0} → value=50, grade=F", () => {
    // scorable = 10, numerator = 0 + 10*0.5 = 5 → 5/10*100 = 50
    const result = scoreFromCounts({ pass: 0, warn: 10, fail: 0 });
    expect(result.value).toBe(50);
    expect(result.grade).toBe("F");
    expect(result.healthy).toBe(false);
  });

  it("mixed: {pass:8, warn:2, fail:2} → rounds correctly", () => {
    // scorable = 12, numerator = 8 + 1 = 9 → round(9/12*100) = round(75) = 75
    const result = scoreFromCounts({ pass: 8, warn: 2, fail: 2 });
    expect(result.value).toBe(75);
    expect(result.grade).toBe("C");
  });
});
