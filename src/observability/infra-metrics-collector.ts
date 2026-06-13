// T-093: Recopilador de metricas de infraestructura via Prometheus
// T-094: Correlacion con trazas APM (Tempo)
// T-095: Vista unificada de correlacion

import { fetchSafe } from "./http-safe";

export interface InfraMetricsConfig {
  prometheusUrl: string; // default: http://prometheus:9090
  grafanaUrl: string; // default: http://grafana:3000
  serviceLabel: string; // Prometheus label to filter by service
  namespace?: string;
}

export interface InfraTimeSeries {
  timestamps: number[];
  values: number[];
}

export interface InfraMetrics {
  cpuUsagePct: InfraTimeSeries;
  memoryUsagePct: InfraTimeSeries;
  diskReadOps: InfraTimeSeries;
  diskWriteOps: InfraTimeSeries;
  networkInBytes: InfraTimeSeries;
  networkOutBytes: InfraTimeSeries;
  activeConnections: InfraTimeSeries;
  custom?: Record<string, InfraTimeSeries>;
}

export interface ApmTrace {
  traceId: string;
  spanId?: string;
  service: string;
  operation: string;
  durationMs: number;
  startTime: number;
  grafanaLink?: string;
}

export interface CorrelationEvent {
  timestamp: number;
  testMetric: string;
  testValue: number;
  infraMetric: string;
  infraValue: number;
  severity: "info" | "warning" | "critical";
  description: string;
}

export interface CorrelationResult {
  infraMetrics: InfraMetrics | null;
  slowestTraces: ApmTrace[];
  correlationEvents: CorrelationEvent[];
  available: boolean;
  warnings: string[];
}

/**
 * Prometheus query_range helper (Node.js / fetch-based, not k6).
 *
 * Throws on transport/HTTP failure so collectInfraMetrics() can catch it and
 * return null for the whole batch. Returns an empty series if Prom responds
 * but has no data points for the query.
 */
async function promQueryRange(
  baseUrl: string,
  query: string,
  startTs: number,
  endTs: number,
  step = "15s"
): Promise<InfraTimeSeries> {
  const url = `${baseUrl}/api/v1/query_range?query=${encodeURIComponent(query)}&start=${startTs}&end=${endTs}&step=${step}`;
  const { ok, data, error } = await fetchSafe<{
    data: { result: Array<{ values: [number, string][] }> };
  }>(url);
  if (!ok || !data) {
    throw new Error(error ?? `Prometheus query failed: ${query}`);
  }

  const result = data.data.result[0];
  if (!result) return { timestamps: [], values: [] };

  return {
    timestamps: result.values.map(([ts]) => ts * 1000),
    values: result.values.map(([, v]) => parseFloat(v)),
  };
}

/** Collect infra metrics for the duration of a test run */
export async function collectInfraMetrics(
  config: InfraMetricsConfig,
  startMs: number,
  endMs: number
): Promise<InfraMetrics | null> {
  const { prometheusUrl, serviceLabel, namespace } = config;
  const startTs = startMs / 1000;
  const endTs = endMs / 1000;
  const svcFilter = namespace
    ? `{service="${serviceLabel}",namespace="${namespace}"}`
    : `{service="${serviceLabel}"}`;

  try {
    const [cpu, mem, diskR, diskW, netIn, netOut, conns] = await Promise.all([
      promQueryRange(
        prometheusUrl,
        `rate(process_cpu_seconds_total${svcFilter}[1m]) * 100`,
        startTs,
        endTs
      ),
      promQueryRange(
        prometheusUrl,
        `process_resident_memory_bytes${svcFilter} / node_memory_MemTotal_bytes * 100`,
        startTs,
        endTs
      ),
      promQueryRange(prometheusUrl, `rate(node_disk_reads_completed_total[1m])`, startTs, endTs),
      promQueryRange(prometheusUrl, `rate(node_disk_writes_completed_total[1m])`, startTs, endTs),
      promQueryRange(prometheusUrl, `rate(node_network_receive_bytes_total[1m])`, startTs, endTs),
      promQueryRange(prometheusUrl, `rate(node_network_transmit_bytes_total[1m])`, startTs, endTs),
      promQueryRange(prometheusUrl, `sum(http_server_active_requests${svcFilter})`, startTs, endTs),
    ]);

    return {
      cpuUsagePct: cpu,
      memoryUsagePct: mem,
      diskReadOps: diskR,
      diskWriteOps: diskW,
      networkInBytes: netIn,
      networkOutBytes: netOut,
      activeConnections: conns,
    };
  } catch (_err) {
    return null; // Prometheus not available — graceful degradation
  }
}

/** Fetch slowest traces from Tempo for the test window */
export async function fetchSlowTraces(
  config: InfraMetricsConfig,
  startMs: number,
  endMs: number,
  limit = 5
): Promise<ApmTrace[]> {
  const url = `${config.grafanaUrl}/api/datasources/proxy/1/api/traces?service=${config.serviceLabel}&start=${startMs}&end=${endMs}&limit=${limit}&sortBy=duration&order=desc`;
  const { ok, data } = await fetchSafe<{
    traces: Array<{
      traceID: string;
      rootServiceName: string;
      rootTraceName: string;
      durationMs: number;
      startTimeUnixNano: number;
    }>;
  }>(url);
  if (!ok || !data) return [];

  return (data.traces ?? []).map((t) => ({
    traceId: t.traceID,
    service: t.rootServiceName,
    operation: t.rootTraceName,
    durationMs: t.durationMs,
    startTime: Math.round(t.startTimeUnixNano / 1_000_000),
    grafanaLink: `${config.grafanaUrl}/explore?orgId=1&left=["now-1h","now","Tempo",{"query":"${t.traceID}"}]`,
  }));
}

/**
 * Detect correlations: periods where test latency spike coincides with infra saturation.
 * (CHK-API-022, CHK-API-023)
 */
export function detectCorrelations(
  testTimeSeries: Array<{ ts: number; p95Ms: number; errorRatePct: number }>,
  infra: InfraMetrics
): CorrelationEvent[] {
  const events: CorrelationEvent[] = [];

  if (!infra.cpuUsagePct.timestamps.length) return events;

  // Build infra lookup by timestamp (nearest bucket)
  const getInfraValue = (series: InfraTimeSeries, targetTs: number): number | null => {
    if (!series.timestamps.length) return null;
    const idx = series.timestamps.reduce(
      (best, ts, i) =>
        Math.abs(ts - targetTs) < Math.abs(series.timestamps[best] - targetTs) ? i : best,
      0
    );
    return series.values[idx] ?? null;
  };

  for (const point of testTimeSeries) {
    const cpu = getInfraValue(infra.cpuUsagePct, point.ts);
    const mem = getInfraValue(infra.memoryUsagePct, point.ts);

    if (point.p95Ms > 1000 && cpu !== null && cpu > 80) {
      events.push({
        timestamp: point.ts,
        testMetric: "p95_latency",
        testValue: point.p95Ms,
        infraMetric: "cpu_usage_pct",
        infraValue: cpu,
        severity: cpu > 95 ? "critical" : "warning",
        description: `Latency spike (${point.p95Ms}ms p95) correlated with CPU at ${cpu.toFixed(1)}%`,
      });
    }

    if (point.errorRatePct > 5 && mem !== null && mem > 85) {
      events.push({
        timestamp: point.ts,
        testMetric: "error_rate",
        testValue: point.errorRatePct,
        infraMetric: "memory_usage_pct",
        infraValue: mem,
        severity: mem > 95 ? "critical" : "warning",
        description: `Error burst (${point.errorRatePct.toFixed(1)}% error rate) correlated with memory at ${mem.toFixed(1)}%`,
      });
    }
  }

  return events;
}

/** Collect all correlation data for a test run */
export async function buildCorrelationResult(
  config: InfraMetricsConfig,
  testTimeSeries: Array<{ ts: number; p95Ms: number; errorRatePct: number }>,
  startMs: number,
  endMs: number
): Promise<CorrelationResult> {
  const warnings: string[] = [];

  const [infra, traces] = await Promise.all([
    collectInfraMetrics(config, startMs, endMs),
    fetchSlowTraces(config, startMs, endMs),
  ]);

  if (!infra) warnings.push("Prometheus not available — infra metrics section skipped.");
  if (!traces.length) warnings.push("Tempo not available or no traces found for this period.");

  const correlationEvents = infra ? detectCorrelations(testTimeSeries, infra) : [];

  return {
    infraMetrics: infra,
    slowestTraces: traces,
    correlationEvents,
    available: !!infra || traces.length > 0,
    warnings,
  };
}

/** Format correlation result as HTML section */
export function formatCorrelationHtml(result: CorrelationResult): string {
  if (!result.available) return "";

  const traceRows = result.slowestTraces
    .map(
      (t) =>
        `<tr><td>${t.service}</td><td>${t.operation}</td><td>${t.durationMs}ms</td><td><a href="${t.grafanaLink ?? "#"}" target="_blank">View trace</a></td></tr>`
    )
    .join("");

  const eventRows = result.correlationEvents
    .map((e) => {
      const color = e.severity === "critical" ? "#fee2e2" : "#fef9c3";
      return `<tr style="background:${color}"><td>${new Date(e.timestamp).toLocaleTimeString()}</td><td>${e.testMetric}: ${e.testValue}</td><td>${e.infraMetric}: ${e.infraValue.toFixed(1)}</td><td>${e.description}</td></tr>`;
    })
    .join("");

  return `
<section class="section" id="correlation">
  <h2>Diagnostico — Correlacion APM / Infraestructura</h2>
  ${result.warnings.map((w) => `<p class="warning">⚠️ ${w}</p>`).join("")}
  ${
    result.slowestTraces.length > 0
      ? `
  <h3>Trazas mas lentas del periodo</h3>
  <table class="data-table"><thead><tr><th>Servicio</th><th>Operacion</th><th>Duracion</th><th>Link</th></tr></thead>
  <tbody>${traceRows}</tbody></table>`
      : ""
  }
  ${
    result.correlationEvents.length > 0
      ? `
  <h3>Correlaciones detectadas</h3>
  <table class="data-table"><thead><tr><th>Timestamp</th><th>Test Metric</th><th>Infra Metric</th><th>Descripcion</th></tr></thead>
  <tbody>${eventRows}</tbody></table>`
      : '<p style="color:var(--green)">✓ No se detectaron correlaciones significativas.</p>'
  }
</section>`;
}
