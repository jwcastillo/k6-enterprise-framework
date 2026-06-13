/**
 * Metrics Engine — Core Orchestrator (T-180)
 *
 * Central pipeline: collect → calculate → threshold-check → report.
 * Calculators register themselves per domain and are executed in order.
 *
 * Usage:
 *   const engine = new MetricsEngine();
 *   engine.register(new PerformanceCalculator());
 *   engine.register(new ThroughputCalculator());
 *   const report = engine.calculate(input);
 */

import {
  MetricsCalculator,
  MetricsEngineInput,
  MetricsReport,
  MetricResult,
  MetricCategory,
  K6MetricsMap,
  ExternalMetrics,
  SlaSloConfig,
  ChaosEngineConfig,
} from "./types";
import { scoreFromCounts } from "./score";

// ── Metrics Engine ────────────────────────────────────────────────────────────
// (A standalone PrometheusClient previously lived here; the canonical client is
//  now ai/observability/observability-clients.ts::PrometheusClient, which uses
//  observability/http-safe.ts::fetchSafe and returns the unified
//  ObservabilityResult schema. The old class had no in-tree callers.)

/**
 * T-180: Central metrics orchestrator.
 */
export class MetricsEngine {
  private readonly calculators: MetricsCalculator[] = [];

  /**
   * Register a domain calculator.
   * Calculators execute in registration order.
   */
  register(calculator: MetricsCalculator): this {
    this.calculators.push(calculator);
    return this;
  }

  /**
   * Run all registered calculators and produce a unified MetricsReport.
   *
   * @param input   - Engine input (k6 metrics + external metrics + context)
   * @param domains - Optional domain filter, e.g. ["performance","error","sla"].
   *                  Accepts the same values as MetricCategory. If omitted or
   *                  empty, all registered calculators run.
   *                  CLI equivalent: --metrics=performance,error,sla
   */
  calculate(input: MetricsEngineInput, domains?: MetricCategory[]): MetricsReport {
    const filter = domains && domains.length > 0 ? new Set(domains) : null;
    const all: MetricResult[] = [];

    for (const calc of this.calculators) {
      if (filter && !filter.has(calc.category)) continue;
      try {
        const results = calc.calculate(input);
        all.push(...results);
      } catch (err) {
        console.warn(
          `[metrics-engine] Calculator '${calc.category}' threw: ${(err as Error).message}`
        );
      }
    }

    const byCategory: Partial<Record<MetricCategory, MetricResult[]>> = {};
    for (const result of all) {
      (byCategory[result.category] ??= []).push(result);
    }

    const summary = {
      total: all.length,
      pass: all.filter((r) => r.status === "pass").length,
      warn: all.filter((r) => r.status === "warn").length,
      fail: all.filter((r) => r.status === "fail").length,
      na: all.filter((r) => r.status === "na").length,
    };

    // Derive GPT-inspired overall score from pass/warn/fail counts (na excluded).
    const score = scoreFromCounts(summary);

    return {
      generatedAt: new Date().toISOString(),
      durationMs: input.durationMs,
      byCategory,
      all,
      summary,
      score,
    };
  }

  /**
   * Parse the `--metrics=<csv>` CLI argument into a MetricCategory array.
   *
   * @example
   *   MetricsEngine.parseDomainsArg("performance,error,sla")
   *   // → ["performance", "error", "sla"]
   *
   * Unknown domain names are silently dropped.
   * Returns undefined (= run all) when the string is empty or "--metrics=all".
   */
  static parseDomainsArg(csv: string | undefined): MetricCategory[] | undefined {
    if (!csv || csv === "all") return undefined;
    const VALID: MetricCategory[] = [
      "performance",
      "throughput",
      "error",
      "saturation",
      "sla",
      "stability",
      "scalability",
      "chaos",
      "security",
      "observability",
      "data-integrity",
    ];
    const parsed = csv
      .split(",")
      .map((s) => s.trim().toLowerCase() as MetricCategory)
      .filter((s) => VALID.includes(s));
    return parsed.length > 0 ? parsed : undefined;
  }

  /**
   * Convenience: build engine with all P1 calculators pre-registered.
   */
  static withP1Calculators(): MetricsEngine {
    // Lazy imports to avoid circular deps

    const { PerformanceCalculator } = require("./calculators/performance-calculator");

    const { ThroughputCalculator } = require("./calculators/throughput-calculator");

    const { ErrorCalculator } = require("./calculators/error-calculator");

    const { SlaCalculator } = require("./calculators/sla-calculator");

    return new MetricsEngine()
      .register(new PerformanceCalculator())
      .register(new ThroughputCalculator())
      .register(new ErrorCalculator())
      .register(new SlaCalculator());
  }

  /**
   * Convenience: build engine with all P1 + P2 calculators pre-registered.
   * Covers all 233 metrics across 11 domains.
   */
  static withAllCalculators(): MetricsEngine {
    // P1 calculators

    const { PerformanceCalculator } = require("./calculators/performance-calculator");

    const { ThroughputCalculator } = require("./calculators/throughput-calculator");

    const { ErrorCalculator } = require("./calculators/error-calculator");

    const { SlaCalculator } = require("./calculators/sla-calculator");

    // P2 calculators

    const { SaturationCalculator } = require("./calculators/saturation-calculator");

    const { StabilityCalculator } = require("./calculators/stability-calculator");

    const { ScalabilityCalculator } = require("./calculators/scalability-calculator");

    const { ChaosCalculator } = require("./calculators/chaos-calculator");

    const { SecurityCalculator } = require("./calculators/security-calculator");

    const { ObservabilityCalculator } = require("./calculators/observability-calculator");

    const { DataIntegrityCalculator } = require("./calculators/data-integrity-calculator");

    return (
      new MetricsEngine()
        // P1 — core performance domains
        .register(new PerformanceCalculator())
        .register(new ThroughputCalculator())
        .register(new ErrorCalculator())
        .register(new SlaCalculator())
        // P2 — extended analysis domains
        .register(new SaturationCalculator())
        .register(new StabilityCalculator())
        .register(new ScalabilityCalculator())
        .register(new ChaosCalculator())
        .register(new SecurityCalculator())
        .register(new ObservabilityCalculator())
        .register(new DataIntegrityCalculator())
    );
  }
}

// ── Factory helpers ───────────────────────────────────────────────────────────

/**
 * Build a MetricsEngineInput from k6 handleSummary data + context.
 */
export function buildMetricsInput(
  data: Record<string, unknown>,
  context: {
    client: string;
    environment: string;
    profile: string;
    testName: string;
    startTime: string;
  },
  opts: {
    externalMetrics?: ExternalMetrics;
    sloConfig?: SlaSloConfig;
    chaosConfig?: ChaosEngineConfig;
  } = {}
): MetricsEngineInput {
  const k6Metrics = (data["metrics"] as K6MetricsMap) ?? {};
  const durationMs = Date.now() - new Date(context.startTime).getTime();
  const vusMax = k6Metrics["vus_max"]?.values?.["max"] ?? 0;

  return {
    k6Metrics,
    externalMetrics: opts.externalMetrics,
    durationMs,
    vusMax,
    context,
    sloConfig: opts.sloConfig,
    chaosConfig: opts.chaosConfig,
  };
}
