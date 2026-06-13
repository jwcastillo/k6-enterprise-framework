import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  weightedSelect,
  weightedSwitch,
  validateWeights,
  WeightedScenario,
} from "../../src/patterns/weighted-execution";

describe("weighted-execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  // ── weightedSelect ──────────────────────────────────────────────────────

  describe("weightedSelect", () => {
    it("throws when scenarios array is empty", () => {
      expect(() => weightedSelect([])).toThrow(
        "weightedSelect: scenarios array must not be empty"
      );
    });

    it("throws when total weight is <= 0", () => {
      expect(() =>
        weightedSelect([
          { name: "a", weight: 0, fn: () => {} },
          { name: "b", weight: 0, fn: () => {} },
        ])
      ).toThrow("weightedSelect: total weight must be > 0");
    });

    it("returns the only scenario when there is one", () => {
      const scenario: WeightedScenario = { name: "only", weight: 1, fn: () => {} };
      const result = weightedSelect([scenario]);
      expect(result).toBe(scenario);
    });

    it("selects first scenario when random is very low", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.0);
      const scenarios: WeightedScenario[] = [
        { name: "a", weight: 50, fn: () => {} },
        { name: "b", weight: 50, fn: () => {} },
      ];

      const result = weightedSelect(scenarios);
      expect(result.name).toBe("a");
    });

    it("selects second scenario when random exceeds first weight", () => {
      // Total weight = 100, random = 0.6 → random*100 = 60
      // After subtracting weight of "a" (30): 60-30=30 > 0, continue
      // After subtracting weight of "b" (70): 30-70=-40 <= 0, select "b"
      vi.spyOn(Math, "random").mockReturnValue(0.6);
      const scenarios: WeightedScenario[] = [
        { name: "a", weight: 30, fn: () => {} },
        { name: "b", weight: 70, fn: () => {} },
      ];

      const result = weightedSelect(scenarios);
      expect(result.name).toBe("b");
    });

    it("selects last scenario as fallback for floating point edge cases", () => {
      // Force Math.random to return 1.0 (or close) — fallback triggers
      vi.spyOn(Math, "random").mockReturnValue(0.9999999999);
      const scenarios: WeightedScenario[] = [
        { name: "a", weight: 50, fn: () => {} },
        { name: "b", weight: 50, fn: () => {} },
      ];

      const result = weightedSelect(scenarios);
      // Should return last scenario as fallback
      expect(result.name).toBe("b");
    });

    it("handles non-100 total weights (relative weights)", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.0);
      const scenarios: WeightedScenario[] = [
        { name: "a", weight: 3, fn: () => {} },
        { name: "b", weight: 7, fn: () => {} },
      ];

      // random = 0.0, total = 10, 0*10=0, 0-3=-3<=0 → selects "a"
      const result = weightedSelect(scenarios);
      expect(result.name).toBe("a");
    });

    it("respects weight distribution over many iterations", () => {
      const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
      const scenarios: WeightedScenario[] = [
        { name: "a", weight: 60, fn: () => {} },
        { name: "b", weight: 30, fn: () => {} },
        { name: "c", weight: 10, fn: () => {} },
      ];

      vi.spyOn(Math, "random").mockRestore();
      const iterations = 10000;
      for (let i = 0; i < iterations; i++) {
        const selected = weightedSelect(scenarios);
        counts[selected.name]++;
      }

      // Allow 5% tolerance
      expect(counts.a / iterations).toBeCloseTo(0.6, 1);
      expect(counts.b / iterations).toBeCloseTo(0.3, 1);
      expect(counts.c / iterations).toBeCloseTo(0.1, 1);
    });

    it("works with generic type parameter", () => {
      const scenarios: WeightedScenario<string>[] = [
        { name: "a", weight: 1, fn: "result-a" },
        { name: "b", weight: 1, fn: "result-b" },
      ];

      vi.spyOn(Math, "random").mockReturnValue(0.0);
      const result = weightedSelect(scenarios);
      expect(result.fn).toBe("result-a");
    });
  });

  // ── weightedSwitch ──────────────────────────────────────────────────────

  describe("weightedSwitch", () => {
    it("calls the selected scenario function", () => {
      const fnA = vi.fn();
      const fnB = vi.fn();

      vi.spyOn(Math, "random").mockReturnValue(0.0);
      weightedSwitch([
        { name: "a", weight: 50, fn: fnA },
        { name: "b", weight: 50, fn: fnB },
      ]);

      expect(fnA).toHaveBeenCalledTimes(1);
      expect(fnB).not.toHaveBeenCalled();
    });

    it("calls the second scenario when selected", () => {
      const fnA = vi.fn();
      const fnB = vi.fn();

      vi.spyOn(Math, "random").mockReturnValue(0.9);
      weightedSwitch([
        { name: "a", weight: 50, fn: fnA },
        { name: "b", weight: 50, fn: fnB },
      ]);

      expect(fnA).not.toHaveBeenCalled();
      expect(fnB).toHaveBeenCalledTimes(1);
    });
  });

  // ── validateWeights ──────────────────────────────────────────────────────

  describe("validateWeights", () => {
    it("passes with valid weights", () => {
      expect(() =>
        validateWeights([
          { name: "a", weight: 60, fn: () => {} },
          { name: "b", weight: 40, fn: () => {} },
        ])
      ).not.toThrow();
    });

    it("throws when scenarios array is empty", () => {
      expect(() => validateWeights([])).toThrow(
        "weightedExecution: no scenarios defined"
      );
    });

    it("throws when a scenario has weight <= 0", () => {
      expect(() =>
        validateWeights([
          { name: "good", weight: 50, fn: () => {} },
          { name: "bad", weight: 0, fn: () => {} },
        ])
      ).toThrow(
        "weightedExecution: scenario 'bad' has invalid weight 0 (must be > 0)"
      );
    });

    it("throws for negative weights", () => {
      expect(() =>
        validateWeights([{ name: "negative", weight: -5, fn: () => {} }])
      ).toThrow(
        "weightedExecution: scenario 'negative' has invalid weight -5 (must be > 0)"
      );
    });
  });
});
