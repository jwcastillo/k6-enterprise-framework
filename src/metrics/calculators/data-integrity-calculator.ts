/**
 * Data Integrity Calculator (T-191)
 *
 * Calculates 13 DI metrics (CHK-API-450 to CHK-API-462):
 * - Read-after-write consistency (stale reads under load)
 * - Duplicate request detection
 * - Transaction rollback rate
 * - Data loss events (successful write without confirmable read)
 * - Response schema consistency
 * - Business invariant violation rate
 * - Idempotency correctness
 * - Partial write detection
 * - Counter/balance drift
 * - Event ordering violations
 * - Checksum/hash validation failures
 * - Foreign key / referential integrity violations
 * - Data type coercion errors
 */

import { MetricsCalculator, MetricsEngineInput, MetricResult, k6Stat } from "../types";
import { avg, m, na } from "./_helpers";

const CAT = "data-integrity" as const;

export class DataIntegrityCalculator implements MetricsCalculator {
  readonly category = CAT;

  calculate(input: MetricsEngineInput): MetricResult[] {
    const { k6Metrics, externalMetrics = {}, durationMs: _durationMs } = input;
    const results: MetricResult[] = [];

    const totalReqs = k6Stat(k6Metrics, "http_reqs", "count");
    const iterations = k6Stat(k6Metrics, "iterations", "count");

    // ── Read-after-write consistency ───────────────────────────────────────────
    const rawConsistencySeries = externalMetrics["read_after_write_stale_rate"] ?? [];
    if (rawConsistencySeries.length > 0) {
      const staleRate = avg(rawConsistencySeries.map((p) => p.value));
      results.push(
        m(
          "DI-001",
          "Read-After-Write Stale Rate (%)",
          CAT,
          parseFloat(staleRate.toFixed(3)),
          "%",
          "< 0.1",
          `Percentage of read requests returning stale data immediately after a write. Indicates eventual consistency lag under load`
        )
      );
    } else {
      results.push(
        na(
          "DI-001",
          "Read-After-Write Stale Rate",
          CAT,
          "%",
          "Requires read_after_write_stale_rate counter in k6 scenario: write resource → immediately read → check written vs read value"
        )
      );
    }

    // ── Duplicate detection ────────────────────────────────────────────────────
    const duplicateSeries = externalMetrics["duplicate_write_events"] ?? [];
    if (duplicateSeries.length > 0) {
      const duplicates = duplicateSeries.reduce((s, p) => s + p.value, 0);
      const dupRate = totalReqs > 0 ? (duplicates / totalReqs) * 100 : 0;
      results.push(
        m(
          "DI-002",
          "Duplicate Write Event Rate (%)",
          CAT,
          parseFloat(dupRate.toFixed(4)),
          "%",
          "< 0.01",
          `Write operations that created duplicate records. ${duplicates} duplicate events — indicates missing idempotency keys or retry storms creating phantom writes`
        )
      );
    } else {
      results.push(
        na(
          "DI-002",
          "Duplicate Write Event Rate",
          CAT,
          "%",
          "Requires duplicate_write_events counter from application logic (check DB for duplicate IDs after test, or use application-level idempotency tracking)"
        )
      );
    }

    // ── Transaction integrity ──────────────────────────────────────────────────
    const txRollbackSeries = externalMetrics["transaction_rollback_count"] ?? [];
    if (txRollbackSeries.length > 0) {
      const rollbacks = txRollbackSeries.reduce((s, p) => s + p.value, 0);
      const rollbackRate = iterations > 0 ? (rollbacks / iterations) * 100 : 0;
      results.push(
        m(
          "DI-003",
          "Transaction Rollback Rate (%)",
          CAT,
          parseFloat(rollbackRate.toFixed(3)),
          "%",
          "< 0.1",
          `Percentage of database transactions that were rolled back. ${rollbacks} rollbacks / ${iterations} iterations. High rate = contention or business logic errors`
        )
      );
    } else {
      results.push(
        na(
          "DI-003",
          "Transaction Rollback Rate",
          CAT,
          "%",
          "Requires transaction_rollback_count counter (pg_stat_database_xact_rollback from postgres_exporter or application instrumentation)"
        )
      );
    }

    // ── Data loss detection ────────────────────────────────────────────────────
    const dataLossSeries = externalMetrics["data_loss_events"] ?? [];
    if (dataLossSeries.length > 0) {
      const dataLoss = dataLossSeries.reduce((s, p) => s + p.value, 0);
      results.push(
        m(
          "DI-004",
          "Data Loss Events",
          CAT,
          dataLoss,
          "events",
          "== 0",
          `Writes acknowledged by server but unreadable afterward. ${dataLoss} data loss events — CRITICAL`
        )
      );
    } else {
      results.push(
        na(
          "DI-004",
          "Data Loss Events",
          CAT,
          "events",
          "Requires data_loss_events counter: in k6 scenario write → verify read returns written value → track failures"
        )
      );
    }

    // ── Schema consistency ─────────────────────────────────────────────────────
    const schemaViolationSeries = externalMetrics["schema_violation_count"] ?? [];
    if (schemaViolationSeries.length > 0) {
      const violations = schemaViolationSeries.reduce((s, p) => s + p.value, 0);
      const violationRate = totalReqs > 0 ? (violations / totalReqs) * 100 : 0;
      results.push(
        m(
          "DI-005",
          "Response Schema Violation Rate (%)",
          CAT,
          parseFloat(violationRate.toFixed(3)),
          "%",
          "< 0.01",
          `Responses that don't match expected JSON schema. ${violations} violations. Indicates API contract drift under load`
        )
      );
    } else {
      results.push(
        na(
          "DI-005",
          "Response Schema Violation Rate",
          CAT,
          "%",
          "Requires schema_violation_count counter in k6 scenario (JSON schema validation check() on each response)"
        )
      );
    }

    // ── Idempotency ────────────────────────────────────────────────────────────
    const idempotencySeries = externalMetrics["idempotency_violation_count"] ?? [];
    if (idempotencySeries.length > 0) {
      const idemViolations = idempotencySeries.reduce((s, p) => s + p.value, 0);
      const idemRate = totalReqs > 0 ? (idemViolations / totalReqs) * 100 : 0;
      results.push(
        m(
          "DI-006",
          "Idempotency Violation Rate (%)",
          CAT,
          parseFloat(idemRate.toFixed(4)),
          "%",
          "== 0",
          `Repeated identical requests that produced different outcomes. ${idemViolations} violations — idempotency guarantee broken`
        )
      );
    } else {
      results.push(
        na(
          "DI-006",
          "Idempotency Violation Rate",
          CAT,
          "%",
          "Requires idempotency_violation_count: send same request twice with same Idempotency-Key → check both responses match"
        )
      );
    }

    // ── Business invariant integrity ────────────────────────────────────────────
    const invariantViolSeries = externalMetrics["business_invariant_violations"] ?? [];
    if (invariantViolSeries.length > 0) {
      const violations = invariantViolSeries.reduce((s, p) => s + p.value, 0);
      results.push(
        m(
          "DI-007",
          "Business Invariant Violations",
          CAT,
          violations,
          "events",
          "== 0",
          `Business rule violations detected (negative balances, over-booking, referential integrity). ${violations} violations`
        )
      );
    } else {
      results.push(
        na(
          "DI-007",
          "Business Invariant Violations",
          CAT,
          "events",
          "Requires business_invariant_violations counter from application domain checks or post-test DB validation queries"
        )
      );
    }

    // ── Partial write detection ────────────────────────────────────────────────
    const partialWriteSeries = externalMetrics["partial_write_count"] ?? [];
    if (partialWriteSeries.length > 0) {
      const partialWrites = partialWriteSeries.reduce((s, p) => s + p.value, 0);
      results.push(
        m(
          "DI-008",
          "Partial Write Events",
          CAT,
          partialWrites,
          "events",
          "== 0",
          `Multi-step writes where only some steps completed (distributed transaction split). ${partialWrites} partial writes`
        )
      );
    } else {
      results.push(
        na(
          "DI-008",
          "Partial Write Events",
          CAT,
          "events",
          "Requires partial_write_count from saga/choreography tracking or distributed transaction coordinator"
        )
      );
    }

    // ── Counter / balance drift ────────────────────────────────────────────────
    const balanceDriftSeries = externalMetrics["counter_balance_drift"] ?? [];
    if (balanceDriftSeries.length > 0) {
      const driftMax = Math.max(...balanceDriftSeries.map((p) => Math.abs(p.value)));
      results.push(
        m(
          "DI-009",
          "Counter/Balance Drift — Max",
          CAT,
          parseFloat(driftMax.toFixed(4)),
          "units",
          "< 0.001",
          `Maximum observed drift between expected and actual counter/balance values. Indicates lost updates or race conditions`
        )
      );
    } else {
      results.push(
        na(
          "DI-009",
          "Counter/Balance Drift",
          CAT,
          "units",
          "Requires counter_balance_drift metric from post-test reconciliation (expected total vs actual total in DB)"
        )
      );
    }

    // ── Event ordering ────────────────────────────────────────────────────────
    const eventOrderSeries = externalMetrics["event_order_violations"] ?? [];
    if (eventOrderSeries.length > 0) {
      const violations = eventOrderSeries.reduce((s, p) => s + p.value, 0);
      results.push(
        m(
          "DI-010",
          "Event Ordering Violations",
          CAT,
          violations,
          "events",
          "== 0",
          `Events received or processed out of causal order. ${violations} violations — indicates missing sequence tracking or partitioned ordering`
        )
      );
    } else {
      results.push(
        na(
          "DI-010",
          "Event Ordering Violations",
          CAT,
          "events",
          "Requires event_order_violations counter from message consumer (compare event timestamps/sequence numbers)"
        )
      );
    }

    // ── Checksum / hash validation ─────────────────────────────────────────────
    const checksumFailSeries = externalMetrics["checksum_validation_failures"] ?? [];
    if (checksumFailSeries.length > 0) {
      const checksumFails = checksumFailSeries.reduce((s, p) => s + p.value, 0);
      const checksumRate = totalReqs > 0 ? (checksumFails / totalReqs) * 100 : 0;
      results.push(
        m(
          "DI-011",
          "Checksum Validation Failure Rate (%)",
          CAT,
          parseFloat(checksumRate.toFixed(4)),
          "%",
          "== 0",
          `Responses where computed checksum doesn't match expected. ${checksumFails} failures — data corruption in transit`
        )
      );
    } else {
      results.push(
        na(
          "DI-011",
          "Checksum Validation Failures",
          CAT,
          "%",
          "Requires checksum_validation_failures counter in k6 scenario (compute and verify ETag/Content-MD5 headers)"
        )
      );
    }

    // ── Referential integrity ──────────────────────────────────────────────────
    const refIntegritySeries = externalMetrics["referential_integrity_violations"] ?? [];
    if (refIntegritySeries.length > 0) {
      const riViolations = refIntegritySeries.reduce((s, p) => s + p.value, 0);
      results.push(
        m(
          "DI-012",
          "Referential Integrity Violations",
          CAT,
          riViolations,
          "events",
          "== 0",
          `FK constraint violations or orphaned records created during test. ${riViolations} violations`
        )
      );
    } else {
      results.push(
        na(
          "DI-012",
          "Referential Integrity Violations",
          CAT,
          "events",
          "Requires referential_integrity_violations counter from DB constraint error monitoring (pg_stat_errors or application-level)"
        )
      );
    }

    // ── k6-native: check failure as data integrity proxy ──────────────────────
    const checksPasses = k6Stat(k6Metrics, "checks", "passes");
    const checksFails = k6Stat(k6Metrics, "checks", "fails");
    const checksTotal = checksPasses + checksFails;
    const checkFailRate = checksTotal > 0 ? (checksFails / checksTotal) * 100 : 0;

    results.push(
      m(
        "DI-013",
        "k6 Check Failure Rate — Data Integrity Checks (%)",
        CAT,
        parseFloat(checkFailRate.toFixed(3)),
        "%",
        "< 0.1",
        `Percentage of k6 check() assertions that failed. ${checksFails}/${checksTotal} failures. Add data integrity checks (schema validation, value ranges, field presence) to k6 scenario for meaningful results`
      )
    );

    return results;
  }
}
