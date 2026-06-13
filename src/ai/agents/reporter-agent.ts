/**
 * T-119: Reporter Agent — Resumenes adaptativos y publicacion multi-canal
 *
 * Recibe AnalysisReport + metricas y genera:
 *   1. Resumen ejecutivo (alto nivel, impacto de negocio, veredicto Go/No-Go)
 *   2. Resumen tecnico (correlaciones, recomendaciones, metricas granulares)
 *   3. Alertas enriquecidas a Slack/Teams con contexto de bottlenecks
 *   4. Creacion automatica de tickets Jira para bugs de rendimiento
 *
 * FR-174
 * CHK: CHK-API-370, CHK-API-371, CHK-API-372, CHK-SEC-114, CHK-SEC-117, CHK-UX-170
 */

import type { LLMProvider } from "../core/llm-provider.js";
import { AnthropicProvider } from "../core/providers/anthropic-provider.js";

import * as fs from "fs";
import * as path from "path";
import { maskSensitive } from "../../core/secrets-manager";
import type {
  Agent,
  AgentConfig,
  AnalysisReport,
  ValidationResult,
  TokenUsage,
} from "../../types/ai.d";
import { BudgetManager } from "../core/budget-manager.js";
import { DEFAULT_AGENT_CONFIGS } from "../../types/ai.d";

// ---------------------------------------------------------------------------
// Tipos de entrada del Reporter
// ---------------------------------------------------------------------------

export interface ReporterInput {
  analysisReport: AnalysisReport;
  /** Configuracion de notificaciones */
  notify?: {
    slack?: boolean;
    teams?: boolean;
    jira?: boolean;
  };
  /** Audiencia objetivo por canal (ejecutivo vs tecnico) */
  audience?: {
    slack?: "executive" | "technical" | "both";
    teams?: "executive" | "technical" | "both";
  };
  /** Nombre del test para el reporte */
  testName?: string;
  /** Cliente */
  clientId?: string;
  /** ID del proyecto Jira */
  jiraProject?: string;
}

export interface ReporterOutput {
  executiveSummary: string;
  technicalSummary: string;
  /** Resultado de la publicacion en Slack */
  slackResult?: NotificationResult;
  /** Resultado de la publicacion en Teams */
  teamsResult?: NotificationResult;
  /** Resultado de la creacion del ticket Jira */
  jiraResult?: JiraResult;
  /** Metricas de uso de tokens */
  tokensUsed: TokenUsage;
}

export interface NotificationResult {
  sent: boolean;
  channel: string;
  error?: string;
}

export interface JiraResult {
  created: boolean;
  ticketKey?: string;
  ticketUrl?: string;
  persistedLocallyAt?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// ReporterAgent
// ---------------------------------------------------------------------------

export class ReporterAgent implements Agent<ReporterInput, ReporterOutput> {
  readonly name = "reporter-agent";
  readonly version = "1.0.0";

  private readonly config: AgentConfig;
  private readonly provider: LLMProvider;
  private readonly budget: BudgetManager;
  private readonly frameworkRoot: string;

  constructor(options?: {
    config?: Partial<AgentConfig>;
    /** API key — resolves LLM_API_KEY → ANTHROPIC_API_KEY → explicit param. Ignored if `provider` is set. */
    apiKey?: string;
    /** Phase 5 / AI-01 (D-04, D-25): LLM provider injection. Defaults to AnthropicProvider via apiKey fallback chain. */
    provider?: LLMProvider;
    budgetManager?: BudgetManager;
    frameworkRoot?: string;
  }) {
    const defaults = DEFAULT_AGENT_CONFIGS.reporter;
    this.config = { agentId: "reporter", ...defaults, ...options?.config };

    this.provider = options?.provider ?? new AnthropicProvider({ apiKey: options?.apiKey });
    this.budget = options?.budgetManager ?? new BudgetManager({ agentId: "reporter" });
    this.frameworkRoot = options?.frameworkRoot ?? path.resolve(__dirname, "../../../..");
  }

  // -------------------------------------------------------------------------
  // Agent interface
  // -------------------------------------------------------------------------

  validate(input: ReporterInput): ValidationResult {
    const errors = [];
    if (!input.analysisReport) {
      errors.push({ code: "CHK-API-370-a", message: "analysisReport es requerido." });
    }
    if (!input.analysisReport?.id) {
      errors.push({ code: "CHK-API-370-b", message: "analysisReport.id es requerido." });
    }
    return { passed: errors.length === 0, errors, warnings: [] };
  }

  getConfig(): AgentConfig {
    return this.config;
  }

  async execute(input: ReporterInput): Promise<ReporterOutput> {
    const validation = this.validate(input);
    if (!validation.passed) {
      throw new Error(`ReporterAgent: ${validation.errors.map((e) => e.message).join("; ")}`);
    }

    // 1. Generar resumenes via LLM (CHK-API-370)
    this.budget.checkBudget("reporter");
    const { executiveSummary, technicalSummary, tokensUsed } = await this.generateSummaries(input);
    this.budget.recordUsage("reporter", tokensUsed);

    // 2. Publicar en Slack (CHK-API-371)
    let slackResult: NotificationResult | undefined;
    if (input.notify?.slack) {
      slackResult = await this.sendSlackNotification(input, executiveSummary, technicalSummary);
    }

    // 3. Publicar en Teams (CHK-API-371)
    let teamsResult: NotificationResult | undefined;
    if (input.notify?.teams) {
      teamsResult = await this.sendTeamsNotification(input, executiveSummary, technicalSummary);
    }

    // 4. Crear ticket Jira si hay anomalias criticas (CHK-API-372)
    let jiraResult: JiraResult | undefined;
    if (input.notify?.jira) {
      const hasCritical =
        input.analysisReport.anomalies.some((a) => a.severity === "critical") ||
        input.analysisReport.regressions.some((r) => r.severity === "critical");
      if (hasCritical || input.analysisReport.verdict === "fail") {
        jiraResult = await this.createJiraTicket(input, technicalSummary);
      }
    }

    return { executiveSummary, technicalSummary, slackResult, teamsResult, jiraResult, tokensUsed };
  }

  // -------------------------------------------------------------------------
  // Generacion de resumenes LLM (CHK-API-370, CHK-UX-170)
  // -------------------------------------------------------------------------

  private async generateSummaries(input: ReporterInput): Promise<{
    executiveSummary: string;
    technicalSummary: string;
    tokensUsed: TokenUsage;
  }> {
    const report = input.analysisReport;
    const verdictEmoji =
      report.verdict === "pass" ? "✅" : report.verdict === "warning" ? "⚠️" : "❌";
    const testLabel = input.testName ?? report.metadata.clientId ?? "test";

    const userPrompt = `Genera dos resumenes para el reporte de rendimiento de "${testLabel}".

DATOS DEL ANALISIS:
- Veredicto: ${report.verdict.toUpperCase()} ${verdictEmoji}
- Anomalias: ${report.anomalies.length} (${report.anomalies.filter((a) => a.severity === "critical").length} criticas, ${report.anomalies.filter((a) => a.severity === "warning").length} advertencias)
- Regresiones: ${report.regressions.length}
- Correlaciones de causa raiz: ${report.correlations.length}
- Recomendaciones: ${report.recommendations.length}

ANOMALIAS PRINCIPALES:
${JSON.stringify(
  report.anomalies.slice(0, 5).map((a) => ({
    metric: a.metric,
    severity: a.severity,
    description: a.description,
    deviationPct: a.deviationPct,
  })),
  null,
  2
)}

REGRESIONES:
${JSON.stringify(report.regressions.slice(0, 3), null, 2)}

CORRELACIONES:
${JSON.stringify(report.correlations.slice(0, 3), null, 2)}

RECOMENDACIONES TOP 3:
${JSON.stringify(report.recommendations.slice(0, 3), null, 2)}

Resumen del agente de analisis:
${maskSensitive(report.executiveSummary)}

GENERA un JSON con:
{
  "executiveSummary": "2-3 oraciones para ejecutivos. Sin jerga tecnica. Incluye: impacto en usuarios/negocio, veredicto Go/No-Go, tendencia (mejorando/empeorando/estable). Maximo 150 palabras.",
  "technicalSummary": "4-6 oraciones para ingenieros. Incluye: metricas especificas afectadas (p95, error rate), correlaciones de causa raiz mas probables, acciones recomendadas priorizadas, umbral de urgencia. Maximo 300 palabras."
}`;

    const response = await this.provider.chat([{ role: "user", content: userPrompt }], {
      model: this.config.model,
      maxTokens: this.config.maxOutputTokens,
      temperature: this.config.temperature,
      system: `Eres el Reporter Agent del k6 Enterprise Framework. Generas comunicaciones claras sobre resultados de pruebas de rendimiento.
REGLAS: NO expongas tokens, passwords ni datos sensibles. (CHK-SEC-114)
Responde SOLO con JSON valido.`,
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
        executiveSummary: maskSensitive(parsed.executiveSummary ?? ""),
        technicalSummary: maskSensitive(parsed.technicalSummary ?? ""),
        tokensUsed,
      };
    } catch {
      return {
        executiveSummary: maskSensitive(report.executiveSummary),
        technicalSummary: maskSensitive(raw.slice(0, 500)),
        tokensUsed,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Slack notification (CHK-API-371)
  // -------------------------------------------------------------------------

  private async sendSlackNotification(
    input: ReporterInput,
    execSummary: string,
    techSummary: string
  ): Promise<NotificationResult> {
    const webhookUrl = process.env.NOTIFY_SLACK_WEBHOOK;
    if (!webhookUrl) {
      return { sent: false, channel: "slack", error: "NOTIFY_SLACK_WEBHOOK no configurado." };
    }

    const report = input.analysisReport;
    const audience = input.audience?.slack ?? "both";
    const verdictColor =
      report.verdict === "pass" ? "#2ecc71" : report.verdict === "warning" ? "#f39c12" : "#e74c3c";
    const verdictEmoji =
      report.verdict === "pass"
        ? ":white_check_mark:"
        : report.verdict === "warning"
          ? ":warning:"
          : ":x:";

    const blocks: unknown[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${verdictEmoji} Performance Test: ${input.testName ?? "test"} — ${report.verdict.toUpperCase()}`,
        },
      },
    ];

    if (audience === "executive" || audience === "both") {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*Resumen ejecutivo:*\n${maskSensitive(execSummary)}` },
      });
    }

    if (audience === "technical" || audience === "both") {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*Resumen tecnico:*\n${maskSensitive(techSummary)}` },
      });
    }

    // Top anomalias
    if (report.anomalies.length > 0) {
      const criticals = report.anomalies.filter((a) => a.severity === "critical");
      const topAnomalies = (criticals.length > 0 ? criticals : report.anomalies).slice(0, 3);
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `*Anomalias detectadas (${report.anomalies.length}):*\n` +
            topAnomalies.map((a) => `• *${a.metric}*: ${a.description.slice(0, 100)}`).join("\n"),
        },
      });
    }

    // Top recomendaciones
    if (report.recommendations.length > 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `*Recomendaciones:*\n` +
            report.recommendations
              .slice(0, 3)
              .map(
                (r) => `${r.priority}. *${r.title}* (${r.effort}): ${r.description.slice(0, 80)}`
              )
              .join("\n"),
        },
      });
    }

    const payload = {
      attachments: [
        {
          color: verdictColor,
          blocks,
        },
      ],
    };

    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        return { sent: false, channel: "slack", error: `Slack HTTP ${res.status}` };
      }
      return { sent: true, channel: "slack" };
    } catch (err) {
      return { sent: false, channel: "slack", error: String(err) };
    }
  }

  // -------------------------------------------------------------------------
  // Teams notification (CHK-API-371)
  // -------------------------------------------------------------------------

  private async sendTeamsNotification(
    input: ReporterInput,
    execSummary: string,
    techSummary: string
  ): Promise<NotificationResult> {
    const webhookUrl = process.env.NOTIFY_TEAMS_WEBHOOK;
    if (!webhookUrl) {
      return { sent: false, channel: "teams", error: "NOTIFY_TEAMS_WEBHOOK no configurado." };
    }

    const report = input.analysisReport;
    const audience = input.audience?.teams ?? "both";
    const themeColor =
      report.verdict === "pass" ? "2ECC71" : report.verdict === "warning" ? "F39C12" : "E74C3C";

    // Adaptive Card format para Teams
    const facts = report.anomalies.slice(0, 3).map((a) => ({
      name: a.metric,
      value: `${a.severity.toUpperCase()}: ${a.description.slice(0, 80)}`,
    }));

    const payload = {
      "@type": "MessageCard",
      "@context": "http://schema.org/extensions",
      themeColor,
      summary: `Performance Test: ${input.testName ?? "test"} — ${report.verdict.toUpperCase()}`,
      sections: [
        {
          activityTitle: `**Performance Test: ${input.testName ?? "test"}**`,
          activitySubtitle: `Veredicto: ${report.verdict.toUpperCase()}`,
          facts,
          text: audience !== "technical" ? maskSensitive(execSummary) : maskSensitive(techSummary),
        },
      ],
    };

    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        return { sent: false, channel: "teams", error: `Teams HTTP ${res.status}` };
      }
      return { sent: true, channel: "teams" };
    } catch (err) {
      return { sent: false, channel: "teams", error: String(err) };
    }
  }

  // -------------------------------------------------------------------------
  // Jira ticket creation (CHK-API-372, CHK-SEC-117)
  // -------------------------------------------------------------------------

  private async createJiraTicket(
    input: ReporterInput,
    technicalSummary: string
  ): Promise<JiraResult> {
    // Credenciales SOLO desde env vars (CHK-SEC-117)
    const jiraUrl = process.env.JIRA_URL;
    const jiraUser = process.env.JIRA_USER;
    const jiraToken = process.env.JIRA_API_TOKEN;
    const project = input.jiraProject ?? process.env.JIRA_DEFAULT_PROJECT ?? "PERF";

    if (!jiraUrl || !jiraUser || !jiraToken) {
      const localPath = this.persistFindingLocally(input, technicalSummary);
      return {
        created: false,
        persistedLocallyAt: localPath,
        error:
          "Credenciales Jira no configuradas (JIRA_URL, JIRA_USER, JIRA_API_TOKEN). Hallazgo persistido localmente.",
      };
    }

    const report = input.analysisReport;
    const criticalCount = report.anomalies.filter((a) => a.severity === "critical").length;
    const priority = criticalCount >= 3 ? "Highest" : criticalCount >= 1 ? "High" : "Medium";

    const payload = {
      fields: {
        project: { key: project },
        summary: `[PERF] ${input.testName ?? "Performance Test"}: ${report.verdict.toUpperCase()} — ${criticalCount} anomalias criticas`,
        description: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: maskSensitive(technicalSummary).slice(0, 32767) }],
            },
          ],
        },
        issuetype: { name: "Bug" },
        priority: { name: priority },
        labels: ["performance-test", "automated", input.clientId ?? ""].filter(Boolean),
      },
    };

    try {
      const res = await fetch(`${jiraUrl}/rest/api/3/issue`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(`${jiraUser}:${jiraToken}`).toString("base64")}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        // EC-AI-009: persistir localmente
        const localPath = this.persistFindingLocally(input, technicalSummary);
        return {
          created: false,
          persistedLocallyAt: localPath,
          error: `Jira HTTP ${res.status}: ${body.slice(0, 200)}`,
        };
      }

      const data = (await res.json()) as { key: string };
      return {
        created: true,
        ticketKey: data.key,
        ticketUrl: `${jiraUrl}/browse/${data.key}`,
      };
    } catch (err) {
      const localPath = this.persistFindingLocally(input, technicalSummary);
      return {
        created: false,
        persistedLocallyAt: localPath,
        error: `Jira no accesible: ${err}`,
      };
    }
  }

  /** EC-AI-009: persistir hallazgo localmente cuando Jira no esta disponible */
  private persistFindingLocally(input: ReporterInput, summary: string): string {
    const dir = path.join(this.frameworkRoot, "reports", "_jira-pending");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filename = `finding-${Date.now()}.json`;
    const filePath = path.join(dir, filename);
    fs.writeFileSync(
      filePath,
      JSON.stringify(
        {
          testName: input.testName,
          clientId: input.clientId,
          verdict: input.analysisReport.verdict,
          summary: maskSensitive(summary),
          anomalies: input.analysisReport.anomalies.length,
          persistedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
    return filePath;
  }
}
