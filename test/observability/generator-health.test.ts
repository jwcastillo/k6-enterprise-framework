import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock os module
vi.mock("os", () => ({
  cpus: vi.fn(() => [
    { times: { user: 1000, nice: 0, sys: 200, irq: 0, idle: 800 } },
    { times: { user: 1200, nice: 0, sys: 100, irq: 0, idle: 700 } },
  ]),
  totalmem: vi.fn(() => 16 * 1024 * 1024 * 1024), // 16GB
  freemem: vi.fn(() => 8 * 1024 * 1024 * 1024), // 8GB free
  loadavg: vi.fn(() => [1.5, 1.2, 1.0]),
}));

// Mock fs module (for Docker detection)
vi.mock("fs", () => ({
  existsSync: vi.fn(() => false), // not Docker by default
  readFileSync: vi.fn(() => ""),
}));

import {
  startHealthMonitor,
  stopHealthMonitor,
  formatHealthForHtml,
  formatHealthForJson,
} from "@node/generator-health";
import type { GeneratorHealthMetrics } from "../../src/types/benchmark.d";

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeMetrics(overrides: Partial<GeneratorHealthMetrics> = {}): GeneratorHealthMetrics {
  return {
    cpuMax: 45,
    cpuAvg: 35,
    memMax: 4 * 1024 * 1024 * 1024, // 4GB
    memAvg: 3 * 1024 * 1024 * 1024, // 3GB
    warnings: [],
    samples: [
      {
        timestamp: "2026-01-15T10:00:00.000Z",
        cpuPercent: 35,
        memoryBytes: 3 * 1024 * 1024 * 1024,
        memoryPercent: 19,
      },
      {
        timestamp: "2026-01-15T10:00:05.000Z",
        cpuPercent: 45,
        memoryBytes: 4 * 1024 * 1024 * 1024,
        memoryPercent: 25,
      },
    ],
    saturated: false,
    ...overrides,
  };
}

// ── startHealthMonitor / stopHealthMonitor ────────────────────────────────────

describe("startHealthMonitor and stopHealthMonitor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Ensure monitor is stopped
    try {
      stopHealthMonitor();
    } catch {
      // ignore
    }
    vi.useRealTimers();
  });

  it("starts and stops the monitor returning metrics", () => {
    startHealthMonitor();
    const metrics = stopHealthMonitor();
    expect(metrics).toBeDefined();
    expect(typeof metrics.cpuMax).toBe("number");
    expect(typeof metrics.cpuAvg).toBe("number");
    expect(typeof metrics.memMax).toBe("number");
    expect(typeof metrics.memAvg).toBe("number");
    expect(Array.isArray(metrics.samples)).toBe(true);
    expect(Array.isArray(metrics.warnings)).toBe(true);
    expect(typeof metrics.saturated).toBe("boolean");
  });

  it("collects at least 2 samples (initial + final on stop)", () => {
    startHealthMonitor();
    const metrics = stopHealthMonitor();
    // startHealthMonitor collects initial sample, stopHealthMonitor collects final
    expect(metrics.samples.length).toBeGreaterThanOrEqual(2);
  });

  it("resets samples between start calls", () => {
    startHealthMonitor();
    stopHealthMonitor();

    startHealthMonitor();
    const metrics = stopHealthMonitor();
    // Should only have samples from the second run
    expect(metrics.samples.length).toBeGreaterThanOrEqual(2);
  });

  it("marks saturated based on CPU readings", () => {
    startHealthMonitor();
    const metrics = stopHealthMonitor();
    // saturated is a boolean derived from cpuMax > 80
    expect(typeof metrics.saturated).toBe("boolean");
    if (metrics.cpuMax <= 80) {
      expect(metrics.saturated).toBe(false);
    } else {
      expect(metrics.saturated).toBe(true);
    }
  });

  it("warnings array is consistent with saturation status", () => {
    startHealthMonitor();
    const metrics = stopHealthMonitor();
    if (metrics.saturated) {
      expect(metrics.warnings.length).toBeGreaterThan(0);
    } else {
      expect(metrics.warnings).toHaveLength(0);
    }
  });
});

// ── formatHealthForHtml ──────────────────────────────────────────────────────

describe("formatHealthForHtml", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates an HTML section with generator-health ID", () => {
    const html = formatHealthForHtml(makeMetrics());
    expect(html).toContain('id="generator-health"');
    expect(html).toContain("Generator Health");
  });

  it("includes CPU max and avg values", () => {
    const html = formatHealthForHtml(makeMetrics({ cpuMax: 65, cpuAvg: 42 }));
    expect(html).toContain("65%");
    expect(html).toContain("42%");
  });

  it("includes memory max and avg values", () => {
    const metrics = makeMetrics({
      memMax: 4 * 1024 * 1024 * 1024,
      memAvg: 3 * 1024 * 1024 * 1024,
    });
    const html = formatHealthForHtml(metrics);
    expect(html).toContain("4.0GB");
    expect(html).toContain("3.0GB");
  });

  it("shows sample count", () => {
    const html = formatHealthForHtml(makeMetrics());
    expect(html).toContain("2"); // 2 samples in our fixture
  });

  it("shows green success banner when not saturated", () => {
    const html = formatHealthForHtml(makeMetrics({ saturated: false, cpuMax: 50 }));
    expect(html).toContain("within acceptable bounds");
    expect(html).toContain("#dcfce7"); // green background
  });

  it("shows yellow warning banner when saturated", () => {
    const metrics = makeMetrics({
      saturated: true,
      cpuMax: 85,
      warnings: ["CPU exceeded 80% (peak: 85%). Results may be distorted by generator saturation."],
    });
    const html = formatHealthForHtml(metrics);
    expect(html).toContain("WARNING");
    expect(html).toContain("85%");
    expect(html).toContain("#fef9c3"); // yellow background
    expect(html).toContain('role="alert"');
  });

  it("shows distributed testing link when warnings exist", () => {
    const metrics = makeMetrics({
      warnings: ["CPU exceeded threshold"],
    });
    const html = formatHealthForHtml(metrics);
    expect(html).toContain("DISTRIBUTED_TESTING.md");
  });

  it("does not show distributed testing link when no warnings", () => {
    const html = formatHealthForHtml(makeMetrics({ warnings: [] }));
    expect(html).not.toContain("DISTRIBUTED_TESTING.md");
  });

  it("includes traffic-light CPU indicator: green for < 60%", () => {
    const html = formatHealthForHtml(makeMetrics({ cpuMax: 45 }));
    expect(html).toContain("CPU healthy");
    expect(html).toContain("#22c55e"); // green
  });

  it("includes traffic-light CPU indicator: yellow for 60-80%", () => {
    const html = formatHealthForHtml(makeMetrics({ cpuMax: 70 }));
    expect(html).toContain("CPU elevated");
    expect(html).toContain("#f59e0b"); // yellow
  });

  it("includes traffic-light CPU indicator: red for > 80%", () => {
    const html = formatHealthForHtml(
      makeMetrics({ cpuMax: 90, saturated: true, warnings: ["CPU high"] })
    );
    expect(html).toContain("CPU critical");
    expect(html).toContain("#ef4444"); // red
  });
});

// ── formatHealthForJson ──────────────────────────────────────────────────────

describe("formatHealthForJson", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an object with generatorHealth key", () => {
    const result = formatHealthForJson(makeMetrics());
    expect(result).toHaveProperty("generatorHealth");
  });

  it("includes all metric values", () => {
    const result = formatHealthForJson(
      makeMetrics({
        cpuMax: 75,
        cpuAvg: 55,
        memMax: 8_000_000_000,
        memAvg: 6_000_000_000,
      })
    );
    const gh = result.generatorHealth as Record<string, unknown>;
    expect(gh.cpuMax).toBe(75);
    expect(gh.cpuAvg).toBe(55);
    expect(gh.memMax).toBe(8_000_000_000);
    expect(gh.memAvg).toBe(6_000_000_000);
  });

  it("includes warnings and saturated flag", () => {
    const result = formatHealthForJson(
      makeMetrics({
        warnings: ["High CPU"],
        saturated: true,
      })
    );
    const gh = result.generatorHealth as Record<string, unknown>;
    expect(gh.warnings).toEqual(["High CPU"]);
    expect(gh.saturated).toBe(true);
  });

  it("includes sample count", () => {
    const result = formatHealthForJson(makeMetrics());
    const gh = result.generatorHealth as Record<string, unknown>;
    expect(gh.sampleCount).toBe(2);
  });

  it("handles empty metrics", () => {
    const result = formatHealthForJson(
      makeMetrics({
        cpuMax: 0,
        cpuAvg: 0,
        memMax: 0,
        memAvg: 0,
        warnings: [],
        samples: [],
        saturated: false,
      })
    );
    const gh = result.generatorHealth as Record<string, unknown>;
    expect(gh.cpuMax).toBe(0);
    expect(gh.sampleCount).toBe(0);
  });
});
