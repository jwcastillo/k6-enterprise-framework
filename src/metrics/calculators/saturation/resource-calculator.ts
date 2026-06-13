/**
 * Resource Saturation sub-calculator — extracted from saturation-calculator.ts in Phase 4 ARC-07.
 * Implements the Database/Cache/Queue-specific portion of MetricsCalculator (sections i, j, k).
 * Metrics: SAT-033 to SAT-043 (DB connection pool util/query latency/lock wait/deadlocks,
 * cache hit ratio/evictions/latency, queue depth/publish latency/consumer lag).
 * Note: This is an additional split beyond the 4 planned sub-calculators (cpu/memory/io/network).
 * Sections i+j+k were extracted separately to keep io-calculator.ts under the 400 LOC limit.
 */

import { MetricsCalculator, MetricsEngineInput, MetricResult } from "../../types";
import { avg, m, na, percentile } from "../_helpers";

const CAT = "saturation" as const;

export class ResourceSaturationCalculator implements MetricsCalculator {
  readonly category = CAT;

  calculate(input: MetricsEngineInput): MetricResult[] {
    const { externalMetrics = {} } = input;
    const results: MetricResult[] = [];

    // ── (i) Database ──────────────────────────────────────────────────────────
    const dbPoolSeries = externalMetrics["db_pool_utilization_pct"] ?? [];
    const dbQueryLatSeries = externalMetrics["db_query_latency_ms"] ?? [];
    const dbLockWaitSeries = externalMetrics["db_lock_wait_ms"] ?? [];
    const dbDeadlockSeries = externalMetrics["db_deadlocks"] ?? [];

    if (dbPoolSeries.length > 0) {
      const dbPoolMax = Math.max(...dbPoolSeries.map((p) => p.value));
      results.push(
        m("SAT-033", "DB Connection Pool Utilization — Peak (%)", CAT,
          parseFloat(dbPoolMax.toFixed(1)), "%", "< 85",
          `Peak percentage of database connections in use`)
      );
    } else {
      results.push(na("SAT-033", "DB Connection Pool Utilization", CAT, "%",
        "Requires db_pool_utilization_pct time-series (pg_stat_activity count / max_connections from Postgres exporter)"));
    }

    if (dbQueryLatSeries.length > 0) {
      const sorted = [...dbQueryLatSeries.map((p) => p.value)].sort((a, b) => a - b);
      const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
      const p99 = sorted[Math.ceil(sorted.length * 0.99) - 1] ?? 0;
      results.push(
        m("SAT-034", "DB Query Latency — p95 (ms)", CAT,
          parseFloat(p95.toFixed(1)), "ms", "< 100",
          `p95 database query execution time`),
        m("SAT-035", "DB Query Latency — p99 (ms)", CAT,
          parseFloat(p99.toFixed(1)), "ms", "< 500",
          `p99 database query execution time. Outliers indicate slow queries under load`)
      );
    } else {
      results.push(
        na("SAT-034", "DB Query Latency — p95", CAT, "ms",
          "Requires db_query_latency_ms time-series (pg_stat_statements via postgres_exporter or application APM)"),
        na("SAT-035", "DB Query Latency — p99", CAT, "ms",
          "Requires db_query_latency_ms time-series in externalMetrics")
      );
    }

    if (dbLockWaitSeries.length > 0) {
      const lockMax = Math.max(...dbLockWaitSeries.map((p) => p.value));
      results.push(
        m("SAT-036", "DB Lock Wait Time — Max (ms)", CAT,
          parseFloat(lockMax.toFixed(1)), "ms", "< 1000",
          `Maximum time a query waited for a database lock`)
      );
    } else {
      results.push(na("SAT-036", "DB Lock Wait Time", CAT, "ms",
        "Requires db_lock_wait_ms time-series (pg_locks from postgres_exporter or application instrumentation)"));
    }

    if (dbDeadlockSeries.length > 0) {
      const deadlocks = dbDeadlockSeries.reduce((s, p) => s + p.value, 0);
      results.push(
        m("SAT-037", "DB Deadlocks", CAT, deadlocks, "events", "== 0",
          `Total database deadlock events. Any deadlocks indicate transaction ordering issues`)
      );
    } else {
      results.push(na("SAT-037", "DB Deadlocks", CAT, "events",
        "Requires db_deadlocks time-series (pg_stat_database_deadlocks from postgres_exporter)"));
    }

    // ── (j) Cache ─────────────────────────────────────────────────────────────
    const cacheHitSeries = externalMetrics["cache_hit_ratio"] ?? [];
    const cacheEvictSeries = externalMetrics["cache_evictions"] ?? [];
    const cacheLatSeries = externalMetrics["cache_latency_ms"] ?? [];

    if (cacheHitSeries.length > 0) {
      const hitRatioAvg = avg(cacheHitSeries.map((p) => p.value));
      const hitRatioMin = Math.min(...cacheHitSeries.map((p) => p.value));
      results.push(
        m("SAT-038", "Cache Hit Ratio — Avg (%)", CAT,
          parseFloat(hitRatioAvg.toFixed(1)), "%", "> 90",
          `Average cache hit ratio. Min observed: ${hitRatioMin.toFixed(1)}%. Low ratio increases DB load`)
      );
    } else {
      results.push(na("SAT-038", "Cache Hit Ratio", CAT, "%",
        "Requires cache_hit_ratio time-series (Redis: keyspace_hits/(hits+misses), Memcached stats)"));
    }

    if (cacheEvictSeries.length > 0) {
      const evictions = cacheEvictSeries.reduce((s, p) => s + p.value, 0);
      results.push(
        m("SAT-039", "Cache Eviction Events", CAT, evictions, "events", "< 100",
          `Total cache evictions. High evictions indicate cache too small for working set`)
      );
    } else {
      results.push(na("SAT-039", "Cache Eviction Events", CAT, "events",
        "Requires cache_evictions time-series (redis_evicted_keys_total or application cache metrics)"));
    }

    if (cacheLatSeries.length > 0) {
      const sorted = [...cacheLatSeries.map((p) => p.value)].sort((a, b) => a - b);
      const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
      results.push(
        m("SAT-040", "Cache Latency — p95 (ms)", CAT,
          parseFloat(p95.toFixed(2)), "ms", "< 5",
          `p95 cache operation latency`)
      );
    } else {
      results.push(na("SAT-040", "Cache Latency — p95", CAT, "ms",
        "Requires cache_latency_ms time-series (application-level instrumentation)"));
    }

    // ── (k) Message Queue ─────────────────────────────────────────────────────
    const qDepthSeries = externalMetrics["queue_depth"] ?? [];
    const qPublishSeries = externalMetrics["queue_publish_lat_ms"] ?? [];
    const qLagSeries = externalMetrics["queue_consumer_lag"] ?? [];

    if (qDepthSeries.length > 0) {
      const qMax = Math.max(...qDepthSeries.map((p) => p.value));
      results.push(
        m("SAT-041", "Queue Depth — Peak", CAT, parseFloat(qMax.toFixed(0)),
          "messages", "< 10000",
          `Peak message queue depth. Growing depth = consumers saturated`)
      );
    } else {
      results.push(na("SAT-041", "Queue Depth — Peak", CAT, "messages",
        "Requires queue_depth time-series (RabbitMQ: rabbitmq_queue_messages, Kafka: kafka_consumer_lag)"));
    }

    if (qPublishSeries.length > 0) {
      const pubP95 = percentile(qPublishSeries.map((p) => p.value), 95);
      results.push(
        m("SAT-042", "Queue Publish Latency — p95 (ms)", CAT,
          parseFloat(pubP95.toFixed(1)), "ms", "< 50",
          `p95 time to publish a message to the queue`)
      );
    } else {
      results.push(na("SAT-042", "Queue Publish Latency — p95", CAT, "ms",
        "Requires queue_publish_lat_ms time-series (application instrumentation)"));
    }

    if (qLagSeries.length > 0) {
      const lagMax = Math.max(...qLagSeries.map((p) => p.value));
      results.push(
        m("SAT-043", "Queue Consumer Lag — Peak", CAT, parseFloat(lagMax.toFixed(0)),
          "messages", "< 1000",
          `Peak consumer lag (messages behind producer). Indicates consumer saturation`)
      );
    } else {
      results.push(na("SAT-043", "Queue Consumer Lag", CAT, "messages",
        "Requires queue_consumer_lag time-series (Kafka: kafka_consumer_group_lag)"));
    }

    return results;
  }
}
