import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  detectTrendPatterns,
  buildTrendAnalysis,
  generateTrendHtml,
  generateGrafanaPanelConfig,
  TrendDataPoint,
} from "../../src/reporting/trend-visualizer";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makePoint(overrides: Partial<TrendDataPoint> = {}): TrendDataPoint {
  return {
    date: "2026-01-15",
    p95Ms: 200,
    p50Ms: 100,
    errorRatePct: 0.1,
    throughputRps: 500,
    verdict: "pass",
    ...overrides,
  };
}

/** Generate N days of data points ending today */
function generateDailyPoints(
  count: number,
  opts: { p95Base?: number; trend?: "stable" | "degrading" | "improving" } = {}
): TrendDataPoint[] {
  const { p95Base = 200, trend = "stable" } = opts;
  const points: TrendDataPoint[] = [];
  const today = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    let p95 = p95Base;
    if (trend === "degrading") {
      p95 = p95Base + (count - i) * 10; // increases over time
    } else if (trend === "improving") {
      p95 = p95Base - (count - i) * 5; // decreases over time
    }
    points.push({
      date,
      p95Ms: Math.max(10, p95),
      p50Ms: Math.max(5, p95 * 0.5),
      errorRatePct: 0.1,
      throughputRps: 500,
      verdict: "pass",
    });
  }
  return points;
}

// ── detectTrendPatterns ──────────────────────────────────────────────────────

describe("detectTrendPatterns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns stable/insufficient pattern for fewer than 7 data points", () => {
    const points = [makePoint(), makePoint(), makePoint()];
    const patterns = detectTrendPatterns(points);
    expect(patterns).toHaveLength(1);
    expect(patterns[0].type).toBe("stable");
    expect(patterns[0].description).toContain("Insufficient data");
    expect(patterns[0].severity).toBe("info");
  });

  it("detects degrading pattern when p95 increases > 10%", () => {
    const points = generateDailyPoints(14, { p95Base: 100, trend: "degrading" });
    const patterns = detectTrendPatterns(points);
    const degrading = patterns.find(
      (p) => p.type === "degrading" && p.description.includes("latency increased")
    );
    expect(degrading).toBeDefined();
  });

  it("detects improving pattern when p95 decreases > 10%", () => {
    // Build points where recent ones are significantly lower
    const points: TrendDataPoint[] = [];
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const p95 = i >= 7 ? 500 : 200; // older: 500, recent: 200
      points.push({
        date: d.toISOString().slice(0, 10),
        p95Ms: p95,
        p50Ms: p95 * 0.5,
        errorRatePct: 0.1,
        throughputRps: 500,
        verdict: "pass",
      });
    }
    const patterns = detectTrendPatterns(points);
    const improving = patterns.find((p) => p.type === "improving");
    expect(improving).toBeDefined();
    expect(improving!.severity).toBe("info");
  });

  it("detects stable pattern when change is within +-10%", () => {
    const points = generateDailyPoints(14, { p95Base: 200, trend: "stable" });
    const patterns = detectTrendPatterns(points);
    const stable = patterns.find((p) => p.type === "stable");
    expect(stable).toBeDefined();
    expect(stable!.description).toContain("stable within");
  });

  it("detects volatile pattern when coefficient of variation > 30%", () => {
    const points: TrendDataPoint[] = [];
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      // High variability: alternating between very low and very high
      const p95 = i % 2 === 0 ? 100 : 500;
      points.push({
        date: d.toISOString().slice(0, 10),
        p95Ms: p95,
        p50Ms: 50,
        errorRatePct: 0.1,
        throughputRps: 500,
        verdict: "pass",
      });
    }
    const patterns = detectTrendPatterns(points);
    const volatile = patterns.find((p) => p.type === "volatile");
    expect(volatile).toBeDefined();
    expect(volatile!.severity).toBe("warning");
    expect(volatile!.description).toContain("CV=");
  });

  it("detects high error rate trend", () => {
    const points: TrendDataPoint[] = [];
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      points.push({
        date: d.toISOString().slice(0, 10),
        p95Ms: 200,
        p50Ms: 100,
        errorRatePct: i < 7 ? 3.0 : 0.1, // recent days have high errors
        throughputRps: 500,
        verdict: "pass",
      });
    }
    const patterns = detectTrendPatterns(points);
    const errorPattern = patterns.find(
      (p) => p.type === "degrading" && p.description.includes("error rate")
    );
    expect(errorPattern).toBeDefined();
  });

  it("assigns critical severity for > 25% degradation", () => {
    const points: TrendDataPoint[] = [];
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const p95 = i >= 7 ? 100 : 300; // 200% increase
      points.push({
        date: d.toISOString().slice(0, 10),
        p95Ms: p95,
        p50Ms: 50,
        errorRatePct: 0.1,
        throughputRps: 500,
        verdict: "pass",
      });
    }
    const patterns = detectTrendPatterns(points);
    const critical = patterns.find((p) => p.type === "degrading" && p.severity === "critical");
    expect(critical).toBeDefined();
  });

  it("assigns critical severity for error rate > 5%", () => {
    const points: TrendDataPoint[] = [];
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      points.push({
        date: d.toISOString().slice(0, 10),
        p95Ms: 200,
        p50Ms: 100,
        errorRatePct: i < 7 ? 8.0 : 0.1,
        throughputRps: 500,
        verdict: "pass",
      });
    }
    const patterns = detectTrendPatterns(points);
    const critical = patterns.find(
      (p) =>
        p.type === "degrading" && p.severity === "critical" && p.description.includes("error rate")
    );
    expect(critical).toBeDefined();
  });
});

// ── buildTrendAnalysis ───────────────────────────────────────────────────────

describe("buildTrendAnalysis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters data points to the requested window", () => {
    const points = generateDailyPoints(60, { p95Base: 200 });
    const analysis = buildTrendAnalysis(points, 30);
    expect(analysis.window).toBe(30);
    // Should only include roughly the last 30 days
    expect(analysis.dataPoints.length).toBeLessThanOrEqual(31);
    expect(analysis.dataPoints.length).toBeGreaterThan(0);
  });

  it("uses first data point as baseline if not specified", () => {
    const points = generateDailyPoints(10, { p95Base: 300 });
    const analysis = buildTrendAnalysis(points, 30);
    expect(analysis.baselineP95).toBe(points[0].p95Ms);
  });

  it("uses custom baseline when provided", () => {
    const points = generateDailyPoints(10, { p95Base: 200 });
    const analysis = buildTrendAnalysis(points, 30, 500);
    expect(analysis.baselineP95).toBe(500);
  });

  it("sets alert threshold at 20% above baseline", () => {
    const points = generateDailyPoints(10, { p95Base: 200 });
    const analysis = buildTrendAnalysis(points, 30, 1000);
    expect(analysis.alertThresholdP95).toBe(1200); // 1000 * 1.2
  });

  it("includes patterns from detectTrendPatterns", () => {
    const points = generateDailyPoints(14, { p95Base: 200 });
    const analysis = buildTrendAnalysis(points, 30);
    expect(analysis.patterns.length).toBeGreaterThan(0);
  });

  it("returns insufficient summary when not enough data", () => {
    const points = generateDailyPoints(3);
    const analysis = buildTrendAnalysis(points, 30);
    expect(analysis.summary).toContain("Insufficient data");
  });

  it("returns stable summary for stable data", () => {
    const points = generateDailyPoints(14, { p95Base: 200, trend: "stable" });
    const analysis = buildTrendAnalysis(points, 30);
    // Should contain a stable/pass icon
    expect(analysis.summary.length).toBeGreaterThan(0);
  });

  it("handles empty data gracefully", () => {
    const analysis = buildTrendAnalysis([], 30);
    expect(analysis.dataPoints).toHaveLength(0);
    expect(analysis.baselineP95).toBe(1000); // default fallback
    expect(analysis.summary).toContain("Insufficient data");
  });

  it("supports 60-day window", () => {
    const points = generateDailyPoints(90, { p95Base: 200 });
    const analysis = buildTrendAnalysis(points, 60);
    expect(analysis.window).toBe(60);
    expect(analysis.dataPoints.length).toBeLessThanOrEqual(61);
  });

  it("supports 90-day window", () => {
    const points = generateDailyPoints(120, { p95Base: 200 });
    const analysis = buildTrendAnalysis(points, 90);
    expect(analysis.window).toBe(90);
    expect(analysis.dataPoints.length).toBeLessThanOrEqual(91);
  });

  it("sorts data points by date ascending", () => {
    const points = generateDailyPoints(10);
    // Shuffle the order
    const shuffled = [...points].reverse();
    const analysis = buildTrendAnalysis(shuffled, 30);
    for (let i = 1; i < analysis.dataPoints.length; i++) {
      expect(analysis.dataPoints[i].date >= analysis.dataPoints[i - 1].date).toBe(true);
    }
  });
});

// ── generateTrendHtml ────────────────────────────────────────────────────────

describe("generateTrendHtml", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates empty-state HTML when no data points exist", () => {
    const analysis = buildTrendAnalysis([], 30);
    const html = generateTrendHtml(analysis);
    expect(html).toContain("No data available");
    expect(html).toContain("trend-section");
  });

  it("generates HTML section with charts when data is available", () => {
    const points = generateDailyPoints(10);
    const analysis = buildTrendAnalysis(points, 30);
    const html = generateTrendHtml(analysis);
    expect(html).toContain("<section");
    expect(html).toContain("Performance Trends");
    expect(html).toContain("<canvas");
    expect(html).toContain("chart-p95");
    expect(html).toContain("chart-error");
    expect(html).toContain("chart-rps");
  });

  it("includes window selector buttons", () => {
    const points = generateDailyPoints(10);
    const analysis = buildTrendAnalysis(points, 30);
    const html = generateTrendHtml(analysis);
    expect(html).toContain("30d");
    expect(html).toContain("60d");
    expect(html).toContain("90d");
  });

  it("marks the active window button", () => {
    const points = generateDailyPoints(10);
    const analysis = buildTrendAnalysis(points, 60);
    const html = generateTrendHtml(analysis);
    expect(html).toContain('data-window="60"');
  });

  it("includes trend badges for detected patterns", () => {
    const points = generateDailyPoints(14, { p95Base: 200 });
    const analysis = buildTrendAnalysis(points, 30);
    const html = generateTrendHtml(analysis);
    expect(html).toContain("trend-badge");
  });

  it("includes inline CSS styles (no CDN dependencies)", () => {
    const points = generateDailyPoints(10);
    const analysis = buildTrendAnalysis(points, 30);
    const html = generateTrendHtml(analysis);
    expect(html).toContain("<style>");
    expect(html).toContain(".trend-section");
  });

  it("includes inline chart rendering script", () => {
    const points = generateDailyPoints(10);
    const analysis = buildTrendAnalysis(points, 30);
    const html = generateTrendHtml(analysis);
    expect(html).toContain("<script>");
    expect(html).toContain("renderLineChart");
  });
});

// ── generateGrafanaPanelConfig ───────────────────────────────────────────────

describe("generateGrafanaPanelConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates config with the service name in the title", () => {
    const config = generateGrafanaPanelConfig("my-api");
    expect(config.title).toContain("my-api");
    expect(config.title).toContain("p95");
  });

  it("is a timeseries panel type", () => {
    const config = generateGrafanaPanelConfig("svc");
    expect(config.type).toBe("timeseries");
  });

  it("includes grid position", () => {
    const config = generateGrafanaPanelConfig("svc");
    const gridPos = config.gridPos as Record<string, number>;
    expect(gridPos.w).toBe(24);
    expect(gridPos.h).toBe(8);
  });

  it("includes field config with ms unit and thresholds", () => {
    const config = generateGrafanaPanelConfig("svc");
    const fieldConfig = config.fieldConfig as Record<string, unknown>;
    const defaults = (fieldConfig as Record<string, Record<string, unknown>>).defaults;
    expect(defaults.unit).toBe("ms");
    const thresholds = defaults.thresholds as Record<string, unknown>;
    expect(thresholds.mode).toBe("absolute");
  });

  it("includes PromQL targets with service name", () => {
    const config = generateGrafanaPanelConfig("payments-api");
    const targets = config.targets as Array<Record<string, string>>;
    expect(targets).toHaveLength(2);
    expect(targets[0].expr).toContain("payments-api");
    expect(targets[0].legendFormat).toBe("p95");
    expect(targets[1].legendFormat).toBe("p50");
  });

  it("includes tooltip and legend options", () => {
    const config = generateGrafanaPanelConfig("svc");
    const options = config.options as Record<string, Record<string, string>>;
    expect(options.tooltip.mode).toBe("multi");
    expect(options.legend.displayMode).toBe("list");
  });
});
