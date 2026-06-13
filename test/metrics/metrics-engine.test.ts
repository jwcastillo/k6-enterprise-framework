import { describe, it, expect, vi, beforeEach } from "vitest";
import { MetricsEngine, buildMetricsInput } from "../../src/metrics/metrics-engine";
import type {
  MetricsCalculator,
  MetricsEngineInput,
  MetricResult,
  MetricCategory,
  MetricStatus,
} from "../../src/metrics/types";

// Mock calculator factory
function createMockCalculator(
  category: MetricCategory,
  results: MetricResult[]
): MetricsCalculator {
  return {
    category,
    calculate: vi.fn(() => results),
  };
}

function createMetricResult(overrides: Partial<MetricResult> = {}): MetricResult {
  return {
    id: overrides.id ?? "TEST-001",
    name: overrides.name ?? "Test Metric",
    category: overrides.category ?? "performance",
    value: overrides.value ?? 100,
    unit: overrides.unit ?? "ms",
    status: overrides.status ?? "pass",
    description: overrides.description ?? "Test metric description",
    source: overrides.source ?? "k6",
    ...overrides,
  };
}

function createInput(overrides: Partial<MetricsEngineInput> = {}): MetricsEngineInput {
  return {
    k6Metrics: overrides.k6Metrics ?? {},
    durationMs: overrides.durationMs ?? 60000,
    vusMax: overrides.vusMax ?? 10,
    context: overrides.context ?? {
      client: "test-client",
      environment: "test",
      profile: "smoke",
      testName: "test-scenario",
      startTime: new Date().toISOString(),
    },
    ...overrides,
  };
}

describe("MetricsEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── register ──────────────────────────────────────────────────────────────

  describe("register", () => {
    it("returns this for chaining", () => {
      const engine = new MetricsEngine();
      const calc = createMockCalculator("performance", []);
      const result = engine.register(calc);
      expect(result).toBe(engine);
    });

    it("accepts multiple calculators", () => {
      const engine = new MetricsEngine();
      engine
        .register(createMockCalculator("performance", []))
        .register(createMockCalculator("throughput", []))
        .register(createMockCalculator("error", []));
      // Just verify no error is thrown; calculate will test behavior
    });
  });

  // ── calculate ─────────────────────────────────────────────────────────────

  describe("calculate", () => {
    it("runs all registered calculators and returns report", () => {
      const engine = new MetricsEngine();
      const perfResult = createMetricResult({
        id: "PERF-001",
        category: "performance",
        status: "pass",
      });
      const errResult = createMetricResult({
        id: "ERR-001",
        category: "error",
        status: "fail",
      });

      engine.register(createMockCalculator("performance", [perfResult]));
      engine.register(createMockCalculator("error", [errResult]));

      const report = engine.calculate(createInput());

      expect(report.all).toHaveLength(2);
      expect(report.summary.total).toBe(2);
      expect(report.summary.pass).toBe(1);
      expect(report.summary.fail).toBe(1);
      expect(report.summary.warn).toBe(0);
      expect(report.summary.na).toBe(0);
    });

    it("groups results by category", () => {
      const engine = new MetricsEngine();
      engine.register(
        createMockCalculator("performance", [
          createMetricResult({ id: "PERF-001", category: "performance" }),
          createMetricResult({ id: "PERF-002", category: "performance" }),
        ])
      );
      engine.register(
        createMockCalculator("error", [createMetricResult({ id: "ERR-001", category: "error" })])
      );

      const report = engine.calculate(createInput());

      expect(report.byCategory.performance).toHaveLength(2);
      expect(report.byCategory.error).toHaveLength(1);
      expect(report.byCategory.throughput).toBeUndefined();
    });

    it("filters by domain when specified", () => {
      const engine = new MetricsEngine();
      const perfCalc = createMockCalculator("performance", [
        createMetricResult({ category: "performance" }),
      ]);
      const errCalc = createMockCalculator("error", [createMetricResult({ category: "error" })]);

      engine.register(perfCalc);
      engine.register(errCalc);

      const report = engine.calculate(createInput(), ["performance"]);

      expect(report.all).toHaveLength(1);
      expect(report.all[0].category).toBe("performance");
      expect(perfCalc.calculate).toHaveBeenCalled();
      expect(errCalc.calculate).not.toHaveBeenCalled();
    });

    it("runs all when domains is empty array", () => {
      const engine = new MetricsEngine();
      engine.register(
        createMockCalculator("performance", [createMetricResult({ category: "performance" })])
      );
      engine.register(createMockCalculator("error", [createMetricResult({ category: "error" })]));

      const report = engine.calculate(createInput(), []);

      expect(report.all).toHaveLength(2);
    });

    it("handles calculator that throws an error", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const engine = new MetricsEngine();

      const badCalc: MetricsCalculator = {
        category: "error",
        calculate: vi.fn(() => {
          throw new Error("Calculator crash");
        }),
      };
      const goodCalc = createMockCalculator("performance", [
        createMetricResult({ category: "performance" }),
      ]);

      engine.register(badCalc);
      engine.register(goodCalc);

      const report = engine.calculate(createInput());

      // Good calculator results should still be present
      expect(report.all).toHaveLength(1);
      expect(report.all[0].category).toBe("performance");
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Calculator 'error' threw"));
      warnSpy.mockRestore();
    });

    it("returns empty report when no calculators registered", () => {
      const engine = new MetricsEngine();
      const report = engine.calculate(createInput());
      expect(report.all).toHaveLength(0);
      expect(report.summary).toEqual({
        total: 0,
        pass: 0,
        warn: 0,
        fail: 0,
        na: 0,
      });
    });

    it("includes generatedAt timestamp", () => {
      const engine = new MetricsEngine();
      const report = engine.calculate(createInput());
      expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("includes durationMs from input", () => {
      const engine = new MetricsEngine();
      const report = engine.calculate(createInput({ durationMs: 120000 }));
      expect(report.durationMs).toBe(120000);
    });

    it("counts all statuses correctly", () => {
      const engine = new MetricsEngine();
      engine.register(
        createMockCalculator("performance", [
          createMetricResult({ status: "pass" }),
          createMetricResult({ status: "warn" }),
          createMetricResult({ status: "fail" }),
          createMetricResult({ status: "na" }),
          createMetricResult({ status: "pass" }),
        ])
      );

      const report = engine.calculate(createInput());
      expect(report.summary).toEqual({
        total: 5,
        pass: 2,
        warn: 1,
        fail: 1,
        na: 1,
      });
    });
  });

  // ── parseDomainsArg ───────────────────────────────────────────────────────

  describe("parseDomainsArg", () => {
    it("returns undefined for empty string", () => {
      expect(MetricsEngine.parseDomainsArg("")).toBeUndefined();
    });

    it("returns undefined for 'all'", () => {
      expect(MetricsEngine.parseDomainsArg("all")).toBeUndefined();
    });

    it("returns undefined for undefined", () => {
      expect(MetricsEngine.parseDomainsArg(undefined)).toBeUndefined();
    });

    it("parses comma-separated valid domains", () => {
      const result = MetricsEngine.parseDomainsArg("performance,error,sla");
      expect(result).toEqual(["performance", "error", "sla"]);
    });

    it("drops unknown domain names silently", () => {
      const result = MetricsEngine.parseDomainsArg("performance,invalid,error");
      expect(result).toEqual(["performance", "error"]);
    });

    it("returns undefined when all domains are invalid", () => {
      expect(MetricsEngine.parseDomainsArg("invalid,unknown")).toBeUndefined();
    });

    it("trims whitespace from domain names", () => {
      const result = MetricsEngine.parseDomainsArg(" performance , error ");
      expect(result).toEqual(["performance", "error"]);
    });

    it("handles case-insensitive parsing", () => {
      const result = MetricsEngine.parseDomainsArg("Performance,ERROR,Sla");
      expect(result).toEqual(["performance", "error", "sla"]);
    });

    it("recognizes all valid domain categories", () => {
      const all =
        "performance,throughput,error,saturation,sla,stability,scalability,chaos,security,observability,data-integrity";
      const result = MetricsEngine.parseDomainsArg(all);
      expect(result).toHaveLength(11);
    });
  });

  // ── score ─────────────────────────────────────────────────────────────────

  describe("score", () => {
    /** Build an engine with one calculator that returns results with the given statuses. */
    function engineWithStatuses(statuses: MetricStatus[]): MetricsEngine {
      const engine = new MetricsEngine();
      const results = statuses.map((status, i) => createMetricResult({ id: `M-${i}`, status }));
      engine.register(createMockCalculator("performance", results));
      return engine;
    }

    it("all-pass metrics -> score 100, grade A, healthy true", () => {
      const report = engineWithStatuses(["pass", "pass", "pass"]).calculate(createInput());
      expect(report.score).toBeDefined();
      expect(report.score!.value).toBe(100);
      expect(report.score!.grade).toBe("A");
      expect(report.score!.healthy).toBe(true);
    });

    it("mixed pass/warn/fail -> correct weighted score, grade B, healthy false", () => {
      // 2 pass + 1 warn + 1 na (na excluded from denominator)
      // scorable = 3; weighted = (2*1.0 + 1*0.5 + 0) / 3 = 2.5/3 = 0.8333 -> 83
      const report = engineWithStatuses(["pass", "pass", "warn", "na"]).calculate(createInput());
      expect(report.score!.value).toBe(83);
      expect(report.score!.grade).toBe("B");
      expect(report.score!.healthy).toBe(false);
    });

    it("na metrics excluded from denominator -> all-na report returns 100/A/healthy", () => {
      const report = engineWithStatuses(["na", "na", "na"]).calculate(createInput());
      expect(report.score!.value).toBe(100);
      expect(report.score!.grade).toBe("A");
      expect(report.score!.healthy).toBe(true);
    });

    it("empty report (no metrics) -> 100/A/healthy", () => {
      const report = new MetricsEngine().calculate(createInput());
      expect(report.score!.value).toBe(100);
      expect(report.score!.grade).toBe("A");
      expect(report.score!.healthy).toBe(true);
    });

    // Grade boundaries
    it("grade boundary: value 90 -> A", () => {
      // Need score = 90: pass*1.0 / scorable = 0.9
      // 9 pass + 1 fail = scorable 10; (9*1.0 + 0)/10 = 0.9 -> 90
      const report = engineWithStatuses([
        "pass",
        "pass",
        "pass",
        "pass",
        "pass",
        "pass",
        "pass",
        "pass",
        "pass",
        "fail",
      ]).calculate(createInput());
      expect(report.score!.value).toBe(90);
      expect(report.score!.grade).toBe("A");
      expect(report.score!.healthy).toBe(true);
    });

    it("grade boundary: value 89 -> B", () => {
      // 89 pass + 11 fail = scorable 100; (89/100)*100 = 89
      const statuses: MetricStatus[] = [
        ...Array(89).fill("pass" as MetricStatus),
        ...Array(11).fill("fail" as MetricStatus),
      ];
      const report = engineWithStatuses(statuses).calculate(createInput());
      expect(report.score!.value).toBe(89);
      expect(report.score!.grade).toBe("B");
      expect(report.score!.healthy).toBe(false);
    });

    it("grade boundary: value 80 -> B", () => {
      // 8 pass + 2 fail = scorable 10; (8/10)*100 = 80
      const report = engineWithStatuses([
        "pass",
        "pass",
        "pass",
        "pass",
        "pass",
        "pass",
        "pass",
        "pass",
        "fail",
        "fail",
      ]).calculate(createInput());
      expect(report.score!.value).toBe(80);
      expect(report.score!.grade).toBe("B");
    });

    it("grade boundary: value 70 -> C", () => {
      // 7 pass + 3 fail = scorable 10; (7/10)*100 = 70
      const report = engineWithStatuses([
        "pass",
        "pass",
        "pass",
        "pass",
        "pass",
        "pass",
        "pass",
        "fail",
        "fail",
        "fail",
      ]).calculate(createInput());
      expect(report.score!.value).toBe(70);
      expect(report.score!.grade).toBe("C");
    });

    it("grade boundary: value 60 -> D", () => {
      // 6 pass + 4 fail = scorable 10; (6/10)*100 = 60
      const report = engineWithStatuses([
        "pass",
        "pass",
        "pass",
        "pass",
        "pass",
        "pass",
        "fail",
        "fail",
        "fail",
        "fail",
      ]).calculate(createInput());
      expect(report.score!.value).toBe(60);
      expect(report.score!.grade).toBe("D");
    });

    it("grade boundary: value 59 -> F", () => {
      // 59 pass + 41 fail = scorable 100; (59/100)*100 = 59
      const statuses: MetricStatus[] = [
        ...Array(59).fill("pass" as MetricStatus),
        ...Array(41).fill("fail" as MetricStatus),
      ];
      const report = engineWithStatuses(statuses).calculate(createInput());
      expect(report.score!.value).toBe(59);
      expect(report.score!.grade).toBe("F");
      expect(report.score!.healthy).toBe(false);
    });

    it("na mixed with pass/fail -> na excluded from denominator", () => {
      // 2 pass + 1 fail + 2 na; scorable = 3; (2*1.0 + 0)/3 = 0.6666 -> 67; grade D (>=60)
      const report = engineWithStatuses(["pass", "pass", "fail", "na", "na"]).calculate(
        createInput()
      );
      expect(report.score!.value).toBe(67);
      expect(report.score!.grade).toBe("D");
    });
  });
});

// ── buildMetricsInput ─────────────────────────────────────────────────────────

describe("buildMetricsInput", () => {
  it("builds input from k6 handleSummary data", () => {
    const data = {
      metrics: {
        http_req_duration: { values: { avg: 150, "p(95)": 300 } },
        vus_max: { values: { max: 50 } },
      },
    };
    const context = {
      client: "test-client",
      environment: "staging",
      profile: "load",
      testName: "api-test",
      startTime: new Date(Date.now() - 60000).toISOString(),
    };

    const input = buildMetricsInput(data, context);

    expect(input.k6Metrics).toEqual(data.metrics);
    expect(input.vusMax).toBe(50);
    expect(input.durationMs).toBeGreaterThan(0);
    expect(input.context.client).toBe("test-client");
  });

  it("defaults vusMax to 0 when not present", () => {
    const data = { metrics: {} };
    const context = {
      client: "test",
      environment: "test",
      profile: "smoke",
      testName: "test",
      startTime: new Date().toISOString(),
    };

    const input = buildMetricsInput(data, context);
    expect(input.vusMax).toBe(0);
  });

  it("defaults k6Metrics to empty when metrics is missing", () => {
    const data = {};
    const context = {
      client: "test",
      environment: "test",
      profile: "smoke",
      testName: "test",
      startTime: new Date().toISOString(),
    };

    const input = buildMetricsInput(data, context);
    expect(input.k6Metrics).toEqual({});
  });

  it("includes optional externalMetrics and sloConfig", () => {
    const data = { metrics: {} };
    const context = {
      client: "test",
      environment: "test",
      profile: "smoke",
      testName: "test",
      startTime: new Date().toISOString(),
    };
    const externalMetrics = {
      cpu_usage: [{ ts: 1000, value: 0.5 }],
    };
    const sloConfig = {
      availabilityTarget: 0.999,
      latencyP95TargetMs: 500,
    };

    const input = buildMetricsInput(data, context, { externalMetrics, sloConfig });
    expect(input.externalMetrics).toEqual(externalMetrics);
    expect(input.sloConfig).toEqual(sloConfig);
  });
});
