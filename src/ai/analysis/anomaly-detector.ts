/**
 * T-117: Motor de deteccion de anomalias estadisticas
 *
 * Algoritmos implementados:
 *   - Z-score sobre ventana deslizante
 *   - IQR (Interquartile Range) para outliers robustos
 *   - CUSUM (Cumulative Sum) para deteccion de cambio de tendencia
 *   - Percentile deviation comparando contra distribucion historica
 *
 * Usable standalone (sin LLM) desde CLI o como modulo importable.
 * Consumido por el Analyst Agent pero independiente de el.
 *
 * FR-173 | CHK-API-367
 */

import type { Anomaly, Severity } from "../../types/ai.d";

// ---------------------------------------------------------------------------
// Tipos del detector
// ---------------------------------------------------------------------------

export interface MetricSeries {
  /** Nombre de la metrica (e.g., "http_req_duration_p95") */
  name: string;
  /** Valores en orden temporal */
  values: number[];
  /** Timestamps correspondientes (opcional) */
  timestamps?: number[];
  /** Unidad de la metrica */
  unit?: string;
}

export interface AnomalyDetectorConfig {
  /** Umbral de z-score para detectar anomalia (default: 2.5) */
  zScoreThreshold?: number;
  /** Multiplicador IQR para outliers (default: 1.5) */
  iqrMultiplier?: number;
  /** Umbral de CUSUM para cambio de tendencia (default: 5.0) */
  cusumThreshold?: number;
  /** Umbral de desviacion porcentual (default: 20%) */
  percentileDeviationPct?: number;
  /** Ventana de referencia para calcular estadisticas (en numero de puntos) */
  referenceWindow?: number;
  /** Sensibilidad general: low | medium | high */
  sensitivity?: "low" | "medium" | "high";
  /** Metricas a monitorear (null/undefined = todas) */
  metricsToMonitor?: string[] | null;
}

export interface DetectionResult {
  metric: MetricSeries;
  anomalies: Anomaly[];
  stats: SeriesStats;
}

export interface SeriesStats {
  mean: number;
  stdDev: number;
  median: number;
  p25: number;
  p75: number;
  iqr: number;
  min: number;
  max: number;
  cv: number; // Coefficient of Variation (stdDev/mean)
}

// ---------------------------------------------------------------------------
// Configuracion por defecto segun sensibilidad
// ---------------------------------------------------------------------------

const SENSITIVITY_PRESETS: Record<string, Required<AnomalyDetectorConfig>> = {
  low: {
    zScoreThreshold: 3.5,
    iqrMultiplier: 3.0,
    cusumThreshold: 8.0,
    percentileDeviationPct: 40,
    referenceWindow: 20,
    sensitivity: "low",
    metricsToMonitor: null,
  },
  medium: {
    zScoreThreshold: 2.5,
    iqrMultiplier: 1.5,
    cusumThreshold: 5.0,
    percentileDeviationPct: 20,
    referenceWindow: 10,
    sensitivity: "medium",
    metricsToMonitor: null,
  },
  high: {
    zScoreThreshold: 1.8,
    iqrMultiplier: 1.0,
    cusumThreshold: 3.0,
    percentileDeviationPct: 10,
    referenceWindow: 5,
    sensitivity: "high",
    metricsToMonitor: null,
  },
};

// ---------------------------------------------------------------------------
// AnomalyDetector
// ---------------------------------------------------------------------------

export class AnomalyDetector {
  private readonly config: Required<AnomalyDetectorConfig>;

  constructor(config: AnomalyDetectorConfig = {}) {
    const preset = SENSITIVITY_PRESETS[config.sensitivity ?? "medium"];
    this.config = { ...preset, ...config };
  }

  /**
   * Detectar anomalias en una serie temporal usando todos los algoritmos.
   * Combina resultados y elimina duplicados.
   */
  detect(series: MetricSeries): DetectionResult {
    const values = series.values;
    if (values.length < 3) {
      return { metric: series, anomalies: [], stats: this.computeStats(values) };
    }

    const stats = this.computeStats(values);
    const anomalies: Anomaly[] = [];

    // Ejecutar todos los algoritmos
    const zAnomalies = this.detectZScore(series, stats);
    const iqrAnomalies = this.detectIQR(series, stats);
    const cusumAnomalies = this.detectCUSUM(series, stats);
    const percentileAnomalies = this.detectPercentileDeviation(series, stats);

    // Combinar: un indice que aparece en >= 2 detectores tiene mayor severidad
    const indexSets = [
      new Set(zAnomalies.map((a) => a.timestamp)),
      new Set(iqrAnomalies.map((a) => a.timestamp)),
      new Set(cusumAnomalies.map((a) => a.timestamp)),
      new Set(percentileAnomalies.map((a) => a.timestamp)),
    ];

    // Primero agregar todas las anomalias unicas
    const allCandidates = [
      ...zAnomalies,
      ...iqrAnomalies,
      ...cusumAnomalies,
      ...percentileAnomalies,
    ];
    const seen = new Set<string>();

    for (const anomaly of allCandidates) {
      const key = `${anomaly.timestamp}-${anomaly.type}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Elevar severidad si multiple detectores coinciden
      const detectorsHit = indexSets.filter((s) => s.has(anomaly.timestamp)).length;
      if (detectorsHit >= 3) {
        anomaly.severity = "critical";
      } else if (detectorsHit >= 2) {
        anomaly.severity = anomaly.severity === "info" ? "warning" : anomaly.severity;
      }

      anomalies.push(anomaly);
    }

    // Ordenar por timestamp
    anomalies.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    return { metric: series, anomalies, stats };
  }

  /**
   * Detectar anomalias en multiples series temporales.
   */
  detectAll(series: MetricSeries[]): DetectionResult[] {
    const toMonitor = this.config.metricsToMonitor;
    const filtered = toMonitor ? series.filter((s) => toMonitor.includes(s.name)) : series;

    return filtered.map((s) => this.detect(s));
  }

  // -------------------------------------------------------------------------
  // Algoritmo 1: Z-Score
  // -------------------------------------------------------------------------

  /**
   * Detecta valores que se desvian >N desviaciones estandar de la media.
   * Bueno para distribuciones normales con outliers agudos (spikes).
   */
  private detectZScore(series: MetricSeries, stats: SeriesStats): Anomaly[] {
    const anomalies: Anomaly[] = [];
    if (stats.stdDev === 0) return anomalies;

    series.values.forEach((value, i) => {
      const zScore = Math.abs((value - stats.mean) / stats.stdDev);
      if (zScore > this.config.zScoreThreshold) {
        const isIncrease = value > stats.mean;
        anomalies.push({
          metric: series.name,
          type: isIncrease ? "spike" : "spike",
          severity: this.zScoreToSeverity(zScore, this.config.zScoreThreshold),
          description: `Z-score ${zScore.toFixed(2)} (umbral: ${this.config.zScoreThreshold}). Valor ${isIncrease ? "elevado" : "bajo"} inusualmente.`,
          timestamp: this.getTimestamp(series, i),
          observed: value,
          expected: stats.mean,
          deviationPct: ((value - stats.mean) / stats.mean) * 100,
          detectedBy: "zscore",
        });
      }
    });

    return anomalies;
  }

  private zScoreToSeverity(zScore: number, threshold: number): Severity {
    if (zScore > threshold * 2) return "critical";
    if (zScore > threshold * 1.5) return "warning";
    return "info";
  }

  // -------------------------------------------------------------------------
  // Algoritmo 2: IQR (Interquartile Range)
  // -------------------------------------------------------------------------

  /**
   * Detecta outliers usando la regla de Tukey (Q1 - k*IQR, Q3 + k*IQR).
   * Mas robusto que z-score para distribuciones no normales (heavy-tailed).
   */
  private detectIQR(series: MetricSeries, stats: SeriesStats): Anomaly[] {
    const anomalies: Anomaly[] = [];
    const lowerFence = stats.p25 - this.config.iqrMultiplier * stats.iqr;
    const upperFence = stats.p75 + this.config.iqrMultiplier * stats.iqr;

    series.values.forEach((value, i) => {
      if (value > upperFence) {
        anomalies.push({
          metric: series.name,
          type: "spike",
          severity: value > upperFence * 1.5 ? "critical" : "warning",
          description: `IQR: valor ${value.toFixed(2)} supera fence superior ${upperFence.toFixed(2)} (Q3+${this.config.iqrMultiplier}*IQR).`,
          timestamp: this.getTimestamp(series, i),
          observed: value,
          expected: stats.median,
          deviationPct: ((value - stats.median) / stats.median) * 100,
          detectedBy: "iqr",
        });
      } else if (value < lowerFence && lowerFence > 0) {
        anomalies.push({
          metric: series.name,
          type: "spike",
          severity: "info",
          description: `IQR: valor ${value.toFixed(2)} por debajo de fence inferior ${lowerFence.toFixed(2)}.`,
          timestamp: this.getTimestamp(series, i),
          observed: value,
          expected: stats.median,
          deviationPct: ((value - stats.median) / stats.median) * 100,
          detectedBy: "iqr",
        });
      }
    });

    return anomalies;
  }

  // -------------------------------------------------------------------------
  // Algoritmo 3: CUSUM (Cumulative Sum)
  // -------------------------------------------------------------------------

  /**
   * Detecta cambios de tendencia acumulados (drift gradual).
   * Bueno para memory leaks, degradacion gradual de latencia.
   */
  private detectCUSUM(series: MetricSeries, stats: SeriesStats): Anomaly[] {
    const anomalies: Anomaly[] = [];
    const k = stats.stdDev * 0.5; // Parametro de tolerancia
    const h = this.config.cusumThreshold * stats.stdDev; // Umbral de deteccion

    let cumsumPos = 0;
    let cumsumNeg = 0;
    let driftStartIdx: number | null = null;

    series.values.forEach((value, i) => {
      cumsumPos = Math.max(0, cumsumPos + value - stats.mean - k);
      cumsumNeg = Math.max(0, cumsumNeg - value + stats.mean - k);

      if (cumsumPos > h || cumsumNeg > h) {
        if (driftStartIdx === null) driftStartIdx = i;

        if (i === series.values.length - 1 || (cumsumPos <= h && cumsumNeg <= h)) {
          const driftDuration = i - (driftStartIdx ?? i);
          if (driftDuration >= 2) {
            // Solo reportar drifts que duran al menos 3 puntos
            anomalies.push({
              metric: series.name,
              type: "drift",
              severity: driftDuration >= 5 ? "critical" : driftDuration >= 3 ? "warning" : "info",
              description: `CUSUM: cambio de tendencia detectado durante ${driftDuration + 1} periodos. CUSUM+=${cumsumPos.toFixed(2)}, CUSUM-=${cumsumNeg.toFixed(2)}.`,
              timestamp: this.getTimestamp(series, driftStartIdx ?? i),
              observed: stats.mean + Math.max(cumsumPos, cumsumNeg) / series.values.length,
              expected: stats.mean,
              deviationPct:
                (Math.max(cumsumPos, cumsumNeg) / (stats.mean * series.values.length)) * 100,
              detectedBy: "cusum",
            });
          }
          driftStartIdx = null;
        }
      } else {
        if (driftStartIdx !== null) driftStartIdx = null;
        cumsumPos = Math.max(0, cumsumPos);
        cumsumNeg = Math.max(0, cumsumNeg);
      }
    });

    return anomalies;
  }

  // -------------------------------------------------------------------------
  // Algoritmo 4: Percentile Deviation
  // -------------------------------------------------------------------------

  /**
   * Detecta desviaciones significativas respecto al percentil de referencia.
   * Compara el valor actual contra la distribucion historica.
   */
  private detectPercentileDeviation(series: MetricSeries, _stats: SeriesStats): Anomaly[] {
    const anomalies: Anomaly[] = [];
    const window = this.config.referenceWindow;

    // Comparar cada punto contra la ventana de referencia anterior
    series.values.forEach((value, i) => {
      if (i < window) return; // No hay suficiente historia

      const refValues = series.values.slice(Math.max(0, i - window), i);
      const refStats = this.computeStats(refValues);

      if (refStats.mean === 0) return;

      const deviationPct = ((value - refStats.mean) / refStats.mean) * 100;

      if (Math.abs(deviationPct) > this.config.percentileDeviationPct) {
        const _isRegression = deviationPct > 0; // Para latencia, mayor = peor
        anomalies.push({
          metric: series.name,
          type:
            Math.abs(deviationPct) > this.config.percentileDeviationPct * 2
              ? "spike"
              : "pattern-change",
          severity:
            Math.abs(deviationPct) > this.config.percentileDeviationPct * 3
              ? "critical"
              : Math.abs(deviationPct) > this.config.percentileDeviationPct * 1.5
                ? "warning"
                : "info",
          description: `Desviacion del ${Math.abs(deviationPct).toFixed(1)}% respecto a la media de la ventana de ${window} puntos (${refStats.mean.toFixed(2)}).`,
          timestamp: this.getTimestamp(series, i),
          observed: value,
          expected: refStats.mean,
          deviationPct,
          detectedBy: "percentile",
        });
      }
    });

    return anomalies;
  }

  // -------------------------------------------------------------------------
  // Estadisticas descriptivas
  // -------------------------------------------------------------------------

  computeStats(values: number[]): SeriesStats {
    if (values.length === 0) {
      return { mean: 0, stdDev: 0, median: 0, p25: 0, p75: 0, iqr: 0, min: 0, max: 0, cv: 0 };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;

    const mean = values.reduce((s, v) => s + v, 0) / n;
    const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / n;
    const stdDev = Math.sqrt(variance);

    const median = this.percentile(sorted, 50);
    const p25 = this.percentile(sorted, 25);
    const p75 = this.percentile(sorted, 75);
    const iqr = p75 - p25;
    const cv = mean !== 0 ? stdDev / mean : 0;

    return {
      mean: round(mean),
      stdDev: round(stdDev),
      median: round(median),
      p25: round(p25),
      p75: round(p75),
      iqr: round(iqr),
      min: sorted[0],
      max: sorted[n - 1],
      cv: round(cv),
    };
  }

  private percentile(sortedValues: number[], p: number): number {
    const n = sortedValues.length;
    if (n === 0) return 0;
    const idx = (p / 100) * (n - 1);
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    if (lower === upper) return sortedValues[lower];
    return sortedValues[lower] + (idx - lower) * (sortedValues[upper] - sortedValues[lower]);
  }

  private getTimestamp(series: MetricSeries, index: number): string {
    if (series.timestamps && series.timestamps[index]) {
      return new Date(series.timestamps[index]).toISOString();
    }
    return new Date().toISOString();
  }
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function round(n: number, decimals = 3): number {
  return Math.round(n * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

/**
 * Convertir summary JSON de k6 a series temporales para el detector.
 */
export function k6SummaryToSeries(summary: Record<string, unknown>): MetricSeries[] {
  const series: MetricSeries[] = [];
  const metrics = (summary as { metrics?: Record<string, unknown> }).metrics ?? {};

  // Metricas clave de k6
  const KEY_METRICS: Record<string, string> = {
    http_req_duration: "ms",
    http_req_failed: "rate",
    iterations: "count",
    vus: "count",
    http_reqs: "rate",
    data_received: "bytes",
    data_sent: "bytes",
  };

  for (const [metricName, unit] of Object.entries(KEY_METRICS)) {
    const metric = metrics[metricName];
    if (!metric) continue;

    // Extraer valores disponibles del summary
    const values: number[] = [];
    const m = metric as {
      values?: {
        p95?: number;
        p99?: number;
        avg?: number;
        max?: number;
        rate?: number;
        value?: number;
      };
    };

    if (m.values?.p95 !== undefined) values.push(m.values.p95);
    if (m.values?.p99 !== undefined) values.push(m.values.p99);
    if (m.values?.avg !== undefined) values.push(m.values.avg);
    if (m.values?.max !== undefined) values.push(m.values.max);
    if (m.values?.rate !== undefined) values.push(m.values.rate);
    if (m.values?.value !== undefined) values.push(m.values.value);

    if (values.length > 0) {
      series.push({ name: metricName, values, unit });
    }
  }

  return series;
}

/**
 * Detectar regressions comparando dos conjuntos de metricas.
 * Para el Analyst Agent: compara ejecucion actual vs mejor historico.
 */
export function detectRegressions(
  current: MetricSeries[],
  baseline: MetricSeries[],
  thresholdPct = 15
): Array<{
  metric: string;
  current: number;
  baseline: number;
  deltaRel: number;
  severity: Severity;
}> {
  const regressions = [];
  const baselineMap = new Map(baseline.map((s) => [s.name, s]));

  for (const currentSeries of current) {
    const baselineSeries = baselineMap.get(currentSeries.name);
    if (!baselineSeries) continue;

    const currentMean =
      currentSeries.values.reduce((s, v) => s + v, 0) / currentSeries.values.length;
    const baselineMean =
      baselineSeries.values.reduce((s, v) => s + v, 0) / baselineSeries.values.length;

    if (baselineMean === 0) continue;

    const deltaRel = ((currentMean - baselineMean) / baselineMean) * 100;

    // Para latencia: mayor = peor. Para error rate: mayor = peor.
    // Para throughput: menor = peor (invertir signo).
    const isThroughput = ["http_reqs", "iterations"].includes(currentSeries.name);
    const isRegression = isThroughput ? deltaRel < -thresholdPct : deltaRel > thresholdPct;

    if (isRegression) {
      const absDelta = Math.abs(deltaRel);
      regressions.push({
        metric: currentSeries.name,
        current: round(currentMean),
        baseline: round(baselineMean),
        deltaRel: round(deltaRel),
        severity: (absDelta > thresholdPct * 3
          ? "critical"
          : absDelta > thresholdPct * 2
            ? "warning"
            : "info") as Severity,
      });
    }
  }

  return regressions;
}
