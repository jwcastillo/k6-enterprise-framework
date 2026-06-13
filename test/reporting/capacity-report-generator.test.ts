import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock fs and path (Node.js modules used by capacity-report-generator)
vi.mock("fs", () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("path", () => ({
  join: vi.fn((...args: string[]) => args.join("/")),
}));

import {
  generateCapacityReportHtml,
  writeCapacityReport,
  CapacityReportOptions,
} from "../../src/reporting/capacity-report-generator";
import type {
  CapacityAnalysis,
  CapacityProjection,
  LoadDataPoint,
} from "../../src/reporting/capacity-analyzer";
import * as fs from "fs";

// ── Fixtures ────────────────────────────────────────────────────────────────

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

function makeAnalysis(overrides: Partial<CapacityAnalysis> = {}): CapacityAnalysis {
  return {
    maxSustainableLoad: makeDataPoint({ rps: 400, vus: 40 }),
    inflectionPoint: makeDataPoint({ rps: 300, vus: 30 }),
    breakingPoint: makeDataPoint({ rps: 500, vus: 50, errorRatePct: 6 }),
    currentHeadroomPct: 20,
    baselineLatencyMs: 100,
    dataPointCount: 10,
    sufficient: true,
    warnings: [],
    ...overrides,
  };
}

function makeProjection(overrides: Partial<CapacityProjection> = {}): CapacityProjection {
  const breakDate = new Date();
  breakDate.setMonth(breakDate.getMonth() + 8);
  return {
    growthRatePerMonth: 0.1,
    currentRps: 200,
    inflectionReachedAt: new Date(),
    breakingPointReachedAt: breakDate,
    confidenceLevel: "high",
    recommendations: ["Plan horizontal scaling before Q4."],
    warnings: [],
    ...overrides,
  };
}

function makeDataPoints(): LoadDataPoint[] {
  return [
    makeDataPoint({ vus: 10, rps: 100, p95Ms: 100, errorRatePct: 0.1 }),
    makeDataPoint({ vus: 20, rps: 200, p95Ms: 150, errorRatePct: 0.2 }),
    makeDataPoint({ vus: 30, rps: 300, p95Ms: 250, errorRatePct: 0.5 }),
    makeDataPoint({ vus: 40, rps: 400, p95Ms: 400, errorRatePct: 0.8 }),
    makeDataPoint({ vus: 50, rps: 500, p95Ms: 800, errorRatePct: 6.0 }),
  ];
}

function makeOptions(overrides: Partial<CapacityReportOptions> = {}): CapacityReportOptions {
  return {
    clientName: "acme",
    serviceName: "api-gateway",
    generatedAt: new Date("2026-01-15T10:00:00Z"),
    outputDir: "/tmp/reports",
    ...overrides,
  };
}

// ── generateCapacityReportHtml ───────────────────────────────────────────────

describe("generateCapacityReportHtml", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a valid HTML string with DOCTYPE", () => {
    const html = generateCapacityReportHtml(
      makeAnalysis(),
      makeProjection(),
      makeDataPoints(),
      makeOptions()
    );
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("</html>");
  });

  it("includes the service name in the title", () => {
    const html = generateCapacityReportHtml(
      makeAnalysis(),
      makeProjection(),
      makeDataPoints(),
      makeOptions()
    );
    expect(html).toContain("api-gateway");
    expect(html).toContain("Capacity Planning Report");
  });

  it("falls back to clientName when serviceName is not provided", () => {
    const opts = makeOptions({ serviceName: undefined });
    const html = generateCapacityReportHtml(
      makeAnalysis(),
      makeProjection(),
      makeDataPoints(),
      opts
    );
    expect(html).toContain("acme");
  });

  it("includes KPI cards with max sustainable RPS", () => {
    const html = generateCapacityReportHtml(
      makeAnalysis(),
      makeProjection(),
      makeDataPoints(),
      makeOptions()
    );
    expect(html).toContain("Max Sustainable");
    expect(html).toContain("400"); // rps
  });

  it("shows inflection point RPS", () => {
    const html = generateCapacityReportHtml(
      makeAnalysis(),
      makeProjection(),
      makeDataPoints(),
      makeOptions()
    );
    expect(html).toContain("Inflection Point");
    expect(html).toContain("300");
  });

  it("shows breaking point RPS", () => {
    const html = generateCapacityReportHtml(
      makeAnalysis(),
      makeProjection(),
      makeDataPoints(),
      makeOptions()
    );
    expect(html).toContain("Breaking Point");
    expect(html).toContain("500");
  });

  it("displays headroom percentage", () => {
    const html = generateCapacityReportHtml(
      makeAnalysis(),
      makeProjection(),
      makeDataPoints(),
      makeOptions()
    );
    expect(html).toContain("Headroom");
    expect(html).toContain("20%");
  });

  it("shows dashes for null values", () => {
    const analysis = makeAnalysis({
      maxSustainableLoad: null,
      inflectionPoint: null,
      breakingPoint: null,
      currentHeadroomPct: null,
    });
    const html = generateCapacityReportHtml(
      analysis,
      makeProjection(),
      makeDataPoints(),
      makeOptions()
    );
    // The em dash character
    expect(html).toContain("\u2014");
  });

  it("includes executive summary section", () => {
    const html = generateCapacityReportHtml(
      makeAnalysis(),
      makeProjection(),
      makeDataPoints(),
      makeOptions()
    );
    expect(html).toContain("Executive Summary");
    expect(html).toContain("api-gateway");
    expect(html).toContain("requests/second");
  });

  it("includes executive summary with healthy headroom language", () => {
    const analysis = makeAnalysis({ currentHeadroomPct: 50 });
    const html = generateCapacityReportHtml(
      analysis,
      makeProjection(),
      makeDataPoints(),
      makeOptions()
    );
    expect(html).toContain("healthy");
  });

  it("includes executive summary with critical headroom language", () => {
    const analysis = makeAnalysis({ currentHeadroomPct: 10 });
    const html = generateCapacityReportHtml(
      analysis,
      makeProjection(),
      makeDataPoints(),
      makeOptions()
    );
    expect(html).toContain("critically low");
  });

  it("includes load curve chart canvases", () => {
    const html = generateCapacityReportHtml(
      makeAnalysis(),
      makeProjection(),
      makeDataPoints(),
      makeOptions()
    );
    expect(html).toContain("chart-latency");
    expect(html).toContain("chart-errors");
  });

  it("includes growth projection chart", () => {
    const html = generateCapacityReportHtml(
      makeAnalysis(),
      makeProjection(),
      makeDataPoints(),
      makeOptions()
    );
    expect(html).toContain("chart-projection");
    expect(html).toContain("Growth Projection");
  });

  it("includes confidence level badge", () => {
    const html = generateCapacityReportHtml(
      makeAnalysis(),
      makeProjection(),
      makeDataPoints(),
      makeOptions()
    );
    expect(html).toContain("Confidence: high");
  });

  it("renders warning rows when warnings exist", () => {
    const analysis = makeAnalysis({ warnings: ["Low sample count"] });
    const html = generateCapacityReportHtml(
      analysis,
      makeProjection(),
      makeDataPoints(),
      makeOptions()
    );
    expect(html).toContain("Low sample count");
    expect(html).toContain("Warnings");
  });

  it("renders recommendation rows", () => {
    const projection = makeProjection({
      recommendations: ["Scale before Q4.", "Optimize queries."],
    });
    const html = generateCapacityReportHtml(
      makeAnalysis(),
      projection,
      makeDataPoints(),
      makeOptions()
    );
    expect(html).toContain("Scale before Q4.");
    expect(html).toContain("Optimize queries.");
    expect(html).toContain("Recommendations");
  });

  it("includes inline chart JavaScript (no CDN)", () => {
    const html = generateCapacityReportHtml(
      makeAnalysis(),
      makeProjection(),
      makeDataPoints(),
      makeOptions()
    );
    expect(html).toContain("<script>");
    expect(html).toContain("drawChart");
  });

  it("includes report footer with data point count", () => {
    const html = generateCapacityReportHtml(
      makeAnalysis(),
      makeProjection(),
      makeDataPoints(),
      makeOptions()
    );
    expect(html).toContain("Data points: 10");
    expect(html).toContain("k6 Enterprise Framework");
  });

  it("escapes HTML characters in service name", () => {
    const opts = makeOptions({ serviceName: '<script>alert("xss")</script>' });
    const html = generateCapacityReportHtml(
      makeAnalysis(),
      makeProjection(),
      makeDataPoints(),
      opts
    );
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("sorts data points by RPS for charts", () => {
    const unsorted = [
      makeDataPoint({ rps: 500, p95Ms: 800 }),
      makeDataPoint({ rps: 100, p95Ms: 100 }),
      makeDataPoint({ rps: 300, p95Ms: 250 }),
    ];
    const html = generateCapacityReportHtml(
      makeAnalysis(),
      makeProjection(),
      unsorted,
      makeOptions()
    );
    // The JSON array in the script should be sorted by RPS
    expect(html).toContain('"100 rps"');
    expect(html).toContain('"300 rps"');
    expect(html).toContain('"500 rps"');
  });

  it("handles no breaking point in executive summary", () => {
    const analysis = makeAnalysis({ breakingPoint: null });
    const projection = makeProjection({ breakingPointReachedAt: undefined });
    const html = generateCapacityReportHtml(analysis, projection, makeDataPoints(), makeOptions());
    expect(html).toContain("further load testing");
  });
});

// ── writeCapacityReport ──────────────────────────────────────────────────────

describe("writeCapacityReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates the output directory recursively", () => {
    writeCapacityReport(makeAnalysis(), makeProjection(), makeDataPoints(), makeOptions());
    expect(fs.mkdirSync).toHaveBeenCalledWith("/tmp/reports", { recursive: true });
  });

  it("writes an HTML file with timestamp in the filename", () => {
    const result = writeCapacityReport(
      makeAnalysis(),
      makeProjection(),
      makeDataPoints(),
      makeOptions()
    );
    expect(result).toContain("capacity-report-");
    expect(result).toContain(".html");
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
  });

  it("passes the generated HTML content to writeFileSync", () => {
    writeCapacityReport(makeAnalysis(), makeProjection(), makeDataPoints(), makeOptions());
    const [, content, encoding] = (fs.writeFileSync as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(content).toContain("<!DOCTYPE html>");
    expect(encoding).toBe("utf-8");
  });

  it("returns the full output file path", () => {
    const result = writeCapacityReport(
      makeAnalysis(),
      makeProjection(),
      makeDataPoints(),
      makeOptions()
    );
    expect(result).toContain("/tmp/reports");
    expect(result).toContain("capacity-report-");
  });

  it("uses the provided generatedAt for timestamp", () => {
    const opts = makeOptions({ generatedAt: new Date("2026-06-15T12:30:00Z") });
    const result = writeCapacityReport(makeAnalysis(), makeProjection(), makeDataPoints(), opts);
    expect(result).toContain("2026-06-15T12-30-00");
  });
});
