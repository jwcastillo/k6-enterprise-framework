/**
 * T-116: Analyst Agent — Deteccion de anomalias y correlacion de causa raiz
 *
 * Recibe datos de ejecucion (JSON output de k6), logs y metricas de observabilidad.
 * Realiza:
 *   1. Deteccion de anomalias estadisticas (via AnomalyDetector, sin LLM)
 *   2. Correlacion de causa raiz cruzando k6 + observabilidad (via LLM)
 *   3. Deteccion de regresiones vs mejor historico
 *   4. Generacion de AnalysisReport estructurado
 *
 * FR-173, FR-177
 * CHK: CHK-API-366, CHK-API-367, CHK-API-368, CHK-API-369, CHK-SEC-113, CHK-UX-169
 */

import type { LLMProvider } from "../core/llm-provider.js";
import { AnthropicProvider } from "../core/providers/anthropic-provider.js";
import * as crypto from "crypto";
import type {
  Agent,
  AgentConfig,
  AnalysisReport,
  Anomaly,
  Correlation,
  Regression,
  Recommendation,
  ObservabilityQuery,
  ValidationResult,
  TokenUsage,
} from "../../types/ai.d";
import {
  AnomalyDetector,
  k6SummaryToSeries,
  detectRegressions,
  type MetricSeries,
} from "../analysis/anomaly-detector.js";
import {
  createObservabilityClients,
  type ObservabilityClients,
} from "../observability/observability-clients.js";
import { BudgetManager } from "../core/budget-manager.js";
import { DEFAULT_AGENT_CONFIGS } from "../../types/ai.d";

// ---------------------------------------------------------------------------
// Tipos de entrada del Analyst
// ---------------------------------------------------------------------------

export interface AnalystInput {
  /** JSON output de k6 (summary.json) */
  k6Results: Record<string, unknown>;
  /** Ejecuciones historicas (para comparacion con mejor baseline) */
  historicalResults?: Array<Record<string, unknown>>;
  /** Rango temporal de la ejecucion */
  timeRange?: { from: string; to: string };
  /** ID del cliente */
  clientId?: string;
  /** Nombre del test */
  testName?: string;
  /** Overrides de configuracion del agente */
  agentOverrides?: Partial<AgentConfig>;
}

// ---------------------------------------------------------------------------
// AnalystAgent
// ---------------------------------------------------------------------------

export class AnalystAgent implements Agent<AnalystInput, AnalysisReport> {
  readonly name = "analyst-agent";
  readonly version = "1.0.0";

  private readonly config: AgentConfig;
  private readonly provider: LLMProvider;
  private readonly detector: AnomalyDetector;
  private readonly obsClients: ObservabilityClients;
  private readonly budget: BudgetManager;

  constructor(options?: {
    config?: Partial<AgentConfig>;
    /** API key — resolves LLM_API_KEY → ANTHROPIC_API_KEY → explicit param. Ignored if `provider` is set. */
    apiKey?: string;
    /** Phase 5 / AI-01 (D-04, D-25): LLM provider injection. Defaults to AnthropicProvider via apiKey fallback chain. */
    provider?: LLMProvider;
    anomalyDetectorConfig?: ConstructorParameters<typeof AnomalyDetector>[0];
    observabilityClients?: ObservabilityClients;
    budgetManager?: BudgetManager;
  }) {
    const defaults = DEFAULT_AGENT_CONFIGS.analyst;
    this.config = { agentId: "analyst", ...defaults, ...options?.config };

    this.provider = options?.provider ?? new AnthropicProvider({ apiKey: options?.apiKey });
    this.detector = new AnomalyDetector(
      options?.anomalyDetectorConfig ?? { sensitivity: "medium" }
    );
    this.obsClients = options?.observabilityClients ?? createObservabilityClients();
    this.budget = options?.budgetManager ?? new BudgetManager({ agentId: "analyst" });
  }

  // -------------------------------------------------------------------------
  // Agent interface
  // -------------------------------------------------------------------------

  validate(input: AnalystInput): ValidationResult {
    const errors = [];
    const warnings = [];

    if (!input.k6Results || typeof input.k6Results !== "object") {
      errors.push({
        code: "CHK-API-366-a",
        message: "k6Results es requerido y debe ser un objeto JSON.",
      });
    }
    if (!input.timeRange) {
      warnings.push("Sin timeRange: no se podran consultar los backends de observabilidad.");
    }

    return { passed: errors.length === 0, errors, warnings };
  }

  getConfig(): AgentConfig {
    return this.config;
  }

  async execute(input: AnalystInput): Promise<AnalysisReport> {
    // 1. Validar entrada
    const validation = this.validate(input);
    if (!validation.passed) {
      throw new Error(
        `AnalystAgent input invalid: ${validation.errors.map((e) => e.message).join("; ")}`
      );
    }

    // 2. Deteccion de anomalias estadisticas (deterministico, sin LLM) (CHK-API-367)
    const currentSeries = k6SummaryToSeries(input.k6Results);
    const detectionResults = this.detector.detectAll(currentSeries);
    const anomalies: Anomaly[] = detectionResults.flatMap((r) => r.anomalies);

    // 3. Detectar regresiones vs historico (CHK-API-368)
    const regressions: Regression[] = [];
    if (input.historicalResults && input.historicalResults.length > 0) {
      // Usar el mejor historico (no solo el mas reciente)
      const bestBaseline = this.findBestBaseline(input.historicalResults, currentSeries);
      const regressionsRaw = detectRegressions(currentSeries, bestBaseline, 15);
      for (const r of regressionsRaw) {
        regressions.push({
          metric: r.metric,
          severity: r.severity,
          current: r.current,
          baseline: r.baseline,
          deltaRel: r.deltaRel,
          unit: currentSeries.find((s) => s.name === r.metric)?.unit ?? "ms",
          description: `Regresion detectada: ${r.metric} aumentó ${r.deltaRel.toFixed(1)}% respecto al mejor historico.`,
        });
      }
    }

    // 4. Consultar observabilidad si hay timeRange (EC-AI-005: degradacion graceful)
    let obsData: ObservabilityData = { available: false };
    let partial = false;

    if (input.timeRange) {
      obsData = await this.fetchObservabilityData(input.timeRange);
      partial = !obsData.available;
    }

    // 5. Correlacion de causa raiz via LLM (CHK-API-368)
    let correlations: Correlation[] = [];
    let executiveSummary = "";
    let recommendations: Recommendation[] = [];
    let tokensUsed = { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 };

    if (anomalies.length > 0 || regressions.length > 0) {
      this.budget.checkBudget("analyst");

      const llmResult = await this.analyzeWithLLM(input, anomalies, regressions, obsData);
      correlations = llmResult.correlations;
      executiveSummary = llmResult.executiveSummary;
      recommendations = llmResult.recommendations;
      tokensUsed = llmResult.tokensUsed;

      this.budget.recordUsage("analyst", tokensUsed);
    } else {
      executiveSummary = `Ejecucion de ${input.testName ?? "test"} completada sin anomalias detectadas. Metricas dentro de los parametros esperados.`;
    }

    // 6. Determinar veredicto
    const hasCritical =
      anomalies.some((a) => a.severity === "critical") ||
      regressions.some((r) => r.severity === "critical");
    const hasWarning =
      anomalies.some((a) => a.severity === "warning") ||
      regressions.some((r) => r.severity === "warning");
    const verdict = hasCritical ? "fail" : hasWarning ? "warning" : "pass";

    // 7. Construir AnalysisReport (CHK-API-369)
    return {
      id: crypto.randomUUID(),
      verdict,
      anomalies: this.sortBySeverity(anomalies), // CHK-UX-169: ordenados por severidad
      correlations,
      regressions: this.sortBySeverity(regressions),
      recommendations: recommendations.sort((a, b) => a.priority - b.priority),
      executiveSummary,
      partial,
      warnings: partial
        ? ["Analisis parcial: observabilidad no disponible durante la ejecucion."]
        : [],
      metadata: {
        agentVersion: this.version,
        generatedAt: new Date().toISOString(),
        tokensUsed,
        confidence: this.computeConfidence(anomalies, correlations, obsData.available),
        clientId: input.clientId,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Mejor baseline (comparar vs mejor historico, no solo el mas reciente)
  // -------------------------------------------------------------------------

  private findBestBaseline(
    historicalResults: Array<Record<string, unknown>>,
    _currentSeries: MetricSeries[]
  ): MetricSeries[] {
    // El "mejor" historico es el que tiene la menor latencia p95 de http_req_duration
    let bestResult = historicalResults[0];
    let bestP95 = Infinity;

    for (const result of historicalResults) {
      const p95 = (result as { metrics?: { http_req_duration?: { values?: { p95?: number } } } })
        .metrics?.http_req_duration?.values?.p95;
      if (typeof p95 === "number" && p95 < bestP95) {
        bestP95 = p95;
        bestResult = result;
      }
    }

    return k6SummaryToSeries(bestResult);
  }

  // -------------------------------------------------------------------------
  // Consulta de observabilidad (EC-AI-005)
  // -------------------------------------------------------------------------

  private async fetchObservabilityData(timeRange: {
    from: string;
    to: string;
  }): Promise<ObservabilityData> {
    const results: ObservabilityData = { available: false };

    try {
      // Prometheus: latencia, throughput, error rate
      const prometheusQuery: ObservabilityQuery = {
        source: "prometheus",
        query: "rate(http_requests_total[1m])",
        from: timeRange.from,
        to: timeRange.to,
        step: "15s",
      };
      const promResult = await this.obsClients.prometheus.rangeQuery(prometheusQuery);
      if (!promResult.partial) {
        results.prometheus = promResult;
        results.available = true;
      }
    } catch {
      /* EC-AI-005: continuar sin Prometheus */
    }

    try {
      // Loki: errores en logs
      const lokiResult = await this.obsClients.loki.searchErrors(timeRange.from, timeRange.to);
      if (!lokiResult.partial) {
        results.loki = lokiResult;
        results.available = true;
      }
    } catch {
      /* EC-AI-005: continuar sin Loki */
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Analisis LLM para correlaciones y recomendaciones
  // -------------------------------------------------------------------------

  private async analyzeWithLLM(
    input: AnalystInput,
    anomalies: Anomaly[],
    regressions: Regression[],
    obsData: ObservabilityData
  ): Promise<{
    correlations: Correlation[];
    executiveSummary: string;
    recommendations: Recommendation[];
    tokensUsed: TokenUsage;
  }> {
    const userPrompt = this.buildAnalysisPrompt(input, anomalies, regressions, obsData);

    const response = await this.provider.chat([{ role: "user", content: userPrompt }], {
      model: this.config.model,
      maxTokens: this.config.maxOutputTokens,
      temperature: this.config.temperature,
      system: `Eres el Analyst Agent del k6 Enterprise Framework, experto en analisis de rendimiento.
Recibes datos de anomalias, regresiones y observabilidad y debes:
1. Identificar correlaciones de causa raiz entre metricas y observabilidad
2. Generar un resumen ejecutivo claro y sin jerga tecnica excesiva
3. Proporcionar recomendaciones accionables ordenadas por prioridad

REGLAS:
- NO expongas datos sensibles de logs o trazas (tokens, passwords) (CHK-SEC-113)
- Incluye "confidence" (0.0-1.0) en cada correlacion
- El resumen ejecutivo debe ser comprensible para un gerente tecnico
- Las recomendaciones deben ser especificas y accionables
- Responde SOLO con JSON valido siguiendo el schema indicado`,
    });

    const raw = response.text;
    const { usd } = this.provider.estimateCost(response.usage, this.config.model);
    const tokensUsed = {
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      totalTokens: response.usage.totalTokens,
      estimatedCostUsd: usd,
    };

    try {
      const jsonMatch = raw.match(/```json\n?([\s\S]*?)\n?```/) ?? raw.match(/(\{[\s\S]+\})/);
      const parsed = JSON.parse(jsonMatch?.[1] ?? raw);

      return {
        correlations: Array.isArray(parsed.correlations) ? parsed.correlations : [],
        executiveSummary: parsed.executiveSummary ?? "",
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
        tokensUsed,
      };
    } catch {
      // EC-AI-008: respuesta no parseable, retornar datos basicos
      return {
        correlations: [],
        executiveSummary: raw.slice(0, 500),
        recommendations: [],
        tokensUsed,
      };
    }
  }

  private buildAnalysisPrompt(
    input: AnalystInput,
    anomalies: Anomaly[],
    regressions: Regression[],
    obsData: ObservabilityData
  ): string {
    const parts: string[] = [];

    parts.push(`ANALISIS DE RENDIMIENTO — ${input.testName ?? "test"}`);
    parts.push(
      `Rango temporal: ${input.timeRange?.from ?? "N/A"} — ${input.timeRange?.to ?? "N/A"}`
    );
    parts.push("");

    parts.push(`ANOMALIAS DETECTADAS (${anomalies.length}):`);
    parts.push(JSON.stringify(anomalies.slice(0, 10), null, 2));
    parts.push("");

    if (regressions.length > 0) {
      parts.push(`REGRESIONES VS MEJOR HISTORICO (${regressions.length}):`);
      parts.push(JSON.stringify(regressions, null, 2));
      parts.push("");
    }

    if (obsData.available) {
      if (obsData.prometheus?.series?.length) {
        parts.push("DATOS DE PROMETHEUS (metricas de infraestructura):");
        // Solo incluir primeras series para no exceder tokens
        parts.push(JSON.stringify(obsData.prometheus.series.slice(0, 3), null, 2));
        parts.push("");
      }
      if (obsData.loki?.logs?.length) {
        parts.push("LOGS DE ERRORES (Loki — primeros 10):");
        // Enmascarar datos sensibles (CHK-SEC-113)
        const safeLogs = obsData.loki.logs.slice(0, 10).map((l) => ({
          ...l,
          message: l.message
            .replace(/Bearer\s+\S+/gi, "Bearer ***")
            .replace(/password=\S+/gi, "password=***"),
        }));
        parts.push(JSON.stringify(safeLogs, null, 2));
        parts.push("");
      }
    }

    parts.push(`GENERA un JSON con esta estructura EXACTA:
{
  "correlations": [
    {
      "source": "descripcion del evento fuente",
      "target": "descripcion del evento correlacionado",
      "confidence": 0.85,
      "description": "mecanismo de correlacion",
      "observabilitySource": "prometheus|tempo|loki|pyroscope|null",
      "timestamp": "2026-02-18T10:03:00.000Z"
    }
  ],
  "executiveSummary": "Resumen en 2-3 oraciones para gerentes. Impacto, tendencia y veredicto.",
  "recommendations": [
    {
      "priority": 1,
      "title": "titulo corto",
      "description": "descripcion accionable",
      "category": "infrastructure|code|configuration|database|network|other",
      "effort": "low|medium|high"
    }
  ]
}`);

    return parts.join("\n");
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private sortBySeverity<T extends { severity: string }>(items: T[]): T[] {
    const order = { critical: 0, warning: 1, info: 2 };
    return [...items].sort(
      (a, b) =>
        (order[a.severity as keyof typeof order] ?? 3) -
        (order[b.severity as keyof typeof order] ?? 3)
    );
  }

  private computeConfidence(
    anomalies: Anomaly[],
    correlations: Correlation[],
    obsAvailable: boolean
  ): number {
    let confidence = 0.7;
    if (obsAvailable) confidence += 0.15;
    if (correlations.length > 0) confidence += 0.1;
    if (anomalies.length === 0) confidence = Math.max(0.6, confidence); // Sin anomalias = alta confianza
    return Math.min(1.0, Math.round(confidence * 100) / 100);
  }
}

// Tipo interno para datos de observabilidad
interface ObservabilityData {
  available: boolean;
  prometheus?: import("../../types/ai.d").ObservabilityResult;
  loki?: import("../../types/ai.d").ObservabilityResult;
}
