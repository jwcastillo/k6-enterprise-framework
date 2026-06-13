/** SaturationCalculator facade — delegates to dimension-scoped sub-calculators per ARC-07.
 *  Handles VU/Load cross-cutting metrics (SAT-001 to SAT-004) and orchestrates the 5 sub-calculators.
 *  Original: saturation-calculator.ts (1344 LOC, T-184). Split in Phase 4.
 */

import { MetricsCalculator, MetricsEngineInput, MetricResult, k6Stat } from "../../types";
import { avg, m, na } from "../_helpers";
import { CpuSaturationCalculator } from "./cpu-calculator";
import { MemorySaturationCalculator } from "./memory-calculator";
import { IoSaturationCalculator } from "./io-calculator";
import { NetworkSaturationCalculator } from "./network-calculator";
import { ResourceSaturationCalculator } from "./resource-calculator";

export { CpuSaturationCalculator } from "./cpu-calculator";
export { MemorySaturationCalculator } from "./memory-calculator";
export { IoSaturationCalculator } from "./io-calculator";
export { NetworkSaturationCalculator } from "./network-calculator";
export { ResourceSaturationCalculator } from "./resource-calculator";

const CAT = "saturation" as const;

export class SaturationCalculator implements MetricsCalculator {
  readonly category = CAT;

  private readonly cpu = new CpuSaturationCalculator();
  private readonly memory = new MemorySaturationCalculator();
  private readonly io = new IoSaturationCalculator();
  private readonly network = new NetworkSaturationCalculator();
  private readonly resource = new ResourceSaturationCalculator();

  calculate(input: MetricsEngineInput): MetricResult[] {
    const { k6Metrics, externalMetrics = {}, durationMs: _durationMs, vusMax } = input;
    const results: MetricResult[] = [];

    // ── (a) VU / Load saturation — facade-level cross-cutting metrics ─────────
    const vusCurrent = k6Stat(k6Metrics, "vus", "value");
    const vusConfigMax = vusMax;

    results.push(
      m(
        "SAT-001",
        "Peak VU Count",
        CAT,
        vusConfigMax,
        "VUs",
        undefined,
        `Maximum concurrent VUs reached during the test run`
      )
    );

    const vuHeadroom = vusConfigMax > 0 ? ((vusConfigMax - vusCurrent) / vusConfigMax) * 100 : 100;
    results.push(
      m(
        "SAT-002",
        "VU Headroom",
        CAT,
        parseFloat(vuHeadroom.toFixed(1)),
        "%",
        "> 10",
        `Unused VU capacity. Low headroom means the test was near the executor ceiling`
      )
    );

    const iterRateSeries = externalMetrics["iterations_rate"] ?? [];
    if (iterRateSeries.length >= 4) {
      const startAvg = avg(
        iterRateSeries.slice(0, Math.floor(iterRateSeries.length / 4)).map((p) => p.value)
      );
      const endAvg = avg(
        iterRateSeries.slice(-Math.floor(iterRateSeries.length / 4)).map((p) => p.value)
      );
      const drop = startAvg > 0 ? ((startAvg - endAvg) / startAvg) * 100 : 0;
      results.push(
        m(
          "SAT-003",
          "Iteration Rate Drop (end vs start)",
          CAT,
          parseFloat(drop.toFixed(1)),
          "%",
          "< 20",
          `Drop in iteration throughput from first to last quarter. Drop=${drop.toFixed(1)}%. Indicates SUT saturation under sustained load`
        )
      );
    } else {
      results.push(
        na(
          "SAT-003",
          "Iteration Rate Drop",
          CAT,
          "%",
          "Requires iterations_rate time-series in externalMetrics"
        )
      );
    }

    const p95Series = externalMetrics["http_req_duration_p95"] ?? [];
    const reqsSeries = externalMetrics["http_reqs_rate"] ?? [];
    if (p95Series.length >= 4 && reqsSeries.length >= 4) {
      let saturationIdx = -1;
      for (let i = 1; i < p95Series.length; i++) {
        const latencyGrowth =
          p95Series[i - 1].value > 0
            ? (p95Series[i].value - p95Series[i - 1].value) / p95Series[i - 1].value
            : 0;
        const throughputGrowth =
          reqsSeries[i - 1].value > 0
            ? (reqsSeries[i].value - reqsSeries[i - 1].value) / reqsSeries[i - 1].value
            : 0;
        if (latencyGrowth > 0.2 && throughputGrowth < 0.05) {
          saturationIdx = i;
          break;
        }
      }
      const saturationPct = saturationIdx >= 0 ? (saturationIdx / p95Series.length) * 100 : 100;
      results.push(
        m(
          "SAT-004",
          "Saturation Point (% into test)",
          CAT,
          parseFloat(saturationPct.toFixed(1)),
          "%",
          "> 80",
          saturationIdx >= 0
            ? `Saturation detected at ${saturationPct.toFixed(0)}% into the test (latency growing while throughput plateaus)`
            : `No saturation knee detected — SUT handled load without plateauing`
        )
      );
    } else {
      results.push(
        na(
          "SAT-004",
          "Saturation Point",
          CAT,
          "%",
          "Requires http_req_duration_p95 + http_reqs_rate time-series in externalMetrics"
        )
      );
    }

    // ── Delegate to dimension-scoped sub-calculators ───────────────────────────
    results.push(...this.cpu.calculate(input));
    results.push(...this.memory.calculate(input));
    results.push(...this.io.calculate(input));
    results.push(...this.network.calculate(input));
    results.push(...this.resource.calculate(input));

    return results;
  }
}
