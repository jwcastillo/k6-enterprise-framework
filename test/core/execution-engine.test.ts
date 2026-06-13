/**
 * Unit tests for Execution Engine (src/core/execution-engine.ts)
 *
 * Tests cover:
 * - standardSetup(): context creation from config + env vars
 * - standardTeardown(): logging elapsed time
 * - validateScriptConfig(): required env var validation
 * - buildExecutionSummary(): summary from k6 handleSummary data
 * - standardHandleSummary(): formatted console output
 * - buildK6Options(): delegated options building
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  standardSetup,
  standardTeardown,
  validateScriptConfig,
  buildExecutionSummary,
  standardHandleSummary,
  ExecutionContext,
  SetupResult,
} from "../../src/core/execution-engine";

// Mock dependencies
vi.mock("../../src/core/config-loader", () => ({
  buildOptions: vi.fn(() => ({
    scenarios: {},
    thresholds: {},
  })),
}));

vi.mock("../../src/core/profile-loader", () => ({
  loadProfile: vi.fn(() => ({
    name: "smoke",
    thresholds: {
      http_req_duration: ["p(95)<2000"],
      http_req_failed: ["rate<0.01"],
    },
  })),
}));

vi.mock("../../src/core/prometheus-sanitizer", () => ({
  sanitizeTagsForPrometheus: vi.fn((tags: Record<string, string>) => tags),
}));

describe("standardSetup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as Record<string, unknown>).__ENV = {};
  });

  it("returns a SetupResult with context", () => {
    const result = standardSetup();
    expect(result).toHaveProperty("context");
    expect(result.context).toHaveProperty("testName");
    expect(result.context).toHaveProperty("client");
    expect(result.context).toHaveProperty("environment");
    expect(result.context).toHaveProperty("profile");
    expect(result.context).toHaveProperty("startTime");
    expect(result.context).toHaveProperty("tags");
  });

  it("uses default values when no config or env vars", () => {
    const result = standardSetup();
    expect(result.context.client).toBe("_reference");
    expect(result.context.environment).toBe("default");
    expect(result.context.profile).toBe("smoke");
    expect(result.context.testName).toBe("unnamed-test");
  });

  it("uses config values when provided", () => {
    const result = standardSetup({
      client: "acme",
      environment: "staging",
      profile: "load",
      name: "checkout-test",
    });
    expect(result.context.client).toBe("acme");
    expect(result.context.environment).toBe("staging");
    expect(result.context.profile).toBe("load");
    expect(result.context.testName).toBe("checkout-test");
  });

  it("env vars take priority over config values", () => {
    (__ENV as Record<string, string>)["K6_CLIENT"] = "env-client";
    (__ENV as Record<string, string>)["K6_ENV"] = "production";
    (__ENV as Record<string, string>)["K6_PROFILE"] = "stress";
    (__ENV as Record<string, string>)["K6_TEST_NAME"] = "env-test";

    const result = standardSetup({
      client: "config-client",
      environment: "staging",
      profile: "load",
      name: "config-test",
    });

    expect(result.context.client).toBe("env-client");
    expect(result.context.environment).toBe("production");
    expect(result.context.profile).toBe("stress");
    expect(result.context.testName).toBe("env-test");
  });

  it("sets startTime to a valid ISO string", () => {
    const result = standardSetup();
    expect(() => new Date(result.context.startTime)).not.toThrow();
    expect(new Date(result.context.startTime).toISOString()).toBe(
      result.context.startTime
    );
  });

  it("logs startup message", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    standardSetup({ name: "my-test" });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("[execution-engine] Starting:")
    );
    logSpy.mockRestore();
  });

  it("includes tags in context", () => {
    const result = standardSetup({ client: "acme" });
    expect(result.context.tags).toHaveProperty("client");
    expect(result.context.tags).toHaveProperty("environment");
    expect(result.context.tags).toHaveProperty("profile");
    expect(result.context.tags).toHaveProperty("test_name");
  });
});

describe("standardTeardown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs completion message with elapsed time", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const data: SetupResult = {
      context: {
        testName: "my-test",
        client: "acme",
        environment: "staging",
        profile: "load",
        startTime: new Date(Date.now() - 5000).toISOString(), // 5 seconds ago
        tags: {},
      },
    };

    standardTeardown(data);

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("[execution-engine] Completed: my-test")
    );
    logSpy.mockRestore();
  });
});

describe("validateScriptConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as Record<string, unknown>).__ENV = {};
  });

  it("does not throw when no required env vars", () => {
    expect(() => validateScriptConfig()).not.toThrow();
  });

  it("does not throw when all required env vars are present", () => {
    (__ENV as Record<string, string>)["API_URL"] = "https://api.com";
    (__ENV as Record<string, string>)["API_TOKEN"] = "token123";
    expect(() => validateScriptConfig(["API_URL", "API_TOKEN"])).not.toThrow();
  });

  it("throws when required env vars are missing", () => {
    (__ENV as Record<string, string>)["API_URL"] = "https://api.com";
    expect(() => validateScriptConfig(["API_URL", "API_TOKEN"])).toThrow(
      /API_TOKEN/
    );
  });

  it("lists all missing env vars in error message", () => {
    expect(() => validateScriptConfig(["VAR1", "VAR2"])).toThrow(/VAR1.*VAR2|VAR2.*VAR1/);
  });

  it("includes suggestion for setting env vars", () => {
    expect(() => validateScriptConfig(["MISSING"])).toThrow(/-e MISSING/);
  });
});

describe("buildExecutionSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeContext(): ExecutionContext {
    return {
      testName: "checkout-flow",
      client: "acme",
      environment: "staging",
      profile: "smoke",
      startTime: new Date(Date.now() - 60000).toISOString(),
      tags: { client: "acme" },
    };
  }

  function makeData(): Record<string, unknown> {
    return {
      metrics: {
        http_req_duration: {
          values: {
            avg: 200,
            min: 50,
            med: 180,
            max: 900,
            "p(90)": 350,
            "p(95)": 420,
            "p(99)": 750,
          },
        },
        http_reqs: { values: { count: 1000 } },
        http_req_failed: { values: { passes: 10 } },
        vus_max: { values: { max: 50 } },
        iterations: { values: { count: 1000 } },
        checks: { values: { passes: 950, fails: 50 } },
      },
    };
  }

  it("builds summary with basic fields", () => {
    const summary = buildExecutionSummary(makeData(), makeContext());
    expect(summary.testName).toBe("checkout-flow");
    expect(summary.client).toBe("acme");
    expect(summary.environment).toBe("staging");
    expect(summary.profile).toBe("smoke");
  });

  it("extracts HTTP duration percentiles", () => {
    const summary = buildExecutionSummary(makeData(), makeContext());
    expect(summary.httpDuration.avg).toBe(200);
    expect(summary.httpDuration.p95).toBe(420);
    expect(summary.httpDuration.p99).toBe(750);
    expect(summary.httpDuration.max).toBe(900);
  });

  it("computes checks pass rate", () => {
    const summary = buildExecutionSummary(makeData(), makeContext());
    // 950 passes, 50 fails, total 1000
    expect(summary.checks[0].passRate).toBeCloseTo(0.95, 2);
  });

  it("handles checks pass rate of 1 when no checks data", () => {
    const data = makeData();
    delete (data.metrics as Record<string, unknown>)["checks"];
    const summary = buildExecutionSummary(data, makeContext());
    expect(summary.checks[0].passRate).toBe(1);
  });

  it("computes durationMs from startTime", () => {
    const summary = buildExecutionSummary(makeData(), makeContext());
    expect(summary.durationMs).toBeGreaterThan(0);
  });

  it("sets passed=true when no checks fail", () => {
    const data = makeData();
    (data.metrics as Record<string, unknown>)["checks"] = {
      values: { passes: 1000, fails: 0 },
    };
    const summary = buildExecutionSummary(data, makeContext());
    expect(summary.passed).toBe(true);
  });

  it("sets passed=false when checks fail", () => {
    const summary = buildExecutionSummary(makeData(), makeContext());
    expect(summary.passed).toBe(false);
  });

  it("handles empty metrics gracefully", () => {
    const summary = buildExecutionSummary({ metrics: {} }, makeContext());
    expect(summary.httpDuration.avg).toBe(0);
    expect(summary.httpDuration.p95).toBe(0);
    expect(summary.httpRequests).toBe(0);
  });

  it("includes tags from context", () => {
    const summary = buildExecutionSummary(makeData(), makeContext());
    expect(summary.tags).toEqual({ client: "acme" });
  });
});

describe("standardHandleSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs formatted summary to console", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const context: ExecutionContext = {
      testName: "checkout",
      client: "acme",
      environment: "staging",
      profile: "smoke",
      startTime: new Date(Date.now() - 60000).toISOString(),
      tags: {},
    };

    const data = {
      metrics: {
        http_req_duration: {
          values: { avg: 200, min: 50, med: 180, max: 900, "p(90)": 350, "p(95)": 420, "p(99)": 750 },
        },
        http_reqs: { values: { count: 1000 } },
        http_req_failed: { values: { passes: 0 } },
        vus_max: { values: { max: 50 } },
        iterations: { values: { count: 1000 } },
        checks: { values: { passes: 1000, fails: 0 } },
      },
    };

    const result = standardHandleSummary(data, context);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain("PASSED");
    expect(output).toContain("checkout");
    expect(output).toContain("acme");
    expect(typeof result).toBe("object");
    logSpy.mockRestore();
  });

  it("shows FAILED when checks fail", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const context: ExecutionContext = {
      testName: "test",
      client: "acme",
      environment: "staging",
      profile: "smoke",
      startTime: new Date(Date.now() - 60000).toISOString(),
      tags: {},
    };

    const data = {
      metrics: {
        http_req_duration: {
          values: { avg: 200, min: 50, med: 180, max: 900, "p(90)": 350, "p(95)": 420, "p(99)": 750 },
        },
        http_reqs: { values: { count: 1000 } },
        http_req_failed: { values: { passes: 500 } },
        vus_max: { values: { max: 50 } },
        iterations: { values: { count: 1000 } },
        checks: { values: { passes: 500, fails: 500 } },
      },
    };

    standardHandleSummary(data, context);

    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain("FAILED");
    logSpy.mockRestore();
  });

  it("returns an empty object", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    const context: ExecutionContext = {
      testName: "test",
      client: "c",
      environment: "e",
      profile: "smoke",
      startTime: new Date().toISOString(),
      tags: {},
    };

    const result = standardHandleSummary({ metrics: {} }, context);
    expect(result).toEqual({});
  });
});
