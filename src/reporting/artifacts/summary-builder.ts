/**
 * Phase 6 / DX-06 — summary-builder.
 *
 * Pure aggregation of a raw k6 summary JSON into the `BuiltSummary` shape
 * consumed by every downstream artifact module (HTML banner, CSV writer,
 * analysis MD, message MD). Extracted verbatim from the legacy
 * `bin/generate-artifacts.js` to preserve observable CLI parity (D-20).
 *
 * No fs, no Date.now, no random — deterministic for any given input.
 */

import type { BuiltSummary, K6MetricEntry, K6Summary } from "./types";
import { SLA_DEFAULTS } from "./types";

/**
 * Aggregate a raw k6 summary into a `BuiltSummary`.
 *
 * @example
 * const summary: K6Summary = JSON.parse(fs.readFileSync("summary.json", "utf8"));
 * const built = buildSummary(summary);
 * if (!built.sla.pass) console.error(built.sla.violations);
 */
export function buildSummary(summary: K6Summary): BuiltSummary {
  const metrics = (summary.metrics ?? {}) as Record<string, K6MetricEntry>;

  const dur = metrics["http_req_duration"] ?? ({} as K6MetricEntry);
  const reqs = metrics["http_reqs"] ?? ({} as K6MetricEntry);
  const failed = metrics["http_req_failed"] ?? ({} as K6MetricEntry);
  const chk = metrics["checks"] ?? ({} as K6MetricEntry);
  const itr = metrics["iterations"] ?? ({} as K6MetricEntry);
  const vus = metrics["vus_max"] ?? ({} as K6MetricEntry);

  // ── Checks aggregation ─────────────────────────────────────────────────────
  const pass = chk.passes ?? 0;
  const fail = chk.fails ?? 0;
  const total = pass + fail;
  const checkRate = total > 0 ? (pass / total) * 100 : 0;

  // ── Latency percentiles ────────────────────────────────────────────────────
  const avgMs = dur.avg ?? null;
  const minMs = dur.min ?? null;
  const p50Ms = dur.med ?? null;
  const p90Ms = dur["p(90)"] ?? null;
  const p95Ms = dur["p(95)"] ?? null;
  const p99Ms = dur["p(99)"] ?? null;
  const maxMs = dur.max ?? null;

  // ── Error rate (k6 emits as 0..1 fraction in `value`; convert to percent) ──
  const errorRatePct = failed.value !== undefined ? failed.value * 100 : null;

  // ── SLA evaluation ─────────────────────────────────────────────────────────
  const slaP95Ok = p95Ms !== null ? p95Ms < SLA_DEFAULTS.p95Ms : null;
  const slaP99Ok = p99Ms !== null ? p99Ms < SLA_DEFAULTS.p99Ms : null;
  const slaErrOk = errorRatePct !== null ? errorRatePct < SLA_DEFAULTS.errorRatePct : null;
  const slaChkOk = checkRate >= SLA_DEFAULTS.checksPct;

  const violations: string[] = [];
  if (slaP95Ok === false && p95Ms !== null) {
    violations.push(`p95 ${p95Ms.toFixed(0)}ms > ${SLA_DEFAULTS.p95Ms}ms SLA`);
  }
  if (slaP99Ok === false && p99Ms !== null) {
    violations.push(`p99 ${p99Ms.toFixed(0)}ms > ${SLA_DEFAULTS.p99Ms}ms SLA`);
  }
  if (slaErrOk === false && errorRatePct !== null) {
    violations.push(
      `Error rate ${errorRatePct.toFixed(2)}% > ${SLA_DEFAULTS.errorRatePct}% SLA`
    );
  }
  if (!slaChkOk) {
    violations.push(`Checks ${checkRate.toFixed(1)}% < ${SLA_DEFAULTS.checksPct}% SLA`);
  }
  const slaPass = violations.length === 0;

  // ── APDEX (preserved verbatim from monolith — quirky formula but stable) ──
  let apdexScore: number | null = null;
  let apdexLabel = "N/A";
  let apdexColor = "#6b7280";
  if (p50Ms !== null && p90Ms !== null && p99Ms !== null) {
    const satFraction = p50Ms < SLA_DEFAULTS.apdexT ? 0.5 : 0;
    const satFraction2 = p90Ms < SLA_DEFAULTS.apdexT ? 0.4 : 0;
    const tolFraction =
      p90Ms >= SLA_DEFAULTS.apdexT && p90Ms < SLA_DEFAULTS.apdexF ? 0.4 : 0;
    const tolFraction2 =
      p99Ms >= SLA_DEFAULTS.apdexT && p99Ms < SLA_DEFAULTS.apdexF ? 0.09 : 0;
    const satisfied = satFraction + satFraction2;
    const tolerating = tolFraction + tolFraction2;
    apdexScore = parseFloat((satisfied + tolerating / 2).toFixed(2));
    if (apdexScore >= 0.94) {
      apdexLabel = "Excellent";
      apdexColor = "#16a34a";
    } else if (apdexScore >= 0.85) {
      apdexLabel = "Good";
      apdexColor = "#2563eb";
    } else if (apdexScore >= 0.7) {
      apdexLabel = "Fair";
      apdexColor = "#d97706";
    } else if (apdexScore >= 0.5) {
      apdexLabel = "Poor";
      apdexColor = "#ea580c";
    } else {
      apdexLabel = "Unacceptable";
      apdexColor = "#dc2626";
    }
  }

  return {
    metrics,
    checks: { pass, fail, total, rate: checkRate },
    latency: { avgMs, minMs, p50Ms, p90Ms, p95Ms, p99Ms, maxMs },
    errorRatePct,
    maxVus: vus.max ?? null,
    http: {
      totalRequests: reqs.count ?? null,
      ratePerSec: reqs.rate ?? null,
    },
    iterations: itr.count ?? null,
    apdex: { score: apdexScore, label: apdexLabel, color: apdexColor },
    sla: {
      p95Ok: slaP95Ok,
      p99Ok: slaP99Ok,
      errorRateOk: slaErrOk,
      checksOk: slaChkOk,
      pass: slaPass,
      violations,
    },
  };
}
