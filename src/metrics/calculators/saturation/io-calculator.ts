/**
 * IO Saturation sub-calculator — extracted from saturation-calculator.ts in Phase 4 ARC-07.
 * Implements the System/Storage/Connection-Pool-specific portion of MetricsCalculator
 * (sections e, f, and h).
 * Metrics: SAT-019 to SAT-032 (threads, FDs, socket backlog, disk I/O, IOPS, disk latency,
 * connection pool utilization/wait/exhaustion).
 */

import { MetricsCalculator, MetricsEngineInput, MetricResult } from "../../types";
import { avg, m, na, percentile } from "../_helpers";

const CAT = "saturation" as const;

export class IoSaturationCalculator implements MetricsCalculator {
  readonly category = CAT;

  calculate(input: MetricsEngineInput): MetricResult[] {
    const { externalMetrics = {} } = input;
    const results: MetricResult[] = [];

    // ── (e) System — threads, FDs, socket backlog ─────────────────────────────
    const threadSeries = externalMetrics["thread_count"] ?? [];
    const fdSeries = externalMetrics["open_file_descriptors"] ?? [];
    const backlogSeries = externalMetrics["socket_backlog"] ?? [];
    const poolQueueSeries = externalMetrics["thread_pool_queue_depth"] ?? [];

    if (threadSeries.length > 0) {
      const threadMax = Math.max(...threadSeries.map((p) => p.value));
      const threadAvg = avg(threadSeries.map((p) => p.value));
      results.push(
        m(
          "SAT-019",
          "Thread Count — Peak",
          CAT,
          parseFloat(threadMax.toFixed(0)),
          "threads",
          "< 500",
          `Peak active thread count. Avg: ${threadAvg.toFixed(0)}`
        )
      );
    } else {
      results.push(
        na(
          "SAT-019",
          "Thread Count — Peak",
          CAT,
          "threads",
          "Requires thread_count time-series (JVM: jvm_threads_live_threads, Go: go_goroutines)"
        )
      );
    }

    if (poolQueueSeries.length > 0) {
      const qMax = Math.max(...poolQueueSeries.map((p) => p.value));
      results.push(
        m(
          "SAT-020",
          "Thread Pool Queue Depth — Peak",
          CAT,
          parseFloat(qMax.toFixed(0)),
          "tasks",
          "< 100",
          `Peak task queue depth in thread pool. High = CPU saturation causing request queuing`
        )
      );
    } else {
      results.push(
        na(
          "SAT-020",
          "Thread Pool Queue Depth",
          CAT,
          "tasks",
          "Requires thread_pool_queue_depth time-series (executor_queue_remaining_tasks from Spring/HikariCP Prometheus)"
        )
      );
    }

    if (fdSeries.length > 0) {
      const fdMax = Math.max(...fdSeries.map((p) => p.value));
      results.push(
        m(
          "SAT-021",
          "Open File Descriptors — Peak",
          CAT,
          parseFloat(fdMax.toFixed(0)),
          "FDs",
          "< 10000",
          `Peak open file descriptor count. Approaching OS ulimit causes EMFILE errors`
        )
      );
    } else {
      results.push(
        na(
          "SAT-021",
          "Open File Descriptors",
          CAT,
          "FDs",
          "Requires open_file_descriptors time-series (process_open_fds from Prometheus)"
        )
      );
    }

    if (backlogSeries.length > 0) {
      const backlogMax = Math.max(...backlogSeries.map((p) => p.value));
      results.push(
        m(
          "SAT-022",
          "Socket Accept Backlog — Peak",
          CAT,
          parseFloat(backlogMax.toFixed(0)),
          "connections",
          "< 128",
          `Peak unaccepted connection backlog. Exceeding listen() backlog causes connection drops`
        )
      );
    } else {
      results.push(
        na(
          "SAT-022",
          "Socket Accept Backlog",
          CAT,
          "connections",
          "Requires socket_backlog time-series (node_sockstat_TCP_alloc from node_exporter)"
        )
      );
    }

    // ── (f) Storage ────────────────────────────────────────────────────────────
    const diskIOSeries = externalMetrics["disk_io_bytes_per_sec"] ?? [];
    const diskIOPSSeries = externalMetrics["disk_iops"] ?? [];
    const diskLatencySeries = externalMetrics["disk_io_latency_ms"] ?? [];

    if (diskIOSeries.length > 0) {
      const diskMax = Math.max(...diskIOSeries.map((p) => p.value));
      results.push(
        m(
          "SAT-023",
          "Disk I/O — Peak (MB/s)",
          CAT,
          parseFloat((diskMax / 1_048_576).toFixed(1)),
          "MB/s",
          undefined,
          `Peak disk I/O throughput`
        )
      );
    } else {
      results.push(
        na(
          "SAT-023",
          "Disk I/O — Peak",
          CAT,
          "MB/s",
          "Requires disk_io_bytes_per_sec time-series (node_disk_read_bytes_total + node_disk_written_bytes_total from node_exporter)"
        )
      );
    }

    if (diskIOPSSeries.length > 0) {
      const iopsMax = Math.max(...diskIOPSSeries.map((p) => p.value));
      results.push(
        m(
          "SAT-024",
          "Disk IOPS — Peak",
          CAT,
          parseFloat(iopsMax.toFixed(0)),
          "IOPS",
          undefined,
          `Peak disk I/O operations per second`
        )
      );
    } else {
      results.push(
        na(
          "SAT-024",
          "Disk IOPS — Peak",
          CAT,
          "IOPS",
          "Requires disk_iops time-series (node_disk_reads_completed_total + writes from node_exporter)"
        )
      );
    }

    if (diskLatencySeries.length > 0) {
      const p99sorted = [...diskLatencySeries.map((p) => p.value)].sort((a, b) => a - b);
      const diskLatP99 = p99sorted[Math.ceil(p99sorted.length * 0.99) - 1] ?? 0;
      results.push(
        m(
          "SAT-025",
          "Disk I/O Latency — p99 (ms)",
          CAT,
          parseFloat(diskLatP99.toFixed(1)),
          "ms",
          "< 20",
          `p99 disk I/O latency. High values cause application I/O blocking`
        )
      );
    } else {
      results.push(
        na(
          "SAT-025",
          "Disk I/O Latency — p99",
          CAT,
          "ms",
          "Requires disk_io_latency_ms time-series (node_disk_io_time_seconds from node_exporter)"
        )
      );
    }

    // ── (h) Connection Pool ────────────────────────────────────────────────────
    const connPoolSeries = externalMetrics["conn_pool_active"] ?? [];
    const connPoolMaxSeries = externalMetrics["conn_pool_max"] ?? [];
    const connWaitSeries = externalMetrics["conn_pool_wait_ms"] ?? [];

    if (connPoolSeries.length > 0 && connPoolMaxSeries.length > 0) {
      const activeMax = Math.max(...connPoolSeries.map((p) => p.value));
      const poolMax = connPoolMaxSeries[0].value || 1;
      const poolUtil = (activeMax / poolMax) * 100;
      results.push(
        m(
          "SAT-030",
          "Connection Pool Utilization — Peak (%)",
          CAT,
          parseFloat(poolUtil.toFixed(1)),
          "%",
          "< 90",
          `Peak connection pool utilization: ${activeMax} / ${poolMax} = ${poolUtil.toFixed(1)}%. >90% causes connection wait`
        )
      );
    } else {
      results.push(
        na(
          "SAT-030",
          "Connection Pool Utilization",
          CAT,
          "%",
          "Requires conn_pool_active + conn_pool_max time-series (hikaricp_connections_active from HikariCP / pgbouncer_pools_sv_active from PgBouncer)"
        )
      );
    }

    if (connWaitSeries.length > 0) {
      const sorted = [...connWaitSeries.map((p) => p.value)].sort((a, b) => a - b);
      const waitP95 = percentile(sorted, 95);
      results.push(
        m(
          "SAT-031",
          "Connection Pool Wait Time — p95 (ms)",
          CAT,
          parseFloat(waitP95.toFixed(1)),
          "ms",
          "< 100",
          `p95 connection pool wait time. Requests block here when pool is exhausted`
        )
      );
    } else {
      results.push(
        na(
          "SAT-031",
          "Connection Pool Wait Time — p95",
          CAT,
          "ms",
          "Requires conn_pool_wait_ms time-series (hikaricp_connections_pending or pgbouncer_pools_sv_login_wait)"
        )
      );
    }

    // Connection pool exhaustion events
    const poolExhaustSeries = externalMetrics["conn_pool_timeout_total"] ?? [];
    if (poolExhaustSeries.length > 0) {
      const timeouts = poolExhaustSeries.reduce((s, p) => s + p.value, 0);
      results.push(
        m(
          "SAT-032",
          "Connection Pool Exhaustion Events",
          CAT,
          timeouts,
          "events",
          "== 0",
          `Times connection pool was fully exhausted (timeout waiting for connection): ${timeouts} events`
        )
      );
    } else {
      results.push(
        na(
          "SAT-032",
          "Connection Pool Exhaustion Events",
          CAT,
          "events",
          "Requires conn_pool_timeout_total metric (hikaricp_connections_timeout_total or equivalent)"
        )
      );
    }

    return results;
  }
}
