/**
 * SLA Calculator (T-185)
 *
 * Calculates 20 SLA metrics (CHK-API-330 to CHK-API-349):
 * - Availability (request-based and time-based)
 * - Error budget remaining
 * - SLO latency/throughput compliance
 * - Multi-SLI composite score
 * - MTTR, breach duration, breach frequency
 * - Correctness rate, data consistency, idempotency
 */

import {
  MetricsCalculator,
  MetricsEngineInput,
  MetricResult,
  SlaSloConfig,
  k6Stat,
  naMetric,
} from "../types";
import { m } from "./_helpers";

const CAT = "sla" as const;

/** Default SLO config when none provided */
const DEFAULT_SLO: SlaSloConfig = {
  availabilityTarget: 0.999, // 99.9%
  latencyP95TargetMs: 500,
  latencyP99TargetMs: 1000,
  throughputTargetRps: undefined,
  errorBudgetWindowDays: 30,
};

export class SlaCalculator implements MetricsCalculator {
  readonly category = CAT;

  calculate(input: MetricsEngineInput): MetricResult[] {
    const { k6Metrics, externalMetrics, durationMs } = input;
    const slo = { ...DEFAULT_SLO, ...(input.sloConfig ?? {}) };
    const results: MetricResult[] = [];

    const durationSec = durationMs / 1000;
    const totalReqs = k6Stat(k6Metrics, "http_reqs", "count");
    const failedReqs = k6Stat(k6Metrics, "http_req_failed", "passes");
    const checksPasses = k6Stat(k6Metrics, "checks", "passes");
    const checksFails = k6Stat(k6Metrics, "checks", "fails");
    const checksTotal = checksPasses + checksFails;
    const p95 = k6Stat(k6Metrics, "http_req_duration", "p(95)");
    const p99 = k6Stat(k6Metrics, "http_req_duration", "p(99)");
    const rps = durationSec > 0 ? totalReqs / durationSec : 0;

    // ── SLA-001: Request-based availability ───────────────────────────────────
    const successReqs = Math.max(0, totalReqs - failedReqs);
    const availability = totalReqs > 0 ? (successReqs / totalReqs) * 100 : 100;
    const sloAvailPct = slo.availabilityTarget * 100;
    results.push(
      m(
        "SLA-001",
        "Availability — Request-Based",
        CAT,
        parseFloat(availability.toFixed(4)),
        "%",
        `>= ${sloAvailPct.toFixed(3)}`,
        `Successful requests / total requests. SLO target: ${sloAvailPct}%`
      )
    );

    // ── SLA-002: Check-based availability (business correctness) ──────────────
    const checkAvailability = checksTotal > 0 ? (checksPasses / checksTotal) * 100 : 100;
    results.push(
      m(
        "SLA-002",
        "Availability — Check-Based",
        CAT,
        parseFloat(checkAvailability.toFixed(4)),
        "%",
        `>= ${sloAvailPct.toFixed(3)}`,
        `k6 check passes / total checks. Represents business-logic availability`
      )
    );

    // ── SLA-003: Error budget remaining ───────────────────────────────────────
    const errorBudgetPct = (1 - slo.availabilityTarget) * 100; // allowed error %
    const currentErrorPct = 100 - availability;
    const budgetConsumedPct =
      errorBudgetPct > 0 ? Math.min(100, (currentErrorPct / errorBudgetPct) * 100) : 0;
    const budgetRemainingPct = Math.max(0, 100 - budgetConsumedPct);

    results.push(
      m(
        "SLA-003",
        "Error Budget Remaining",
        CAT,
        parseFloat(budgetRemainingPct.toFixed(2)),
        "%",
        ">= 0",
        `SLO=${slo.availabilityTarget * 100}% → error budget=${errorBudgetPct.toFixed(3)}%. Consumed: ${budgetConsumedPct.toFixed(1)}%. Remaining: ${budgetRemainingPct.toFixed(1)}%`
      )
    );

    // Projected monthly budget consumption (extrapolated from test duration)
    const windowDays = slo.errorBudgetWindowDays ?? 30;
    const testDurationDays = durationMs / (1000 * 60 * 60 * 24);
    const projectedBurnRate = testDurationDays > 0 ? budgetConsumedPct / testDurationDays : 0;
    const projectedMonthlyBurn = projectedBurnRate * windowDays;
    results.push(
      m(
        "SLA-004",
        "Projected Monthly Budget Consumption",
        CAT,
        parseFloat(projectedMonthlyBurn.toFixed(2)),
        "%",
        "< 100",
        `At current error rate, ${projectedMonthlyBurn.toFixed(1)}% of the ${windowDays}-day error budget would be consumed`
      )
    );

    // ── SLA-005: p95 Latency SLO compliance ──────────────────────────────────
    const p95Target = slo.latencyP95TargetMs;
    const p95Compliant = p95 <= p95Target;
    results.push(
      m(
        "SLA-005",
        "SLO Latency Compliance — p95",
        CAT,
        parseFloat(p95.toFixed(2)),
        "ms",
        `<= ${p95Target}`,
        `p95 response time vs SLO target of ${p95Target}ms. ${p95Compliant ? "COMPLIANT" : "BREACH"}`
      )
    );

    // ── SLA-006: p99 Latency SLO compliance ──────────────────────────────────
    const p99Target = slo.latencyP99TargetMs ?? p95Target * 2;
    const p99Compliant = p99 <= p99Target;
    results.push(
      m(
        "SLA-006",
        "SLO Latency Compliance — p99",
        CAT,
        parseFloat(p99.toFixed(2)),
        "ms",
        `<= ${p99Target}`,
        `p99 response time vs SLO target of ${p99Target}ms. ${p99Compliant ? "COMPLIANT" : "BREACH"}`
      )
    );

    // ── SLA-007: Throughput SLO compliance ───────────────────────────────────
    if (slo.throughputTargetRps !== undefined) {
      const rpsTarget = slo.throughputTargetRps;
      results.push(
        m(
          "SLA-007",
          "SLO Throughput Compliance — RPS",
          CAT,
          parseFloat(rps.toFixed(2)),
          "RPS",
          `>= ${rpsTarget}`,
          `Achieved ${rps.toFixed(2)} RPS vs SLO target of ${rpsTarget} RPS. ${rps >= rpsTarget ? "COMPLIANT" : "BREACH"}`
        )
      );
    } else {
      results.push(
        naMetric(
          "SLA-007",
          "SLO Throughput Compliance — RPS",
          CAT,
          "RPS",
          "Set sloConfig.throughputTargetRps to enable this check"
        )
      );
    }

    // ── SLA-008: Multi-SLI composite score ───────────────────────────────────
    // Weighted composite: availability (40%) + p95 (35%) + p99 (15%) + check rate (10%)
    const availScore = Math.min(1, availability / sloAvailPct);
    const p95Score = Math.min(1, p95Target / Math.max(1, p95));
    const p99Score = Math.min(1, p99Target / Math.max(1, p99));
    const checkScore = Math.min(1, checkAvailability / sloAvailPct);
    const composite =
      (availScore * 0.4 + p95Score * 0.35 + p99Score * 0.15 + checkScore * 0.1) * 100;
    results.push(
      m(
        "SLA-008",
        "Multi-SLI Composite Score",
        CAT,
        parseFloat(composite.toFixed(2)),
        "%",
        ">= 95",
        `Weighted composite: availability(40%) + p95(35%) + p99(15%) + checks(10%). Score: ${composite.toFixed(1)}%`
      )
    );

    // ── SLA-009: SLA breach proximity ────────────────────────────────────────
    const availBreachProximity = ((sloAvailPct - availability) / sloAvailPct) * 100;
    const latencyBreachProximity = ((p95 - p95Target) / p95Target) * 100;
    results.push(
      m(
        "SLA-009",
        "Availability Breach Proximity",
        CAT,
        parseFloat(Math.abs(Math.min(0, sloAvailPct - availability)).toFixed(4)),
        "pp",
        "< 0.5",
        `${availability >= sloAvailPct ? "Within SLA" : "BREACHING SLA"}. Gap from target: ${Math.abs(availBreachProximity).toFixed(3)}pp`
      ),
      m(
        "SLA-010",
        "Latency Breach Proximity — p95",
        CAT,
        parseFloat(Math.max(0, latencyBreachProximity).toFixed(2)),
        "%",
        "< 10",
        `p95 is ${Math.abs(latencyBreachProximity).toFixed(1)}% ${p95 > p95Target ? "above" : "below"} target. ${p95 > p95Target ? "BREACH" : "WITHIN SLA"}`
      )
    );

    // ── SLA-011: Correctness rate (business check passes) ────────────────────
    const correctnessRate = checksTotal > 0 ? (checksPasses / checksTotal) * 100 : 100;
    results.push(
      m(
        "SLA-011",
        "Correctness Rate",
        CAT,
        parseFloat(correctnessRate.toFixed(4)),
        "%",
        ">= 99",
        `Business check pass rate: ${checksPasses}/${checksTotal} checks passed`
      )
    );

    // ── SLA-012: MTTR from time-series (if available) ────────────────────────
    const sloBreachSeries = externalMetrics?.["slo_breach"] ?? [];
    if (sloBreachSeries.length >= 2) {
      // Calculate MTTR: find breach start/end pairs and average recovery times
      const mttrMs = computeMTTR(sloBreachSeries);
      results.push(
        m(
          "SLA-012",
          "Mean Time To Recovery (MTTR)",
          CAT,
          parseFloat((mttrMs / 1000).toFixed(1)),
          "s",
          "< 60",
          `Average time from SLO breach to recovery. ${mttrMs > 0 ? `MTTR: ${(mttrMs / 1000).toFixed(0)}s` : "No breaches detected"}`
        )
      );

      // Max consecutive breach duration
      const maxBreachMs = maxConsecutiveBreach(sloBreachSeries);
      results.push(
        m(
          "SLA-013",
          "Max Consecutive Breach Duration",
          CAT,
          parseFloat((maxBreachMs / 1000).toFixed(1)),
          "s",
          "< 120",
          `Longest continuous SLO breach: ${(maxBreachMs / 1000).toFixed(0)}s`
        )
      );

      // Breach frequency
      const breachCount = countBreaches(sloBreachSeries);
      const testMinutes = durationMs / 60_000;
      const breachFreq = testMinutes > 0 ? breachCount / testMinutes : 0;
      results.push(
        m(
          "SLA-014",
          "Breach Frequency",
          CAT,
          parseFloat(breachFreq.toFixed(4)),
          "events/min",
          "< 0.1",
          `${breachCount} SLO breach events in ${testMinutes.toFixed(1)} minutes = ${breachFreq.toFixed(3)}/min`
        )
      );
    } else {
      results.push(
        naMetric(
          "SLA-012",
          "Mean Time To Recovery (MTTR)",
          CAT,
          "s",
          "Requires slo_breach time-series in externalMetrics (1=breach, 0=ok)"
        ),
        naMetric(
          "SLA-013",
          "Max Consecutive Breach Duration",
          CAT,
          "s",
          "Requires slo_breach time-series in externalMetrics"
        ),
        naMetric(
          "SLA-014",
          "Breach Frequency",
          CAT,
          "events/min",
          "Requires slo_breach time-series in externalMetrics"
        )
      );
    }

    // ── SLA-015 to SLA-020: Event/deploy uptime (N/A without annotations) ────
    const NA_EVENTS =
      "Requires deploy event annotations (timestamps of deploys, config changes, etc.)";
    results.push(
      naMetric("SLA-015", "Uptime During Deploy", CAT, "%", NA_EVENTS),
      naMetric("SLA-016", "Uptime During Config Change", CAT, "%", NA_EVENTS),
      naMetric(
        "SLA-017",
        "Uptime During Failover",
        CAT,
        "%",
        "Requires failover event timestamps + availability time-series"
      ),
      naMetric(
        "SLA-018",
        "Data Consistency Rate",
        CAT,
        "%",
        "Requires read-after-write consistency check in k6 scenario"
      ),
      naMetric(
        "SLA-019",
        "Idempotency Compliance Rate",
        CAT,
        "%",
        "Requires duplicate-request detection in k6 scenario"
      ),
      naMetric(
        "SLA-020",
        "Request Ordering Compliance",
        CAT,
        "%",
        "Requires sequence validation in k6 scenario (e.g. Kafka ordering check)"
      )
    );

    return results;
  }
}

// ── MTTR helpers ─────────────────────────────────────────────────────────────

function computeMTTR(series: Array<{ ts: number; value: number }>): number {
  const recoveryDurations: number[] = [];
  let breachStart: number | null = null;

  for (const { ts, value } of series) {
    if (value > 0 && breachStart === null) {
      breachStart = ts;
    } else if (value === 0 && breachStart !== null) {
      recoveryDurations.push((ts - breachStart) * 1000);
      breachStart = null;
    }
  }

  if (recoveryDurations.length === 0) return 0;
  return recoveryDurations.reduce((s, d) => s + d, 0) / recoveryDurations.length;
}

function maxConsecutiveBreach(series: Array<{ ts: number; value: number }>): number {
  let maxDuration = 0;
  let breachStart: number | null = null;

  for (const { ts, value } of series) {
    if (value > 0 && breachStart === null) {
      breachStart = ts;
    } else if (value === 0 && breachStart !== null) {
      const duration = (ts - breachStart) * 1000;
      if (duration > maxDuration) maxDuration = duration;
      breachStart = null;
    }
  }
  return maxDuration;
}

function countBreaches(series: Array<{ ts: number; value: number }>): number {
  let count = 0;
  let inBreach = false;
  for (const { value } of series) {
    if (value > 0 && !inBreach) {
      count++;
      inBreach = true;
    } else if (value === 0) {
      inBreach = false;
    }
  }
  return count;
}
