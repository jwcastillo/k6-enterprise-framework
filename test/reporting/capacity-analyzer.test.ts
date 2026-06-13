import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  analyzeCapacity,
  projectCapacity,
  formatCapacityMarkdown,
  LoadDataPoint,
  CapacityAnalysis,
} from "../../src/reporting/capacity-analyzer";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeDataPoint(overrides: Partial<LoadDataPoint> = {}): LoadDataPoint {
  return {
    vus: 10,
    rps: 100,
    p95Ms: 200,
    p99Ms: 400,
    errorRatePct: 0.1,
    ...overrides,
  };
}

/** Generate a realistic ascending load curve (baseline through breaking) */
function generateLoadCurve(count: number): LoadDataPoint[] {
  const points: LoadDataPoint[] = [];
  for (let i = 0; i < count; i++) {
    const vus = (i + 1) * 10;
    const rps = (i + 1) * 50;
    // latency grows gradually at first, then spikes after 70% capacity
    const pctCapacity = i / count;
    const latencyMultiplier =
      pctCapacity > 0.7 ? 1 + (pctCapacity - 0.7) * 20 : 1 + pctCapacity * 0.5;
    const p95 = 100 * latencyMultiplier;
    const errorRate = pctCapacity > 0.8 ? (pctCapacity - 0.8) * 50 : 0.1;
    points.push({
      vus,
      rps,
      p95Ms: Math.round(p95),
      p99Ms: Math.round(p95 * 1.5),
      errorRatePct: parseFloat(errorRate.toFixed(2)),
    });
  }
  return points;
}

// ── analyzeCapacity ──────────────────────────────────────────────────────────

describe("analyzeCapacity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty analysis for zero data points", () => {
    const result = analyzeCapacity([]);
    expect(result.maxSustainableLoad).toBeNull();
    expect(result.inflectionPoint).toBeNull();
    expect(result.breakingPoint).toBeNull();
    expect(result.currentHeadroomPct).toBeNull();
    expect(result.baselineLatencyMs).toBe(0);
    expect(result.dataPointCount).toBe(0);
    expect(result.sufficient).toBe(false);
  });

  it("adds a warning when fewer than 5 data points", () => {
    const points = [makeDataPoint({ vus: 10, rps: 100 })];
    const result = analyzeCapacity(points);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("Only 1 data points");
    expect(result.sufficient).toBe(false);
  });

  it("marks sufficient=true with >= 5 data points", () => {
    const points = generateLoadCurve(5);
    const result = analyzeCapacity(points);
    expect(result.sufficient).toBe(true);
    expect(result.dataPointCount).toBe(5);
  });

  it("identifies max sustainable load (p95 < threshold AND error < 1%)", () => {
    const points = [
      makeDataPoint({ vus: 10, rps: 100, p95Ms: 200, errorRatePct: 0.1 }),
      makeDataPoint({ vus: 20, rps: 200, p95Ms: 400, errorRatePct: 0.2 }),
      makeDataPoint({ vus: 30, rps: 300, p95Ms: 800, errorRatePct: 0.5 }),
      makeDataPoint({ vus: 40, rps: 400, p95Ms: 1500, errorRatePct: 0.8 }),
      makeDataPoint({ vus: 50, rps: 500, p95Ms: 2500, errorRatePct: 2.0 }), // exceeds p95 threshold
    ];
    const result = analyzeCapacity(points, 2000);
    expect(result.maxSustainableLoad).not.toBeNull();
    expect(result.maxSustainableLoad!.rps).toBe(400);
    expect(result.maxSustainableLoad!.vus).toBe(40);
  });

  it("identifies breaking point (error > 5%)", () => {
    const points = [
      makeDataPoint({ vus: 10, rps: 100, p95Ms: 100, errorRatePct: 0.1 }),
      makeDataPoint({ vus: 20, rps: 200, p95Ms: 150, errorRatePct: 0.5 }),
      makeDataPoint({ vus: 30, rps: 300, p95Ms: 200, errorRatePct: 6.0 }), // error > 5%
      makeDataPoint({ vus: 40, rps: 400, p95Ms: 500, errorRatePct: 15.0 }),
      makeDataPoint({ vus: 50, rps: 500, p95Ms: 1000, errorRatePct: 25.0 }),
    ];
    const result = analyzeCapacity(points);
    expect(result.breakingPoint).not.toBeNull();
    expect(result.breakingPoint!.rps).toBe(300);
  });

  it("identifies breaking point (latency > 3x baseline)", () => {
    const points = [
      makeDataPoint({ vus: 10, rps: 100, p95Ms: 100, errorRatePct: 0.1 }),
      makeDataPoint({ vus: 20, rps: 200, p95Ms: 150, errorRatePct: 0.2 }),
      makeDataPoint({ vus: 30, rps: 300, p95Ms: 200, errorRatePct: 0.3 }),
      makeDataPoint({ vus: 40, rps: 400, p95Ms: 310, errorRatePct: 0.4 }), // > 3x 100ms baseline
      makeDataPoint({ vus: 50, rps: 500, p95Ms: 600, errorRatePct: 0.5 }),
    ];
    const result = analyzeCapacity(points);
    expect(result.breakingPoint).not.toBeNull();
    expect(result.breakingPoint!.rps).toBe(400);
    expect(result.baselineLatencyMs).toBe(100);
  });

  it("returns null breaking point when no point exceeds thresholds", () => {
    const points = [
      makeDataPoint({ vus: 10, rps: 100, p95Ms: 100, errorRatePct: 0.1 }),
      makeDataPoint({ vus: 20, rps: 200, p95Ms: 120, errorRatePct: 0.2 }),
      makeDataPoint({ vus: 30, rps: 300, p95Ms: 150, errorRatePct: 0.3 }),
      makeDataPoint({ vus: 40, rps: 400, p95Ms: 180, errorRatePct: 0.4 }),
      makeDataPoint({ vus: 50, rps: 500, p95Ms: 200, errorRatePct: 0.5 }),
    ];
    const result = analyzeCapacity(points);
    expect(result.breakingPoint).toBeNull();
  });

  it("computes headroom percentage when both sustainable and breaking are found", () => {
    const points = [
      makeDataPoint({ vus: 10, rps: 100, p95Ms: 100, errorRatePct: 0.1 }),
      makeDataPoint({ vus: 20, rps: 200, p95Ms: 150, errorRatePct: 0.2 }),
      makeDataPoint({ vus: 30, rps: 300, p95Ms: 200, errorRatePct: 0.5 }),
      makeDataPoint({ vus: 40, rps: 400, p95Ms: 250, errorRatePct: 0.8 }),
      // Breaking point: error > 5%, but p95 still < 3x baseline (300)
      makeDataPoint({ vus: 50, rps: 500, p95Ms: 280, errorRatePct: 6.0 }),
    ];
    const result = analyzeCapacity(points, 2000);
    expect(result.currentHeadroomPct).not.toBeNull();
    // maxSustainable=rps 400 (last with p95<2000 & error<1%), breaking=rps 500
    // headroom = (500 - 400) / 500 * 100 = 20%
    expect(result.currentHeadroomPct).toBe(20);
  });

  it("sorts data points by VU count ascending", () => {
    const points = [
      makeDataPoint({ vus: 50, rps: 500, p95Ms: 300, errorRatePct: 0.1 }),
      makeDataPoint({ vus: 10, rps: 100, p95Ms: 100, errorRatePct: 0.1 }),
      makeDataPoint({ vus: 30, rps: 300, p95Ms: 200, errorRatePct: 0.1 }),
      makeDataPoint({ vus: 20, rps: 200, p95Ms: 150, errorRatePct: 0.1 }),
      makeDataPoint({ vus: 40, rps: 400, p95Ms: 250, errorRatePct: 0.1 }),
    ];
    const result = analyzeCapacity(points);
    // baseline should be lowest VU point (vus=10, p95=100)
    expect(result.baselineLatencyMs).toBe(100);
  });

  it("detects inflection point where latency slope changes >50%", () => {
    const points = [
      makeDataPoint({ vus: 10, rps: 100, p95Ms: 100, errorRatePct: 0.1 }),
      makeDataPoint({ vus: 20, rps: 200, p95Ms: 110, errorRatePct: 0.1 }),
      makeDataPoint({ vus: 30, rps: 300, p95Ms: 120, errorRatePct: 0.1 }),
      // Inflection here: slope changes dramatically
      makeDataPoint({ vus: 40, rps: 400, p95Ms: 200, errorRatePct: 0.1 }),
      makeDataPoint({ vus: 50, rps: 500, p95Ms: 500, errorRatePct: 0.1 }),
    ];
    const result = analyzeCapacity(points);
    expect(result.inflectionPoint).not.toBeNull();
  });

  it("returns null inflection point with fewer than 3 data points", () => {
    const points = [
      makeDataPoint({ vus: 10, rps: 100, p95Ms: 100, errorRatePct: 0.1 }),
      makeDataPoint({ vus: 20, rps: 200, p95Ms: 200, errorRatePct: 0.2 }),
    ];
    const result = analyzeCapacity(points);
    expect(result.inflectionPoint).toBeNull();
  });

  it("uses custom p95 threshold", () => {
    const points = [
      makeDataPoint({ vus: 10, rps: 100, p95Ms: 400, errorRatePct: 0.1 }),
      makeDataPoint({ vus: 20, rps: 200, p95Ms: 450, errorRatePct: 0.2 }),
      makeDataPoint({ vus: 30, rps: 300, p95Ms: 510, errorRatePct: 0.3 }),
      makeDataPoint({ vus: 40, rps: 400, p95Ms: 600, errorRatePct: 0.4 }),
      makeDataPoint({ vus: 50, rps: 500, p95Ms: 700, errorRatePct: 0.5 }),
    ];
    // With threshold of 500ms, max sustainable is at rps=200
    const result = analyzeCapacity(points, 500);
    expect(result.maxSustainableLoad).not.toBeNull();
    expect(result.maxSustainableLoad!.rps).toBe(200);
  });
});

// ── projectCapacity ──────────────────────────────────────────────────────────

describe("projectCapacity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeAnalysis(overrides: Partial<CapacityAnalysis> = {}): CapacityAnalysis {
    return {
      maxSustainableLoad: makeDataPoint({ rps: 400 }),
      inflectionPoint: makeDataPoint({ rps: 300 }),
      breakingPoint: makeDataPoint({ rps: 500, errorRatePct: 6 }),
      currentHeadroomPct: 20,
      baselineLatencyMs: 100,
      dataPointCount: 10,
      sufficient: true,
      warnings: [],
      ...overrides,
    };
  }

  it("returns low confidence when data is insufficient", () => {
    const analysis = makeAnalysis({ sufficient: false, dataPointCount: 3 });
    const result = projectCapacity(analysis, 100, 0.1);
    expect(result.confidenceLevel).toBe("low");
    expect(result.warnings).toContain(
      "Insufficient data for reliable projection (< 5 data points)."
    );
  });

  it("returns medium confidence with 5-7 data points", () => {
    const analysis = makeAnalysis({ dataPointCount: 6, sufficient: true });
    const result = projectCapacity(analysis, 100, 0.1);
    expect(result.confidenceLevel).toBe("medium");
  });

  it("returns high confidence with >= 8 data points", () => {
    const analysis = makeAnalysis({ dataPointCount: 10, sufficient: true });
    const result = projectCapacity(analysis, 100, 0.1);
    expect(result.confidenceLevel).toBe("high");
  });

  it("projects inflection date correctly", () => {
    const analysis = makeAnalysis({
      inflectionPoint: makeDataPoint({ rps: 300 }),
    });
    const result = projectCapacity(analysis, 100, 0.1); // 10%/month
    expect(result.inflectionReachedAt).toBeDefined();
    expect(result.inflectionReachedAt).toBeInstanceOf(Date);
    expect(result.inflectionReachedAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("projects breaking point date correctly", () => {
    const analysis = makeAnalysis({
      breakingPoint: makeDataPoint({ rps: 500 }),
    });
    const result = projectCapacity(analysis, 100, 0.15);
    expect(result.breakingPointReachedAt).toBeDefined();
    expect(result.breakingPointReachedAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("returns immediate date if currentRps >= target", () => {
    const analysis = makeAnalysis({
      inflectionPoint: makeDataPoint({ rps: 300 }),
    });
    const result = projectCapacity(analysis, 500, 0.1); // already past inflection
    expect(result.inflectionReachedAt).toBeDefined();
    // The date should be roughly now
    const delta = Math.abs(result.inflectionReachedAt!.getTime() - Date.now());
    expect(delta).toBeLessThan(5000); // within 5 seconds
  });

  it("returns undefined dates when growthRate is 0", () => {
    const analysis = makeAnalysis({
      inflectionPoint: makeDataPoint({ rps: 300 }),
      breakingPoint: makeDataPoint({ rps: 500 }),
    });
    const result = projectCapacity(analysis, 100, 0);
    expect(result.inflectionReachedAt).toBeUndefined();
    expect(result.breakingPointReachedAt).toBeUndefined();
  });

  it("returns undefined when there is no inflection or breaking point", () => {
    const analysis = makeAnalysis({
      inflectionPoint: null,
      breakingPoint: null,
    });
    const result = projectCapacity(analysis, 100, 0.1);
    expect(result.inflectionReachedAt).toBeUndefined();
    expect(result.breakingPointReachedAt).toBeUndefined();
  });

  it("generates scaling recommendation when breaking point <= 3 months away", () => {
    const analysis = makeAnalysis({
      breakingPoint: makeDataPoint({ rps: 130 }),
    });
    // With 10%/month from 100 rps, reaches 130 in ~3 months
    const result = projectCapacity(analysis, 100, 0.1);
    expect(
      result.recommendations.some(
        (r) => r.includes("Scale horizontally") || r.includes("Plan horizontal")
      )
    ).toBe(true);
  });

  it("recommends immediate scaling when headroom < 20%", () => {
    const analysis = makeAnalysis({ currentHeadroomPct: 10 });
    const result = projectCapacity(analysis, 100, 0.1);
    expect(result.recommendations.some((r) => r.includes("headroom is below 20%"))).toBe(true);
  });

  it("adds inflection-based optimization recommendation", () => {
    const analysis = makeAnalysis({
      inflectionPoint: makeDataPoint({ rps: 300 }),
    });
    const result = projectCapacity(analysis, 100, 0.1);
    expect(result.recommendations.some((r) => r.includes("latency degradation past"))).toBe(true);
  });

  it("preserves growthRatePerMonth and currentRps in output", () => {
    const analysis = makeAnalysis();
    const result = projectCapacity(analysis, 250, 0.2);
    expect(result.growthRatePerMonth).toBe(0.2);
    expect(result.currentRps).toBe(250);
  });
});

// ── formatCapacityMarkdown ───────────────────────────────────────────────────

describe("formatCapacityMarkdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates markdown with capacity analysis header", () => {
    const analysis: CapacityAnalysis = {
      maxSustainableLoad: makeDataPoint({ rps: 400, vus: 40 }),
      inflectionPoint: makeDataPoint({ rps: 300 }),
      breakingPoint: makeDataPoint({ rps: 500 }),
      currentHeadroomPct: 20,
      baselineLatencyMs: 100,
      dataPointCount: 10,
      sufficient: true,
      warnings: [],
    };
    const md = formatCapacityMarkdown(analysis);
    expect(md).toContain("## Capacity Analysis");
    expect(md).toContain("| Max Sustainable RPS | 400 |");
    expect(md).toContain("| Max Sustainable VUs | 40 |");
    expect(md).toContain("| Inflection Point RPS | 300 |");
    expect(md).toContain("| Breaking Point RPS | 500 |");
    expect(md).toContain("| Headroom | 20% |");
    expect(md).toContain("| Baseline p95 | 100ms |");
  });

  it("shows N/A for null values", () => {
    const analysis: CapacityAnalysis = {
      maxSustainableLoad: null,
      inflectionPoint: null,
      breakingPoint: null,
      currentHeadroomPct: null,
      baselineLatencyMs: 0,
      dataPointCount: 0,
      sufficient: false,
      warnings: [],
    };
    const md = formatCapacityMarkdown(analysis);
    expect(md).toContain("| Max Sustainable RPS | N/A |");
    expect(md).toContain("| Headroom | N/A |");
  });

  it("includes warnings section when warnings exist", () => {
    const analysis: CapacityAnalysis = {
      maxSustainableLoad: null,
      inflectionPoint: null,
      breakingPoint: null,
      currentHeadroomPct: null,
      baselineLatencyMs: 0,
      dataPointCount: 2,
      sufficient: false,
      warnings: ["Too few data points"],
    };
    const md = formatCapacityMarkdown(analysis);
    expect(md).toContain("**Warnings:**");
    expect(md).toContain("- Too few data points");
  });

  it("includes projection section when projection is provided", () => {
    const analysis: CapacityAnalysis = {
      maxSustainableLoad: makeDataPoint({ rps: 400 }),
      inflectionPoint: null,
      breakingPoint: null,
      currentHeadroomPct: null,
      baselineLatencyMs: 100,
      dataPointCount: 10,
      sufficient: true,
      warnings: [],
    };
    const projection = projectCapacity(analysis, 100, 0.15);
    const md = formatCapacityMarkdown(analysis, projection);
    expect(md).toContain("### Growth Projections");
    expect(md).toContain("15%/month");
  });

  it("does not include projection section when none provided", () => {
    const analysis: CapacityAnalysis = {
      maxSustainableLoad: null,
      inflectionPoint: null,
      breakingPoint: null,
      currentHeadroomPct: null,
      baselineLatencyMs: 0,
      dataPointCount: 0,
      sufficient: false,
      warnings: [],
    };
    const md = formatCapacityMarkdown(analysis);
    expect(md).not.toContain("### Growth Projections");
  });
});
