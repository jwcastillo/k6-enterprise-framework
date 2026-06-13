/**
 * Scalability Calculator (T-187)
 *
 * Calculates 20 SCALE metrics (CHK-API-370 to CHK-API-389):
 * - Linear scalability index (Amdahl's Law proxy)
 * - Throughput and latency at 2×/5×/10× baseline load
 * - Throughput efficiency (RPS per VU)
 * - Request amplification factor
 * - Latency degradation curve (slope of p95 vs VU)
 * - Throughput ceiling detection
 * - Efficiency ratio over load stages
 *
 * Most scalability metrics require multi-run data in externalMetrics
 * (one run at baseline, one at 2×, etc.). When only k6 single-run data
 * is available, intra-run stage analysis is performed where possible.
 */

import {
  MetricsCalculator,
  MetricsEngineInput,
  MetricResult,
  k6Stat,
  linearRegressionSlope,
} from "../types";
import { avg, m, na, percentile } from "./_helpers";

const CAT = "scalability" as const;

export class ScalabilityCalculator implements MetricsCalculator {
  readonly category = CAT;

  calculate(input: MetricsEngineInput): MetricResult[] {
    const { k6Metrics, externalMetrics = {}, durationMs, vusMax } = input;
    const results: MetricResult[] = [];

    const durationSec = durationMs / 1000;

    // k6 native baseline metrics
    const totalReqs = k6Stat(k6Metrics, "http_reqs", "count");
    const baselineRPS = durationSec > 0 ? totalReqs / durationSec : 0;
    const p95Base = k6Stat(k6Metrics, "http_req_duration", "p(95)");
    const _p99Base = k6Stat(k6Metrics, "http_req_duration", "p(99)");
    const _errorRate = k6Stat(k6Metrics, "http_req_failed", "rate") * 100;

    // ── Single-run derived scalability ────────────────────────────────────────

    // RPS per VU (efficiency): how well the system uses each VU
    const rpsPerVU = vusMax > 0 ? baselineRPS / vusMax : 0;
    results.push(
      m(
        "SCALE-001",
        "RPS per VU (Throughput Efficiency)",
        CAT,
        parseFloat(rpsPerVU.toFixed(3)),
        "RPS/VU",
        "> 0.1",
        `${baselineRPS.toFixed(1)} RPS / ${vusMax} VUs = ${rpsPerVU.toFixed(3)} RPS/VU. Low efficiency = VU time wasted in wait/think time or connection queuing`
      )
    );

    // Concurrency efficiency (Little's Law: N = λ × W)
    const avgDuration = k6Stat(k6Metrics, "http_req_duration", "avg") / 1000; // convert to seconds
    const littlesN = baselineRPS * avgDuration; // estimated concurrency
    const concurrencyEff = vusMax > 0 ? (littlesN / vusMax) * 100 : 0;
    results.push(
      m(
        "SCALE-002",
        "Concurrency Efficiency (%)",
        CAT,
        parseFloat(concurrencyEff.toFixed(1)),
        "%",
        "> 60",
        `Little's Law: effective concurrency = ${littlesN.toFixed(1)} / ${vusMax} VUs = ${concurrencyEff.toFixed(1)}%. Low = VUs idle (think time, slow k6 scenario, or scheduling overhead)`
      )
    );

    // Latency-to-load ratio (p95 / VU count) — lower is better per VU
    const latPerVU = vusMax > 0 ? p95Base / vusMax : p95Base;
    results.push(
      m(
        "SCALE-003",
        "Latency per VU (p95/VU)",
        CAT,
        parseFloat(latPerVU.toFixed(2)),
        "ms/VU",
        "< 20",
        `p95 latency divided by VU count. Indicates per-VU cost on the SUT`
      )
    );

    // ── Intra-run stage-based scalability (requires VU ramp stages) ────────────
    const vuStageSeries = externalMetrics["vus_active"] ?? [];
    const rpsIntraSeries = externalMetrics["http_reqs_rate"] ?? [];
    const p95IntraSeries = externalMetrics["http_req_duration_p95"] ?? [];

    if (vuStageSeries.length >= 6 && rpsIntraSeries.length >= 6 && p95IntraSeries.length >= 6) {
      const n = Math.min(vuStageSeries.length, rpsIntraSeries.length, p95IntraSeries.length);

      // Align series by index
      const midpoint = Math.floor(n / 2);
      const earlyRPS = avg(rpsIntraSeries.slice(0, Math.floor(n / 4)).map((p) => p.value));
      const peakRPS = Math.max(...rpsIntraSeries.map((p) => p.value));
      const lateRPS = avg(rpsIntraSeries.slice(-Math.floor(n / 4)).map((p) => p.value));

      const earlyVU = avg(vuStageSeries.slice(0, Math.floor(n / 4)).map((p) => p.value));
      const peakVU = Math.max(...vuStageSeries.map((p) => p.value));

      // Throughput gain when VUs doubled (approximate)
      const _vuAtMidRPS = avg(rpsIntraSeries.slice(midpoint - 2, midpoint + 2).map((p) => p.value));
      const _vuAtMidVU = avg(vuStageSeries.slice(midpoint - 2, midpoint + 2).map((p) => p.value));

      const throughputGainRatio = earlyRPS > 0 ? peakRPS / earlyRPS : 1;
      const vuLoadRatio = earlyVU > 0 ? peakVU / earlyVU : 1;
      const linearityIndex = vuLoadRatio > 1 ? throughputGainRatio / vuLoadRatio : 1;

      results.push(
        m(
          "SCALE-004",
          "Throughput Linearity Index",
          CAT,
          parseFloat(linearityIndex.toFixed(3)),
          "ratio",
          "> 0.7",
          `RPS gain / VU increase ratio. 1.0 = perfect linear scaling, <0.7 = sub-linear (resource contention). Value: ${linearityIndex.toFixed(2)}`
        ),
        m(
          "SCALE-005",
          "Throughput at Peak VU (RPS)",
          CAT,
          parseFloat(peakRPS.toFixed(1)),
          "RPS",
          undefined,
          `Maximum RPS observed during test. VU range: ${earlyVU.toFixed(0)} → ${peakVU.toFixed(0)}`
        ),
        m(
          "SCALE-006",
          "Throughput Ceiling Detected",
          CAT,
          lateRPS < peakRPS * 0.9 ? 1 : 0,
          "bool",
          "== 0",
          lateRPS < peakRPS * 0.9
            ? `Throughput ceiling detected: late RPS ${lateRPS.toFixed(1)} < 90% of peak ${peakRPS.toFixed(1)}`
            : `No throughput ceiling — SUT maintained peak throughput`
        )
      );

      // Latency degradation slope (p95 vs VU count regression)
      const latVUPoints = vuStageSeries
        .slice(0, Math.min(vuStageSeries.length, p95IntraSeries.length))
        .map((vu, i) => ({ x: vu.value, y: p95IntraSeries[i]?.value ?? 0 }));
      const latSlope = linearRegressionSlope(latVUPoints);

      results.push(
        m(
          "SCALE-007",
          "Latency Degradation Slope (ms/VU)",
          CAT,
          parseFloat(latSlope.toFixed(3)),
          "ms/VU",
          "< 5",
          `Rate of p95 latency increase per additional VU. ${latSlope.toFixed(2)} ms/VU — ${latSlope > 5 ? "significant contention" : "acceptable scaling"}`
        )
      );

      // Throughput efficiency at peak vs early
      const peakEfficiency = peakVU > 0 ? peakRPS / peakVU : 0;
      const earlyEfficiency = earlyVU > 0 ? earlyRPS / earlyVU : 0;
      const efficiencyDrop =
        earlyEfficiency > 0 ? ((earlyEfficiency - peakEfficiency) / earlyEfficiency) * 100 : 0;

      results.push(
        m(
          "SCALE-008",
          "Throughput Efficiency Drop at Peak (%)",
          CAT,
          parseFloat(efficiencyDrop.toFixed(1)),
          "%",
          "< 30",
          `RPS/VU drop from low load to peak load. ${earlyEfficiency.toFixed(3)} → ${peakEfficiency.toFixed(3)} RPS/VU (${efficiencyDrop.toFixed(1)}% drop)`
        )
      );
    } else {
      results.push(
        na(
          "SCALE-004",
          "Throughput Linearity Index",
          CAT,
          "ratio",
          "Requires vus_active + http_reqs_rate time-series with ≥6 data points"
        ),
        na(
          "SCALE-005",
          "Throughput at Peak VU",
          CAT,
          "RPS",
          "Requires vus_active + http_reqs_rate time-series in externalMetrics"
        ),
        na(
          "SCALE-006",
          "Throughput Ceiling Detected",
          CAT,
          "bool",
          "Requires http_reqs_rate time-series in externalMetrics"
        ),
        na(
          "SCALE-007",
          "Latency Degradation Slope",
          CAT,
          "ms/VU",
          "Requires vus_active + http_req_duration_p95 time-series in externalMetrics"
        ),
        na(
          "SCALE-008",
          "Throughput Efficiency Drop",
          CAT,
          "%",
          "Requires vus_active + http_reqs_rate time-series in externalMetrics"
        )
      );
    }

    // ── Multi-run comparison (requires scalability_runs in externalMetrics) ────
    // Format: externalMetrics["scalability_runs"] = [{ts: vuCount, value: rps}, ...]
    //         externalMetrics["scalability_p95"]  = [{ts: vuCount, value: p95ms}, ...]
    const scaleRunsRPS = externalMetrics["scalability_runs_rps"] ?? [];
    const scaleRunsP95 = externalMetrics["scalability_runs_p95"] ?? [];

    if (scaleRunsRPS.length >= 2) {
      // Sort by VU count (ts field used as VU count for multi-run data)
      const sorted = [...scaleRunsRPS].sort((a, b) => a.ts - b.ts);
      const baseVU = sorted[0].ts;
      const baseRPS = sorted[0].value;

      // 2× scaling
      const run2x = sorted.find((r) => r.ts >= baseVU * 1.8 && r.ts <= baseVU * 2.5);
      if (run2x) {
        const expectedRPS2x = baseRPS * 2;
        const actual2x = run2x.value;
        const eff2x = expectedRPS2x > 0 ? (actual2x / expectedRPS2x) * 100 : 0;
        results.push(
          m(
            "SCALE-009",
            "Throughput at 2× Load (% of expected)",
            CAT,
            parseFloat(eff2x.toFixed(1)),
            "%",
            "> 80",
            `At 2× VUs (${run2x.ts} VUs): actual ${actual2x.toFixed(1)} RPS vs expected ${expectedRPS2x.toFixed(1)} RPS = ${eff2x.toFixed(0)}% efficiency`
          )
        );
      } else {
        results.push(
          na(
            "SCALE-009",
            "Throughput at 2× Load",
            CAT,
            "%",
            "No 2× load run found in scalability_runs_rps (ts values should be VU counts)"
          )
        );
      }

      // 5× scaling
      const run5x = sorted.find((r) => r.ts >= baseVU * 4.5 && r.ts <= baseVU * 6);
      if (run5x) {
        const expectedRPS5x = baseRPS * 5;
        const actual5x = run5x.value;
        const eff5x = expectedRPS5x > 0 ? (actual5x / expectedRPS5x) * 100 : 0;
        results.push(
          m(
            "SCALE-010",
            "Throughput at 5× Load (% of expected)",
            CAT,
            parseFloat(eff5x.toFixed(1)),
            "%",
            "> 60",
            `At 5× VUs (${run5x.ts} VUs): actual ${actual5x.toFixed(1)} RPS vs expected ${expectedRPS5x.toFixed(1)} RPS = ${eff5x.toFixed(0)}% efficiency`
          )
        );
      } else {
        results.push(
          na(
            "SCALE-010",
            "Throughput at 5× Load",
            CAT,
            "%",
            "No 5× load run found in scalability_runs_rps"
          )
        );
      }

      // 10× scaling
      const run10x = sorted.find((r) => r.ts >= baseVU * 9 && r.ts <= baseVU * 12);
      if (run10x) {
        const expectedRPS10x = baseRPS * 10;
        const actual10x = run10x.value;
        const eff10x = expectedRPS10x > 0 ? (actual10x / expectedRPS10x) * 100 : 0;
        results.push(
          m(
            "SCALE-011",
            "Throughput at 10× Load (% of expected)",
            CAT,
            parseFloat(eff10x.toFixed(1)),
            "%",
            "> 40",
            `At 10× VUs (${run10x.ts} VUs): actual ${actual10x.toFixed(1)} RPS vs expected ${expectedRPS10x.toFixed(1)} RPS = ${eff10x.toFixed(0)}% efficiency`
          )
        );
      } else {
        results.push(
          na(
            "SCALE-011",
            "Throughput at 10× Load",
            CAT,
            "%",
            "No 10× load run found in scalability_runs_rps"
          )
        );
      }

      // Amdahl's Law fit (estimate serial fraction)
      if (sorted.length >= 3) {
        // Amdahl: Speedup(N) = 1 / (s + (1-s)/N)
        // Rearranged: s ≈ (N × baseRPS - actual) / ((N-1) × actual)  (approximate)
        const serialFractions = sorted
          .slice(1)
          .map((r) => {
            const N = r.ts / baseVU;
            const S = r.value / baseRPS; // actual speedup
            return N > 1 && S > 0 ? (N - N * S) / (N - 1) : null;
          })
          .filter((v): v is number => v !== null && v >= 0 && v <= 1);

        if (serialFractions.length > 0) {
          const serialFrac = avg(serialFractions);
          const maxSpeedup = serialFrac < 1 ? 1 / serialFrac : Infinity;
          results.push(
            m(
              "SCALE-012",
              "Amdahl Serial Fraction (estimated)",
              CAT,
              parseFloat(serialFrac.toFixed(3)),
              "fraction",
              "< 0.2",
              `Estimated serial (non-parallelizable) fraction of workload. Serial=${serialFrac.toFixed(3)} → theoretical max speedup = ${isFinite(maxSpeedup) ? maxSpeedup.toFixed(1) + "×" : "∞"}`
            )
          );
        } else {
          results.push(
            na(
              "SCALE-012",
              "Amdahl Serial Fraction",
              CAT,
              "fraction",
              "Could not compute: speedup data required from scalability_runs_rps"
            )
          );
        }
      } else {
        results.push(
          na(
            "SCALE-012",
            "Amdahl Serial Fraction",
            CAT,
            "fraction",
            "Requires ≥3 data points in scalability_runs_rps"
          )
        );
      }
    } else {
      results.push(
        na(
          "SCALE-009",
          "Throughput at 2× Load",
          CAT,
          "%",
          "Requires scalability_runs_rps in externalMetrics [{ts:vuCount, value:rps}]"
        ),
        na(
          "SCALE-010",
          "Throughput at 5× Load",
          CAT,
          "%",
          "Requires scalability_runs_rps in externalMetrics"
        ),
        na(
          "SCALE-011",
          "Throughput at 10× Load",
          CAT,
          "%",
          "Requires scalability_runs_rps in externalMetrics"
        ),
        na(
          "SCALE-012",
          "Amdahl Serial Fraction",
          CAT,
          "fraction",
          "Requires ≥3 data points in scalability_runs_rps"
        )
      );
    }

    // Latency at scaled loads (from multi-run p95 data)
    if (scaleRunsP95.length >= 2) {
      const sortedP95 = [...scaleRunsP95].sort((a, b) => a.ts - b.ts);
      const baseVU = sortedP95[0].ts;
      const baseP95 = sortedP95[0].value;

      const run2xP95 = sortedP95.find((r) => r.ts >= baseVU * 1.8 && r.ts <= baseVU * 2.5);
      const run10xP95 = sortedP95.find((r) => r.ts >= baseVU * 9 && r.ts <= baseVU * 12);

      if (run2xP95) {
        const latGrowth2x = baseP95 > 0 ? ((run2xP95.value - baseP95) / baseP95) * 100 : 0;
        results.push(
          m(
            "SCALE-013",
            "p95 Latency Growth at 2× Load (%)",
            CAT,
            parseFloat(latGrowth2x.toFixed(1)),
            "%",
            "< 50",
            `At 2× VUs: p95 = ${run2xP95.value.toFixed(0)}ms vs baseline ${baseP95.toFixed(0)}ms (+${latGrowth2x.toFixed(0)}%)`
          )
        );
      } else {
        results.push(
          na(
            "SCALE-013",
            "p95 Latency Growth at 2× Load",
            CAT,
            "%",
            "No 2× load run in scalability_runs_p95"
          )
        );
      }

      if (run10xP95) {
        const latGrowth10x = baseP95 > 0 ? ((run10xP95.value - baseP95) / baseP95) * 100 : 0;
        results.push(
          m(
            "SCALE-014",
            "p95 Latency Growth at 10× Load (%)",
            CAT,
            parseFloat(latGrowth10x.toFixed(1)),
            "%",
            "< 200",
            `At 10× VUs: p95 = ${run10xP95.value.toFixed(0)}ms vs baseline ${baseP95.toFixed(0)}ms (+${latGrowth10x.toFixed(0)}%)`
          )
        );
      } else {
        results.push(
          na(
            "SCALE-014",
            "p95 Latency Growth at 10× Load",
            CAT,
            "%",
            "No 10× load run in scalability_runs_p95"
          )
        );
      }
    } else {
      results.push(
        na(
          "SCALE-013",
          "p95 Latency Growth at 2× Load",
          CAT,
          "%",
          "Requires scalability_runs_p95 in externalMetrics"
        ),
        na(
          "SCALE-014",
          "p95 Latency Growth at 10× Load",
          CAT,
          "%",
          "Requires scalability_runs_p95 in externalMetrics"
        )
      );
    }

    // ── Infrastructure auto-scaling ────────────────────────────────────────────
    const autoScaleLatSeries = externalMetrics["autoscale_provision_sec"] ?? [];
    const autoScalePodsSeries = externalMetrics["autoscale_pods_added"] ?? [];

    if (autoScaleLatSeries.length > 0) {
      const provisionP95 = percentile(
        autoScaleLatSeries.map((p) => p.value),
        95
      );
      results.push(
        m(
          "SCALE-015",
          "Auto-Scale Provision Time — p95 (s)",
          CAT,
          parseFloat(provisionP95.toFixed(0)),
          "s",
          "< 120",
          `p95 time from scale trigger to new instance being ready to serve traffic`
        )
      );
    } else {
      results.push(
        na(
          "SCALE-015",
          "Auto-Scale Provision Time",
          CAT,
          "s",
          "Requires autoscale_provision_sec time-series (HPA event timestamps vs pod ready timestamps from K8s events API)"
        )
      );
    }

    if (autoScalePodsSeries.length > 0) {
      const totalAdded = autoScalePodsSeries.reduce((s, p) => s + p.value, 0);
      results.push(
        m(
          "SCALE-016",
          "Auto-Scale Events — Pods Added",
          CAT,
          totalAdded,
          "pods",
          undefined,
          `Total pods added by auto-scaling during the test. Indicates scaling activity`
        )
      );
    } else {
      results.push(
        na(
          "SCALE-016",
          "Auto-Scale Pods Added",
          CAT,
          "pods",
          "Requires autoscale_pods_added time-series from K8s HPA events"
        )
      );
    }

    // ── Request amplification (fan-out) ───────────────────────────────────────
    const iterations = k6Stat(k6Metrics, "iterations", "count");
    const amplification = iterations > 0 ? totalReqs / iterations : 1;
    results.push(
      m(
        "SCALE-017",
        "Request Amplification Factor",
        CAT,
        parseFloat(amplification.toFixed(2)),
        "req/iter",
        "< 20",
        `Average requests per iteration. Factor > 1 indicates fan-out (microservices, retries, redirects). ${amplification.toFixed(2)}× amplification`
      )
    );

    // ── Cost efficiency ────────────────────────────────────────────────────────
    results.push(
      na(
        "SCALE-018",
        "Cost per 1000 Requests",
        CAT,
        "USD/1k",
        "Requires infrastructure cost data (cloud billing API or manual configuration)"
      ),
      na(
        "SCALE-019",
        "Resource Cost Efficiency Score",
        CAT,
        "score",
        "Requires cost + performance data from multiple load levels"
      ),
      na(
        "SCALE-020",
        "Break-Even Load Point",
        CAT,
        "RPS",
        "Requires cost curve data for cost-to-performance ratio analysis"
      )
    );

    return results;
  }
}
