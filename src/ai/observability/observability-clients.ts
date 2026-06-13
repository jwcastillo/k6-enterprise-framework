/**
 * T-115: Clientes programaticos para Prometheus, Tempo, Loki y Pyroscope
 *
 * Cada cliente:
 *   - Maneja autenticacion via headers o env vars
 *   - Timeout configurable
 *   - Degradacion graceful cuando el servicio no esta disponible (EC-AI-005)
 *   - Enmascara informacion sensible en outputs (CHK-SEC-113)
 *
 * FR-177 | CHK-API-380, CHK-SEC-113
 */

import { maskSensitive } from "../../core/secrets-manager";
import { DEFAULT_FETCH_TIMEOUT_MS, fetchSafe } from "../../observability/http-safe";
import type {
  ObservabilityQuery,
  ObservabilityResult,
  ObservabilitySource,
} from "../../types/ai.d";

// ---------------------------------------------------------------------------
// Configuracion base
// ---------------------------------------------------------------------------

export interface ObsClientConfig {
  baseUrl?: string;
  timeoutMs?: number;
  /** Headers de autenticacion (se enmascaran en logs, CHK-SEC-113) */
  authHeaders?: Record<string, string>;
}

const DEFAULT_TIMEOUT = DEFAULT_FETCH_TIMEOUT_MS;

// ---------------------------------------------------------------------------
// PrometheusClient
// ---------------------------------------------------------------------------

export class PrometheusClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly headers: Record<string, string>;

  constructor(config: ObsClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? process.env.PROMETHEUS_URL ?? "http://localhost:9090";
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT;
    this.headers = config.authHeaders ?? {};
  }

  /**
   * Ejecutar PromQL instant query.
   * @param query PromQL expression
   * @param time  ISO timestamp o unix timestamp (default: now)
   */
  async instantQuery(query: string, time?: string): Promise<ObservabilityResult> {
    const start = Date.now();
    const params = new URLSearchParams({ query });
    if (time) params.set("time", time);

    const { ok, data, error } = await fetchSafe(`${this.baseUrl}/api/v1/query?${params}`, {
      headers: this.headers,
      timeoutMs: this.timeoutMs,
    });

    return this.buildResult("prometheus", query, ok, data, error, start);
  }

  /**
   * Ejecutar PromQL range query (serie temporal).
   * CHK-API-380: permite queries como "http_req_duration_p95{test_name='X'}[5m]"
   */
  async rangeQuery(q: ObservabilityQuery): Promise<ObservabilityResult> {
    const start = Date.now();
    const params = new URLSearchParams({
      query: q.query,
      start: q.from,
      end: q.to ?? "now",
      step: q.step ?? "15s",
    });

    const { ok, data, error } = await fetchSafe(`${this.baseUrl}/api/v1/query_range?${params}`, {
      headers: this.headers,
      timeoutMs: this.timeoutMs,
    });

    const result = this.buildResult("prometheus", q.query, ok, data, error, start);

    // Transformar series temporales al formato comun
    type PromSeries = {
      metric?: Record<string, string>;
      values?: Array<[number, string]>;
    };
    type PromResponse = { data?: { result?: PromSeries[] } };
    const promData = data as PromResponse | undefined;
    if (ok && promData?.data?.result) {
      result.series = promData.data.result.map((series) => ({
        labels: series.metric ?? {},
        values: (series.values ?? []).map(([ts, val]): [number, number] => [
          ts * 1000, // convertir a ms
          parseFloat(val),
        ]),
      }));
    }

    return result;
  }

  /** Obtener labels de una metrica */
  async getLabels(metric: string): Promise<string[]> {
    const { ok, data } = await fetchSafe(
      `${this.baseUrl}/api/v1/labels?match[]=${encodeURIComponent(metric)}`,
      { headers: this.headers, timeoutMs: this.timeoutMs }
    );
    return ok ? ((data as { data?: string[] } | undefined)?.data ?? []) : [];
  }

  private buildResult(
    source: ObservabilitySource,
    query: string,
    ok: boolean,
    data: unknown,
    error: string | undefined,
    startMs: number
  ): ObservabilityResult {
    return {
      source,
      query: maskSensitive(query),
      partial: !ok,
      latencyMs: Date.now() - startMs,
      ...(ok ? { series: [] } : {}),
      ...(error
        ? {
            logs: [
              { timestamp: new Date().toISOString(), labels: { error: "true" }, message: error },
            ],
          }
        : {}),
    };
  }
}

// ---------------------------------------------------------------------------
// TempoClient
// ---------------------------------------------------------------------------

export interface TraceSearchResult {
  traceId: string;
  rootServiceName: string;
  rootTraceName: string;
  durationMs: number;
  startTimeMs: number;
  spans: SpanSummary[];
}

export interface SpanSummary {
  spanId: string;
  service: string;
  operation: string;
  durationMs: number;
  status: "ok" | "error" | "unset";
  tags?: Record<string, string>;
}

export class TempoClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly headers: Record<string, string>;

  constructor(config: ObsClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? process.env.TEMPO_URL ?? "http://localhost:3200";
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT;
    this.headers = config.authHeaders ?? {};
  }

  /**
   * Buscar traza por traceID.
   * CHK-API-380: retorna spans estructurados.
   */
  async getTraceById(traceId: string): Promise<ObservabilityResult> {
    const start = Date.now();

    if (!/^[0-9a-f]{16,32}$/i.test(traceId)) {
      return {
        source: "tempo",
        query: traceId,
        partial: true,
        latencyMs: 0,
        logs: [
          {
            timestamp: new Date().toISOString(),
            labels: {},
            message: "traceId invalido (debe ser hex 16-32 chars)",
          },
        ],
      };
    }

    const { ok, data, error } = await fetchSafe(`${this.baseUrl}/api/traces/${traceId}`, {
      headers: this.headers,
      timeoutMs: this.timeoutMs,
    });

    const result: ObservabilityResult = {
      source: "tempo",
      query: traceId,
      partial: !ok,
      latencyMs: Date.now() - start,
    };

    if (ok && data) {
      result.traces = this.parseTraceResponse(data);
    } else if (error) {
      result.logs = [
        { timestamp: new Date().toISOString(), labels: { error: "true" }, message: error },
      ];
    }

    return result;
  }

  /**
   * Buscar trazas por tags (service, operation, duration, status).
   */
  async searchTraces(q: ObservabilityQuery): Promise<ObservabilityResult> {
    const start = Date.now();
    const params = new URLSearchParams({ q: q.query });
    if (q.from) params.set("start", q.from);
    if (q.to) params.set("end", q.to ?? "now");
    if (q.limit) params.set("limit", String(q.limit));

    const { ok, data, error } = await fetchSafe(`${this.baseUrl}/api/search?${params}`, {
      headers: this.headers,
      timeoutMs: this.timeoutMs,
    });

    const result: ObservabilityResult = {
      source: "tempo",
      query: maskSensitive(q.query),
      partial: !ok,
      latencyMs: Date.now() - start,
    };

    type TempoSearchHit = {
      traceID?: string;
      traceId?: string;
      rootServiceName?: string;
      rootTraceName?: string;
      durationMs?: number;
    };
    const tempoData = data as { traces?: TempoSearchHit[] } | undefined;
    if (ok && tempoData?.traces) {
      result.traces = tempoData.traces.map((t) => ({
        traceId: t.traceID ?? t.traceId ?? "",
        rootServiceName: t.rootServiceName ?? "",
        rootTraceName: t.rootTraceName ?? "",
        durationMs: Math.round(t.durationMs ?? 0),
        spans: [],
      }));
    } else if (error) {
      result.logs = [
        { timestamp: new Date().toISOString(), labels: { error: "true" }, message: error },
      ];
    }

    return result;
  }

  private parseTraceResponse(data: unknown): ObservabilityResult["traces"] {
    type OtelAttribute = { key?: string; value?: { stringValue?: string } };
    type OtelSpan = {
      spanId?: string;
      name?: string;
      startTimeUnixNano?: string | number;
      endTimeUnixNano?: string | number;
      status?: { code?: number };
    };
    type OtelScopeSpans = { spans?: OtelSpan[] };
    type OtelBatch = {
      resource?: { attributes?: OtelAttribute[] };
      scopeSpans?: OtelScopeSpans[];
      instrumentationLibrarySpans?: OtelScopeSpans[];
    };
    type OtelResponse = { batches?: OtelBatch[]; resourceSpans?: OtelBatch[] };
    const d = data as OtelResponse | undefined;
    const batches: OtelBatch[] = d?.batches ?? d?.resourceSpans ?? [];

    const spans: SpanSummary[] = [];
    let rootService = "";
    let rootOperation = "";
    let totalDurationMs = 0;

    for (const batch of batches) {
      const service =
        batch?.resource?.attributes?.find((a) => a.key === "service.name")?.value?.stringValue ??
        "";
      if (!rootService) rootService = service;

      for (const scopeSpans of batch?.scopeSpans ?? batch?.instrumentationLibrarySpans ?? []) {
        for (const span of scopeSpans?.spans ?? []) {
          const dMs = Math.round(
            (parseInt(String(span.endTimeUnixNano ?? 0)) -
              parseInt(String(span.startTimeUnixNano ?? 0))) /
              1e6
          );
          totalDurationMs = Math.max(totalDurationMs, dMs);
          if (!rootOperation) rootOperation = span.name ?? "";

          spans.push({
            spanId: span.spanId ?? "",
            service,
            operation: span.name ?? "",
            durationMs: dMs,
            status: span.status?.code === 2 ? "error" : span.status?.code === 1 ? "ok" : "unset",
          });
        }
      }
    }

    return [
      {
        traceId: "",
        rootServiceName: rootService,
        rootTraceName: rootOperation,
        durationMs: totalDurationMs,
        spans,
      },
    ];
  }
}

// ---------------------------------------------------------------------------
// LokiClient
// ---------------------------------------------------------------------------

export class LokiClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly headers: Record<string, string>;

  constructor(config: ObsClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? process.env.LOKI_URL ?? "http://localhost:3100";
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT;
    this.headers = config.authHeaders ?? {};
  }

  /**
   * Ejecutar query LogQL.
   * CHK-API-380: retorna log entries con timestamps y labels.
   */
  async queryRange(q: ObservabilityQuery): Promise<ObservabilityResult> {
    const start = Date.now();
    const params = new URLSearchParams({
      query: q.query,
      start: this.toNano(q.from),
      end: this.toNano(q.to ?? "now"),
      limit: String(q.limit ?? 100),
    });
    if (q.step) params.set("step", q.step);

    const { ok, data, error } = await fetchSafe(
      `${this.baseUrl}/loki/api/v1/query_range?${params}`,
      { headers: this.headers, timeoutMs: this.timeoutMs }
    );

    const result: ObservabilityResult = {
      source: "loki",
      query: maskSensitive(q.query),
      partial: !ok,
      latencyMs: Date.now() - start,
    };

    type LokiStream = {
      stream?: Record<string, string>;
      values?: Array<[string, string]>;
    };
    type LokiResponse = { data?: { result?: LokiStream[] } };
    const lokiData = data as LokiResponse | undefined;
    if (ok && lokiData?.data?.result) {
      result.logs = [];
      for (const stream of lokiData.data.result) {
        const labels = stream.stream ?? {};
        for (const [tsNano, message] of stream.values ?? []) {
          result.logs.push({
            timestamp: new Date(parseInt(tsNano) / 1e6).toISOString(),
            labels,
            message: maskSensitive(message),
            level: labels.level ?? labels.severity ?? undefined,
          });
        }
      }
      // Ordenar por timestamp
      result.logs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    } else if (error) {
      result.logs = [
        { timestamp: new Date().toISOString(), labels: { error: "true" }, message: error },
      ];
    }

    return result;
  }

  /** Busqueda de errores en un rango temporal */
  async searchErrors(from: string, to: string, service?: string): Promise<ObservabilityResult> {
    const selector = service
      ? `{service="${service}"} |= "error" or "ERROR" or "exception"`
      : `{job=~".+"} |= "error" or "ERROR" or "exception"`;
    return this.queryRange({ source: "loki", query: selector, from, to, limit: 200 });
  }

  /** Convertir timestamp a nanosegundos para la API de Loki */
  private toNano(ts: string): string {
    if (ts === "now") return String(Date.now() * 1e6);
    if (ts.startsWith("-")) {
      const ms = this.parseRelative(ts);
      return String((Date.now() - ms) * 1e6);
    }
    return String(new Date(ts).getTime() * 1e6);
  }

  private parseRelative(rel: string): number {
    const match = rel.match(/^-?(\d+)(ms|s|m|h|d)$/);
    if (!match) return 0;
    const [, n, unit] = match;
    const factors: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return parseInt(n) * (factors[unit] ?? 1000);
  }
}

// ---------------------------------------------------------------------------
// PyroscopeClient
// ---------------------------------------------------------------------------

export interface FlameGraphData {
  service: string;
  from: string;
  to: string;
  type: "cpu" | "memory" | "goroutine";
  totalSamples: number;
  /** Datos del flame graph (formato simplificado) */
  topFunctions: Array<{ name: string; self: number; total: number; pct: number }>;
}

export class PyroscopeClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly headers: Record<string, string>;

  constructor(config: ObsClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? process.env.PYROSCOPE_URL ?? "http://localhost:4040";
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT;
    this.headers = config.authHeaders ?? {};
  }

  /**
   * Obtener datos de profiling (flame graph) por servicio y rango temporal.
   * CHK-API-380: permite queries como "CPU profile del servicio auth entre 10:00 y 10:10"
   */
  async getProfile(q: ObservabilityQuery): Promise<ObservabilityResult> {
    const start = Date.now();
    const params = new URLSearchParams({
      query: q.query,
      from: q.from,
      until: q.to ?? "now",
      format: "json",
    });

    const { ok, data, error } = await fetchSafe(`${this.baseUrl}/pyroscope/render?${params}`, {
      headers: this.headers,
      timeoutMs: this.timeoutMs,
    });

    const result: ObservabilityResult = {
      source: "pyroscope",
      query: maskSensitive(q.query),
      partial: !ok,
      latencyMs: Date.now() - start,
    };

    if (ok && data) {
      // Transformar flame graph a series temporales resumidas
      result.series = this.flameGraphToSeries(data, q.query);
    } else if (error) {
      result.logs = [
        { timestamp: new Date().toISOString(), labels: { error: "true" }, message: error },
      ];
    }

    return result;
  }

  /** Obtener top funciones por CPU de un servicio */
  async getCpuProfile(service: string, from: string, to?: string): Promise<FlameGraphData> {
    const params = new URLSearchParams({
      query: `${service}.cpu`,
      from,
      until: to ?? "now",
      format: "json",
    });

    const { ok, data } = await fetchSafe(`${this.baseUrl}/pyroscope/render?${params}`, {
      headers: this.headers,
      timeoutMs: this.timeoutMs,
    });

    if (!ok || !data) {
      return { service, from, to: to ?? "now", type: "cpu", totalSamples: 0, topFunctions: [] };
    }

    return this.parseFlameGraph(data, service, from, to ?? "now", "cpu");
  }

  private flameGraphToSeries(data: unknown, query: string): ObservabilityResult["series"] {
    type FlameBearer = {
      flamebearer?: {
        names?: string[];
        levels?: number[][];
        numTicks?: number;
      };
    };
    const d = data as FlameBearer | undefined;
    if (!d?.flamebearer?.names) return [];

    const names = d.flamebearer.names;
    const values = d.flamebearer.levels?.[0] ?? [];
    const total = d.flamebearer.numTicks ?? 1;

    return [
      {
        labels: { query: maskSensitive(query), type: "flame" },
        values: names.slice(0, 20).map((name, i) => [i, ((values[i] ?? 0) / total) * 100]),
      },
    ];
  }

  private parseFlameGraph(
    data: unknown,
    service: string,
    from: string,
    to: string,
    type: FlameGraphData["type"]
  ): FlameGraphData {
    type FlameBearer = {
      flamebearer?: {
        names?: string[];
        levels?: number[][];
        numTicks?: number;
      };
    };
    const d = data as FlameBearer | undefined;
    const names: string[] = d?.flamebearer?.names ?? [];
    const total = d?.flamebearer?.numTicks ?? 1;

    const topFunctions = names
      .slice(0, 20)
      .map((name, i) => ({
        name,
        self: d?.flamebearer?.levels?.[0]?.[i] ?? 0,
        total: d?.flamebearer?.levels?.[0]?.[i] ?? 0,
        pct: ((d?.flamebearer?.levels?.[0]?.[i] ?? 0) / total) * 100,
      }))
      .sort((a, b) => b.pct - a.pct);

    return { service, from, to, type, totalSamples: total, topFunctions };
  }
}

// ---------------------------------------------------------------------------
// ObservabilityClientFactory
// ---------------------------------------------------------------------------

export interface ObservabilityClients {
  prometheus: PrometheusClient;
  tempo: TempoClient;
  loki: LokiClient;
  pyroscope: PyroscopeClient;
}

/**
 * Crear todos los clientes de observabilidad con configuracion por defecto.
 * CHK-API-380: cada cliente usa EC-AI-005 (degradacion graceful).
 */
export function createObservabilityClients(
  config: {
    prometheusUrl?: string;
    tempoUrl?: string;
    lokiUrl?: string;
    pyroscopeUrl?: string;
    timeoutMs?: number;
    authToken?: string;
  } = {}
): ObservabilityClients {
  const authHeaders: Record<string, string> = config.authToken
    ? { Authorization: `Bearer ${config.authToken}` }
    : {};

  return {
    prometheus: new PrometheusClient({
      baseUrl: config.prometheusUrl,
      timeoutMs: config.timeoutMs,
      authHeaders,
    }),
    tempo: new TempoClient({
      baseUrl: config.tempoUrl,
      timeoutMs: config.timeoutMs,
      authHeaders,
    }),
    loki: new LokiClient({
      baseUrl: config.lokiUrl,
      timeoutMs: config.timeoutMs,
      authHeaders,
    }),
    pyroscope: new PyroscopeClient({
      baseUrl: config.pyroscopeUrl,
      timeoutMs: config.timeoutMs,
      authHeaders,
    }),
  };
}

/**
 * Ejecutar una query de observabilidad con el cliente apropiado.
 */
export async function executeObservabilityQuery(
  query: ObservabilityQuery,
  clients: ObservabilityClients
): Promise<ObservabilityResult> {
  switch (query.source) {
    case "prometheus":
      return clients.prometheus.rangeQuery(query);
    case "tempo":
      return clients.tempo.searchTraces(query);
    case "loki":
      return clients.loki.queryRange(query);
    case "pyroscope":
      return clients.pyroscope.getProfile(query);
  }
}
