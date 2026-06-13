import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  detectCorrelations,
  formatCorrelationHtml,
  buildCorrelationResult,
  collectInfraMetrics,
  fetchSlowTraces,
  InfraMetrics,
  InfraMetricsConfig,
  CorrelationResult,
  ApmTrace,
} from "../../src/observability/infra-metrics-collector";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<InfraMetricsConfig> = {}): InfraMetricsConfig {
  return {
    prometheusUrl: "http://prometheus:9090",
    grafanaUrl: "http://grafana:3000",
    serviceLabel: "api-gateway",
    ...overrides,
  };
}

function makeInfraMetrics(overrides: Partial<InfraMetrics> = {}): InfraMetrics {
  return {
    cpuUsagePct: { timestamps: [1000, 2000, 3000], values: [30, 50, 85] },
    memoryUsagePct: { timestamps: [1000, 2000, 3000], values: [40, 60, 90] },
    diskReadOps: { timestamps: [], values: [] },
    diskWriteOps: { timestamps: [], values: [] },
    networkInBytes: { timestamps: [], values: [] },
    networkOutBytes: { timestamps: [], values: [] },
    activeConnections: { timestamps: [], values: [] },
    ...overrides,
  };
}

function makeCorrelationResult(overrides: Partial<CorrelationResult> = {}): CorrelationResult {
  return {
    infraMetrics: makeInfraMetrics(),
    slowestTraces: [],
    correlationEvents: [],
    available: true,
    warnings: [],
    ...overrides,
  };
}

// ── detectCorrelations ───────────────────────────────────────────────────────

describe("detectCorrelations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when infra has no CPU timestamps", () => {
    const infra = makeInfraMetrics({
      cpuUsagePct: { timestamps: [], values: [] },
    });
    const events = detectCorrelations(
      [{ ts: 1000, p95Ms: 2000, errorRatePct: 0 }],
      infra
    );
    expect(events).toHaveLength(0);
  });

  it("detects correlation when p95 > 1000ms and CPU > 80%", () => {
    const infra = makeInfraMetrics({
      cpuUsagePct: { timestamps: [1000, 2000, 3000], values: [30, 85, 95] },
      memoryUsagePct: { timestamps: [1000, 2000, 3000], values: [40, 50, 60] },
    });
    const testPoints = [
      { ts: 2000, p95Ms: 1500, errorRatePct: 0.5 },
    ];
    const events = detectCorrelations(testPoints, infra);
    expect(events.length).toBeGreaterThanOrEqual(1);
    const cpuEvent = events.find((e) => e.infraMetric === "cpu_usage_pct");
    expect(cpuEvent).toBeDefined();
    expect(cpuEvent!.severity).toBe("warning");
    expect(cpuEvent!.description).toContain("Latency spike");
    expect(cpuEvent!.description).toContain("CPU at");
  });

  it("marks severity=critical when CPU > 95%", () => {
    const infra = makeInfraMetrics({
      cpuUsagePct: { timestamps: [1000], values: [96] },
      memoryUsagePct: { timestamps: [1000], values: [50] },
    });
    const events = detectCorrelations(
      [{ ts: 1000, p95Ms: 2000, errorRatePct: 0 }],
      infra
    );
    expect(events[0].severity).toBe("critical");
  });

  it("detects memory correlation when error > 5% and memory > 85%", () => {
    const infra = makeInfraMetrics({
      cpuUsagePct: { timestamps: [1000], values: [50] },
      memoryUsagePct: { timestamps: [1000], values: [90] },
    });
    const events = detectCorrelations(
      [{ ts: 1000, p95Ms: 500, errorRatePct: 8.0 }],
      infra
    );
    const memEvent = events.find((e) => e.infraMetric === "memory_usage_pct");
    expect(memEvent).toBeDefined();
    expect(memEvent!.description).toContain("Error burst");
    expect(memEvent!.description).toContain("memory at");
  });

  it("marks memory severity=critical when memory > 95%", () => {
    const infra = makeInfraMetrics({
      cpuUsagePct: { timestamps: [1000], values: [50] },
      memoryUsagePct: { timestamps: [1000], values: [97] },
    });
    const events = detectCorrelations(
      [{ ts: 1000, p95Ms: 500, errorRatePct: 10.0 }],
      infra
    );
    const memEvent = events.find((e) => e.infraMetric === "memory_usage_pct");
    expect(memEvent!.severity).toBe("critical");
  });

  it("does not create events when thresholds are not exceeded", () => {
    const infra = makeInfraMetrics({
      cpuUsagePct: { timestamps: [1000], values: [50] },
      memoryUsagePct: { timestamps: [1000], values: [60] },
    });
    const events = detectCorrelations(
      [{ ts: 1000, p95Ms: 500, errorRatePct: 0.5 }],
      infra
    );
    expect(events).toHaveLength(0);
  });

  it("finds the nearest infra timestamp for each test point", () => {
    const infra = makeInfraMetrics({
      cpuUsagePct: { timestamps: [1000, 5000, 10000], values: [30, 90, 40] },
      memoryUsagePct: { timestamps: [1000, 5000, 10000], values: [40, 50, 60] },
    });
    // Test point at ts=4500 should match infra bucket at ts=5000 (cpu=90)
    const events = detectCorrelations(
      [{ ts: 4500, p95Ms: 1500, errorRatePct: 0 }],
      infra
    );
    expect(events).toHaveLength(1);
    expect(events[0].infraValue).toBe(90);
  });

  it("detects both CPU and memory correlations simultaneously", () => {
    const infra = makeInfraMetrics({
      cpuUsagePct: { timestamps: [1000], values: [85] },
      memoryUsagePct: { timestamps: [1000], values: [92] },
    });
    const events = detectCorrelations(
      [{ ts: 1000, p95Ms: 2000, errorRatePct: 8.0 }],
      infra
    );
    expect(events).toHaveLength(2);
    const metrics = events.map((e) => e.infraMetric);
    expect(metrics).toContain("cpu_usage_pct");
    expect(metrics).toContain("memory_usage_pct");
  });

  it("handles multiple test data points", () => {
    const infra = makeInfraMetrics({
      cpuUsagePct: { timestamps: [1000, 2000, 3000], values: [85, 40, 90] },
      memoryUsagePct: { timestamps: [1000, 2000, 3000], values: [50, 50, 50] },
    });
    const events = detectCorrelations(
      [
        { ts: 1000, p95Ms: 1500, errorRatePct: 0 },
        { ts: 2000, p95Ms: 300, errorRatePct: 0 },
        { ts: 3000, p95Ms: 2000, errorRatePct: 0 },
      ],
      infra
    );
    // Should detect at ts=1000 (cpu=85, p95=1500) and ts=3000 (cpu=90, p95=2000)
    expect(events).toHaveLength(2);
  });
});

// ── collectInfraMetrics ──────────────────────────────────────────────────────

describe("collectInfraMetrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when Prometheus is not reachable", async () => {
    mockFetch.mockRejectedValue(new Error("Connection refused"));
    const result = await collectInfraMetrics(makeConfig(), 1000, 5000);
    expect(result).toBeNull();
  });

  it("calls Prometheus with correct query_range URL structure", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { result: [{ values: [[1, "50"]] }] } }),
    });
    await collectInfraMetrics(makeConfig(), 1000, 5000);
    expect(mockFetch).toHaveBeenCalled();
    const firstUrl = mockFetch.mock.calls[0][0] as string;
    expect(firstUrl).toContain("/api/v1/query_range");
    expect(firstUrl).toContain("api-gateway");
  });

  it("includes namespace filter when provided", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { result: [{ values: [[1, "50"]] }] } }),
    });
    await collectInfraMetrics(makeConfig({ namespace: "prod" }), 1000, 5000);
    const firstUrl = mockFetch.mock.calls[0][0] as string;
    expect(firstUrl).toContain("namespace");
    expect(firstUrl).toContain("prod");
  });

  it("returns structured InfraMetrics on success", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: { result: [{ values: [[1.0, "50"], [2.0, "60"]] }] },
      }),
    });
    const result = await collectInfraMetrics(makeConfig(), 1000, 5000);
    expect(result).not.toBeNull();
    expect(result!.cpuUsagePct.timestamps).toHaveLength(2);
    expect(result!.cpuUsagePct.values).toHaveLength(2);
    expect(result!.cpuUsagePct.values[0]).toBe(50);
    expect(result!.cpuUsagePct.values[1]).toBe(60);
  });
});

// ── fetchSlowTraces ──────────────────────────────────────────────────────────

describe("fetchSlowTraces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when Grafana/Tempo is not reachable", async () => {
    mockFetch.mockRejectedValue(new Error("Connection refused"));
    const result = await fetchSlowTraces(makeConfig(), 1000, 5000);
    expect(result).toEqual([]);
  });

  it("returns empty array for non-OK response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 });
    const result = await fetchSlowTraces(makeConfig(), 1000, 5000);
    expect(result).toEqual([]);
  });

  it("returns mapped traces from Tempo response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          traces: [
            {
              traceID: "abc123",
              rootServiceName: "api-gateway",
              rootTraceName: "GET /users",
              durationMs: 450,
              startTimeUnixNano: 1000000000,
            },
          ],
        }),
    });
    const result = await fetchSlowTraces(makeConfig(), 1000, 5000);
    expect(result).toHaveLength(1);
    expect(result[0].traceId).toBe("abc123");
    expect(result[0].service).toBe("api-gateway");
    expect(result[0].operation).toBe("GET /users");
    expect(result[0].durationMs).toBe(450);
    expect(result[0].grafanaLink).toContain("abc123");
  });

  it("handles empty traces array", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ traces: [] }),
    });
    const result = await fetchSlowTraces(makeConfig(), 1000, 5000);
    expect(result).toEqual([]);
  });

  it("handles null/undefined traces field", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    const result = await fetchSlowTraces(makeConfig(), 1000, 5000);
    expect(result).toEqual([]);
  });
});

// ── buildCorrelationResult ───────────────────────────────────────────────────

describe("buildCorrelationResult", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns not-available result when both infra and traces fail", async () => {
    mockFetch.mockRejectedValue(new Error("not available"));
    const result = await buildCorrelationResult(
      makeConfig(),
      [{ ts: 1000, p95Ms: 500, errorRatePct: 0 }],
      1000,
      5000
    );
    expect(result.available).toBe(false);
    expect(result.infraMetrics).toBeNull();
    expect(result.slowestTraces).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("warns when Prometheus is unavailable", async () => {
    mockFetch.mockRejectedValue(new Error("Connection refused"));
    const result = await buildCorrelationResult(
      makeConfig(),
      [{ ts: 1000, p95Ms: 500, errorRatePct: 0 }],
      1000,
      5000
    );
    expect(result.warnings.some((w) => w.includes("Prometheus"))).toBe(true);
  });

  it("warns when Tempo has no traces", async () => {
    mockFetch.mockRejectedValue(new Error("not found"));
    const result = await buildCorrelationResult(
      makeConfig(),
      [{ ts: 1000, p95Ms: 500, errorRatePct: 0 }],
      1000,
      5000
    );
    expect(result.warnings.some((w) => w.includes("Tempo"))).toBe(true);
  });
});

// ── formatCorrelationHtml ────────────────────────────────────────────────────

describe("formatCorrelationHtml", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty string when not available", () => {
    const html = formatCorrelationHtml(makeCorrelationResult({ available: false }));
    expect(html).toBe("");
  });

  it("generates HTML section with correlation ID", () => {
    const html = formatCorrelationHtml(makeCorrelationResult());
    expect(html).toContain('id="correlation"');
    expect(html).toContain("Correlacion");
  });

  it("includes trace rows when traces exist", () => {
    const traces: ApmTrace[] = [
      {
        traceId: "trace-001",
        service: "api-gateway",
        operation: "GET /users",
        durationMs: 450,
        startTime: 1000,
        grafanaLink: "http://grafana:3000/trace/trace-001",
      },
    ];
    const html = formatCorrelationHtml(
      makeCorrelationResult({ slowestTraces: traces })
    );
    expect(html).toContain("api-gateway");
    expect(html).toContain("GET /users");
    expect(html).toContain("450ms");
    expect(html).toContain("View trace");
  });

  it("includes correlation events with colored rows", () => {
    const events = [
      {
        timestamp: 1000,
        testMetric: "p95_latency",
        testValue: 2000,
        infraMetric: "cpu_usage_pct",
        infraValue: 92,
        severity: "critical" as const,
        description: "CPU spike correlated with latency",
      },
    ];
    const html = formatCorrelationHtml(
      makeCorrelationResult({ correlationEvents: events })
    );
    expect(html).toContain("Correlaciones detectadas");
    expect(html).toContain("CPU spike");
    expect(html).toContain("#fee2e2"); // critical color
  });

  it("shows success message when no correlations found", () => {
    const html = formatCorrelationHtml(
      makeCorrelationResult({ correlationEvents: [] })
    );
    expect(html).toContain("No se detectaron");
  });

  it("displays warnings", () => {
    const html = formatCorrelationHtml(
      makeCorrelationResult({ warnings: ["Prometheus not reachable"] })
    );
    expect(html).toContain("Prometheus not reachable");
  });
});
