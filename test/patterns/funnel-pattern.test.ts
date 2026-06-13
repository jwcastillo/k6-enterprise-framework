import { describe, it, expect, vi, beforeEach } from "vitest";
import { group, sleep } from "k6";

// Override the Counter mock from setup.ts with a class-based one
vi.mock("k6/metrics", () => {
  class MockCounter {
    name: string;
    add = vi.fn();
    constructor(name: string) {
      this.name = name;
    }
  }
  return {
    Counter: MockCounter,
    Trend: vi.fn().mockImplementation(() => ({ add: vi.fn() })),
    Rate: vi.fn().mockImplementation(() => ({ add: vi.fn() })),
    Gauge: vi.fn().mockImplementation(() => ({ add: vi.fn() })),
  };
});

import { initFunnelMetrics, runFunnel, FunnelConfig } from "../../src/patterns/funnel-pattern";

describe("funnel-pattern", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Helper to create a funnel config
  function makeConfig<T extends Record<string, unknown>>(
    overrides: Partial<FunnelConfig<T>> = {}
  ): FunnelConfig<T> {
    return {
      name: "test",
      steps: [],
      initialContext: () => ({}) as T,
      ...overrides,
    };
  }

  // ── initFunnelMetrics ──────────────────────────────────────────────────

  describe("initFunnelMetrics", () => {
    it("creates Counter metrics for each step (entered + completed)", () => {
      const config = makeConfig({
        steps: [
          { name: "step_a", fn: () => true },
          { name: "step_b", fn: () => true },
        ],
      });

      // initFunnelMetrics should not throw — it registers counters
      expect(() => initFunnelMetrics(config)).not.toThrow();
    });

    it("does not throw on repeated calls (idempotent)", () => {
      const config = makeConfig({
        steps: [{ name: "step_x", fn: () => true }],
      });

      initFunnelMetrics(config);
      // Second call should also succeed without error
      expect(() => initFunnelMetrics(config)).not.toThrow();
    });
  });

  // ── runFunnel ──────────────────────────────────────────────────────────

  describe("runFunnel", () => {
    it("executes all steps and returns completed=true when all pass", () => {
      const config = makeConfig({
        steps: [
          { name: "step_a", fn: () => true },
          { name: "step_b", fn: () => true },
        ],
      });

      initFunnelMetrics(config);
      const result = runFunnel(config);

      expect(result.completed).toBe(true);
      expect(result.stepsEntered).toBe(2);
      expect(result.stepsCompleted).toBe(2);
      expect(result.dropOffStep).toBeNull();
    });

    it("treats undefined/void return as success", () => {
      const config = makeConfig({
        steps: [{ name: "step_void", fn: () => {} }],
      });

      initFunnelMetrics(config);
      const result = runFunnel(config);

      expect(result.completed).toBe(true);
      expect(result.stepsCompleted).toBe(1);
    });

    it("stops at failing step (returns false)", () => {
      const fnC = vi.fn(() => true);

      const config = makeConfig({
        steps: [
          { name: "step_a", fn: () => true },
          { name: "step_b", fn: () => false },
          { name: "step_c", fn: fnC },
        ],
      });

      initFunnelMetrics(config);
      const result = runFunnel(config);

      expect(result.completed).toBe(false);
      expect(result.stepsEntered).toBe(2);
      expect(result.stepsCompleted).toBe(1);
      expect(result.dropOffStep).toBe("step_b");
      expect(fnC).not.toHaveBeenCalled();
    });

    it("stops at throwing step", () => {
      const config = makeConfig({
        steps: [
          { name: "step_a", fn: () => true },
          {
            name: "step_b",
            fn: () => {
              throw new Error("step failed");
            },
          },
          { name: "step_c", fn: () => true },
        ],
      });

      initFunnelMetrics(config);
      const result = runFunnel(config);

      expect(result.completed).toBe(false);
      expect(result.stepsEntered).toBe(2);
      expect(result.stepsCompleted).toBe(1);
      expect(result.dropOffStep).toBe("step_b");
    });

    it("continues on failure when continueOnFailure=true", () => {
      const fnC = vi.fn(() => true);

      const config = makeConfig({
        steps: [
          { name: "step_a", fn: () => true },
          { name: "step_b", fn: () => false },
          { name: "step_c", fn: fnC },
        ],
        continueOnFailure: true,
      });

      initFunnelMetrics(config);
      const result = runFunnel(config);

      expect(result.completed).toBe(false); // not all steps passed
      expect(result.stepsEntered).toBe(3);
      expect(result.stepsCompleted).toBe(2); // step_a and step_c
      expect(result.dropOffStep).toBe("step_b");
      expect(fnC).toHaveBeenCalledTimes(1);
    });

    it("calls group() for each step", () => {
      const config = makeConfig({
        steps: [
          { name: "step_a", fn: () => true },
          { name: "step_b", fn: () => true },
        ],
      });

      initFunnelMetrics(config);
      runFunnel(config);

      expect(group).toHaveBeenCalledWith("step_a", expect.any(Function));
      expect(group).toHaveBeenCalledWith("step_b", expect.any(Function));
    });

    it("sleeps for thinkTime after each step", () => {
      const config = makeConfig({
        steps: [
          { name: "step_a", fn: () => true, thinkTime: 2 },
          { name: "step_b", fn: () => true, thinkTime: 3 },
        ],
      });

      initFunnelMetrics(config);
      runFunnel(config);

      expect(sleep).toHaveBeenCalledWith(2);
      expect(sleep).toHaveBeenCalledWith(3);
    });

    it("does not sleep when thinkTime is 0 or undefined", () => {
      const config = makeConfig({
        steps: [
          { name: "step_a", fn: () => true, thinkTime: 0 },
          { name: "step_b", fn: () => true },
        ],
      });

      initFunnelMetrics(config);
      runFunnel(config);

      expect(sleep).not.toHaveBeenCalled();
    });

    it("passes shared context to step functions", () => {
      interface TestCtx extends Record<string, unknown> {
        orderId: string | null;
      }

      const config: FunnelConfig<TestCtx> = {
        name: "ctx_test",
        initialContext: () => ({ orderId: null }),
        steps: [
          {
            name: "create_order",
            fn: (ctx) => {
              ctx.orderId = "ORD-123";
              return true;
            },
          },
          {
            name: "verify_order",
            fn: (ctx) => {
              expect(ctx.orderId).toBe("ORD-123");
              return true;
            },
          },
        ],
      };

      initFunnelMetrics(config);
      const result = runFunnel(config);
      expect(result.completed).toBe(true);
    });

    it("calls initialContext for fresh context each time", () => {
      const contextFactory = vi.fn(() => ({ count: 0 }));
      const config = makeConfig({
        steps: [{ name: "step_a", fn: () => true }],
        initialContext: contextFactory,
      });

      initFunnelMetrics(config);
      runFunnel(config);
      runFunnel(config);

      expect(contextFactory).toHaveBeenCalledTimes(2);
    });

    it("returns correct result for empty steps", () => {
      const config = makeConfig({ steps: [] });
      initFunnelMetrics(config);
      const result = runFunnel(config);

      expect(result.completed).toBe(true); // 0 steps = 0/0 = all passed
      expect(result.stepsEntered).toBe(0);
      expect(result.stepsCompleted).toBe(0);
      expect(result.dropOffStep).toBeNull();
    });
  });
});
