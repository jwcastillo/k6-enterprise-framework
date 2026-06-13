/**
 * T-120: Orquestador del pipeline agentico
 *
 * Ejecuta el pipeline completo:
 *   Planner → Builder → run_test (via MCP) → Analyst → Reporter
 *
 * Caracteristicas:
 *   - Progreso visible con timestamps por paso
 *   - Timeouts configurables por paso
 *   - Ejecucion parcial (iniciar desde cualquier paso)
 *   - Modo dry-run (sin LLM ni ejecucion real)
 *   - Artefactos persistidos ante fallos
 *   - Metricas de tokens y latencia por paso
 *
 * FR-178 | CHK-API-373, CHK-UX-171
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type {
  TestPlan,
  GeneratedScript,
  AnalysisReport,
  PipelineConfig,
  PipelineRun,
  StepResult,
  StepStatus,
  AIError,
} from "../../types/ai.d";
import { PlannerAgent, type PlannerInput } from "../agents/planner-agent.js";
import { BuilderAgent } from "../agents/builder-agent.js";
import { AnalystAgent, type AnalystInput } from "../agents/analyst-agent.js";
import { ReporterAgent, type ReporterInput } from "../agents/reporter-agent.js";
import { BudgetManager } from "../core/budget-manager.js";
import { KnowledgeBaseManager } from "../knowledge-base/knowledge-base.js";

// ---------------------------------------------------------------------------
// Tipos del orquestador
// ---------------------------------------------------------------------------

export type PipelineStep = "planner" | "builder" | "run-test" | "analyst" | "reporter";

export interface OrchestratorOptions {
  /** Paso desde el cual iniciar (para ejecucion parcial) */
  startFrom?: PipelineStep;
  /** Paso en el cual terminar */
  endAt?: PipelineStep;
  /** Modo dry-run: validaciones sin LLM ni ejecucion */
  dryRun?: boolean;
  /** Configuracion del pipeline */
  pipelineConfig?: Partial<PipelineConfig>;
  /** Directorio donde persistir artefactos */
  artifactsDir?: string;
  /** Callback de progreso (CHK-UX-171) */
  onProgress?: (step: PipelineStep, status: StepStatus, detail?: string) => void;
}

export interface PipelineInput {
  /** Entrada del Planner (si startFrom=planner) */
  plannerInput?: PlannerInput;
  /** TestPlan pre-existente (si startFrom=builder) */
  testPlan?: TestPlan;
  /** GeneratedScript pre-existente (si startFrom=run-test) */
  generatedScript?: GeneratedScript;
  /** Resultados de k6 pre-existentes (si startFrom=analyst) */
  k6Results?: Record<string, unknown>;
  /** AnalysisReport pre-existente (si startFrom=reporter) */
  analysisReport?: AnalysisReport;
}

export interface PipelineResult {
  runId: string;
  status: "completed" | "failed" | "partial";
  stepsCompleted: PipelineStep[];
  artifacts: {
    testPlan?: TestPlan;
    generatedScript?: GeneratedScript;
    k6Results?: Record<string, unknown>;
    analysisReport?: AnalysisReport;
  };
  pipelineRun: PipelineRun;
  totalDurationMs: number;
  totalCostUsd: number;
}

// ---------------------------------------------------------------------------
// Timeouts por defecto (segundos)
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUTS: Record<PipelineStep, number> = {
  planner: 60,
  builder: 120,
  "run-test": 1800, // 30 minutos
  analyst: 120,
  reporter: 60,
};

const STEP_ORDER: PipelineStep[] = ["planner", "builder", "run-test", "analyst", "reporter"];

// ---------------------------------------------------------------------------
// PipelineOrchestrator
// ---------------------------------------------------------------------------

export class PipelineOrchestrator {
  private readonly options: Required<OrchestratorOptions>;
  private readonly budget: BudgetManager;
  private readonly kb: KnowledgeBaseManager;
  private readonly plannerAgent: PlannerAgent;
  private readonly builderAgent: BuilderAgent;
  private readonly analystAgent: AnalystAgent;
  private readonly reporterAgent: ReporterAgent;
  private readonly artifactsDir: string;

  constructor(options: OrchestratorOptions = {}) {
    const defaultArtifactsDir = path.resolve(process.cwd(), "reports", "_pipeline");

    this.options = {
      startFrom: "planner",
      endAt: "reporter",
      dryRun: false,
      pipelineConfig: {},
      artifactsDir: defaultArtifactsDir,
      onProgress: (): void => {},
      ...options,
    };

    this.artifactsDir = this.options.artifactsDir;
    this.budget = new BudgetManager();

    // Crear base de conocimiento compartida para los agentes
    this.kb = new KnowledgeBaseManager();

    // Inicializar agentes con budget compartido
    const sharedOpts = { budgetManager: this.budget, knowledgeBaseManager: this.kb };
    this.plannerAgent = new PlannerAgent(sharedOpts);
    this.builderAgent = new BuilderAgent(sharedOpts);
    this.analystAgent = new AnalystAgent({ budgetManager: this.budget });
    this.reporterAgent = new ReporterAgent({ budgetManager: this.budget });
  }

  // -------------------------------------------------------------------------
  // Pipeline execution (CHK-API-373)
  // -------------------------------------------------------------------------

  async run(input: PipelineInput): Promise<PipelineResult> {
    const runId = crypto.randomUUID().slice(0, 8);
    const startedAt = new Date().toISOString();
    const globalStart = Date.now();

    // Preparar run record
    const pipelineRun: PipelineRun = {
      id: runId,
      clientId: input.plannerInput?.clientId ?? "unknown",
      startedAt,
      status: "running",
      steps: [],
      totalTokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
    };

    // Reset contadores del pipeline
    BudgetManager.resetPipelineCounters();

    const artifacts: PipelineResult["artifacts"] = {};
    const stepsCompleted: PipelineStep[] = [];
    let pipelineStatus: PipelineResult["status"] = "completed";

    // Determinar pasos a ejecutar
    const startIdx = STEP_ORDER.indexOf(this.options.startFrom);
    const endIdx = STEP_ORDER.indexOf(this.options.endAt);
    const stepsToRun = STEP_ORDER.slice(startIdx, endIdx + 1);

    console.log(
      `\n[Pipeline ${runId}] Iniciando ${this.options.dryRun ? "[DRY-RUN] " : ""}${stepsToRun.join(" → ")}`
    );

    for (const step of stepsToRun) {
      const stepStart = Date.now();
      this.reportProgress(step, "running");
      pipelineRun.steps.push(this.makeStepResult(step, "running", stepStart));

      try {
        await this.executeStep(step, input, artifacts, pipelineRun);
        stepsCompleted.push(step);
        this.updateStepResult(pipelineRun.steps, step, "completed", stepStart);
        this.reportProgress(step, "completed");
        console.log(`  ✓ [${step}] completado en ${Date.now() - stepStart}ms`);
      } catch (err) {
        const aiError = this.wrapError(step, err);
        this.updateStepResult(pipelineRun.steps, step, "failed", stepStart, aiError);
        this.reportProgress(step, "failed", aiError.message);
        console.error(`  ✗ [${step}] fallido: ${aiError.message}`);

        // Persistir artefactos hasta el punto de fallo
        this.persistArtifacts(runId, artifacts);

        pipelineStatus = "failed";
        pipelineRun.status = "failed";
        pipelineRun.completedAt = new Date().toISOString();

        // EC-AI-010: reportar que paso fallo
        break;
      }

      // Respetar endAt
      if (step === this.options.endAt) break;
    }

    if (pipelineStatus !== "failed") {
      // Persistir artefactos finales
      this.persistArtifacts(runId, artifacts);
      pipelineStatus = stepsCompleted.length === stepsToRun.length ? "completed" : "partial";
      pipelineRun.status = pipelineStatus;
      pipelineRun.completedAt = new Date().toISOString();
    }

    // Actualizar tokens totales
    const budgetStatus = BudgetManager.getPipelineStatus();
    pipelineRun.totalTokensUsed = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: budgetStatus.pipelineTokensUsed,
      estimatedCostUsd: budgetStatus.pipelineCostUsd,
    };

    const totalDurationMs = Date.now() - globalStart;
    console.log(
      `\n[Pipeline ${runId}] ${pipelineStatus.toUpperCase()} en ${totalDurationMs}ms | $${budgetStatus.pipelineCostUsd.toFixed(4)} USD\n`
    );

    return {
      runId,
      status: pipelineStatus,
      stepsCompleted,
      artifacts,
      pipelineRun,
      totalDurationMs,
      totalCostUsd: budgetStatus.pipelineCostUsd,
    };
  }

  // -------------------------------------------------------------------------
  // Ejecucion de cada paso
  // -------------------------------------------------------------------------

  private async executeStep(
    step: PipelineStep,
    input: PipelineInput,
    artifacts: PipelineResult["artifacts"],
    run: PipelineRun
  ): Promise<void> {
    const timeoutMs = DEFAULT_TIMEOUTS[step] * 1000;

    switch (step) {
      case "planner": {
        if (!input.plannerInput && !input.testPlan) {
          throw new Error("Planner: plannerInput o testPlan es requerido.");
        }
        if (input.testPlan) {
          artifacts.testPlan = input.testPlan;
          return;
        }
        if (this.options.dryRun) {
          artifacts.testPlan = this.createDryRunTestPlan(input.plannerInput!);
          return;
        }
        artifacts.testPlan = await withTimeout(
          this.plannerAgent.execute(input.plannerInput!),
          timeoutMs,
          "planner"
        );
        run.testPlanId = artifacts.testPlan.id;
        break;
      }

      case "builder": {
        if (!artifacts.testPlan && !input.generatedScript) {
          throw new Error("Builder: testPlan es requerido (ejecutar paso 'planner' primero).");
        }
        if (input.generatedScript) {
          artifacts.generatedScript = input.generatedScript;
          return;
        }
        if (this.options.dryRun) {
          artifacts.generatedScript = this.createDryRunScript(artifacts.testPlan!);
          return;
        }
        artifacts.generatedScript = await withTimeout(
          this.builderAgent.execute(artifacts.testPlan!),
          timeoutMs,
          "builder"
        );
        run.generatedScriptIds = [artifacts.generatedScript.id];
        break;
      }

      case "run-test": {
        if (!artifacts.generatedScript && !input.k6Results) {
          throw new Error("run-test: generatedScript es requerido.");
        }
        if (input.k6Results) {
          artifacts.k6Results = input.k6Results;
          return;
        }
        if (this.options.dryRun) {
          artifacts.k6Results = this.createDryRunK6Results();
          return;
        }
        artifacts.k6Results = await withTimeout(
          this.executeK6Test(artifacts.generatedScript!),
          timeoutMs,
          "run-test"
        );
        break;
      }

      case "analyst": {
        if (!artifacts.k6Results && !input.analysisReport) {
          throw new Error("Analyst: k6Results es requerido.");
        }
        if (input.analysisReport) {
          artifacts.analysisReport = input.analysisReport;
          return;
        }
        if (this.options.dryRun) {
          artifacts.analysisReport = this.createDryRunAnalysisReport(artifacts.k6Results!);
          return;
        }
        const analystInput: AnalystInput = {
          k6Results: artifacts.k6Results!,
          testName: artifacts.testPlan?.name,
          clientId: input.plannerInput?.clientId,
        };
        artifacts.analysisReport = await withTimeout(
          this.analystAgent.execute(analystInput),
          timeoutMs,
          "analyst"
        );
        run.analysisReportId = artifacts.analysisReport.id;
        break;
      }

      case "reporter": {
        if (!artifacts.analysisReport) {
          throw new Error("Reporter: analysisReport es requerido.");
        }
        if (this.options.dryRun) {
          console.log("  [DRY-RUN] Reporter: resumenes omitidos.");
          return;
        }
        const reporterInput: ReporterInput = {
          analysisReport: artifacts.analysisReport,
          testName: artifacts.testPlan?.name,
          clientId: input.plannerInput?.clientId,
          notify: {
            slack: !!process.env.NOTIFY_SLACK_WEBHOOK,
            teams: !!process.env.NOTIFY_TEAMS_WEBHOOK,
            jira: artifacts.analysisReport.verdict === "fail",
          },
        };
        await withTimeout(this.reporterAgent.execute(reporterInput), timeoutMs, "reporter");
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Ejecucion real de k6 via script
  // -------------------------------------------------------------------------

  private async executeK6Test(script: GeneratedScript): Promise<Record<string, unknown>> {
    const mainScript = script.files.find((f) => f.type === "script");
    if (!mainScript) throw new Error("run-test: script principal no encontrado.");

    // Escribir script temporal
    const tmpDir = path.join(this.artifactsDir, "tmp");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const scriptPath = path.join(tmpDir, `${script.id}.ts`);
    const summaryPath = path.join(tmpDir, `${script.id}-summary.json`);
    fs.writeFileSync(scriptPath, mainScript.content, "utf-8");

    try {
      const { execSync } = await import("child_process");
      execSync(`k6 run --summary-export="${summaryPath}" "${scriptPath}"`, {
        cwd: path.dirname(scriptPath),
        stdio: "inherit",
        timeout: 1800000,
      });
    } catch (err) {
      // k6 puede salir con codigo != 0 si hay thresholds fallidos — no es error fatal
      const e = err as { status?: number; message?: string };
      if (e.status !== 0 && e.status !== 99) {
        throw new Error(`k6 fallo con exit code ${e.status}: ${e.message}`);
      }
    }

    if (!fs.existsSync(summaryPath)) {
      throw new Error("run-test: summary.json no generado por k6.");
    }

    return JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
  }

  // -------------------------------------------------------------------------
  // Helpers de dry-run
  // -------------------------------------------------------------------------

  private createDryRunTestPlan(input: PlannerInput): TestPlan {
    return {
      id: `dry-plan-${Date.now()}`,
      name: `dry-plan-${input.planName ?? "test"}`,
      baseUrl: input.baseUrl ?? "__ENV.BASE_URL",
      endpoints: [
        { url: "/api/health", method: "GET", expectedStatus: 200, _description: "[DRY-RUN]" },
      ],
      testTypes: ["load"],
      trafficModel: {
        executor: "ramping-vus",
        config: { stages: [{ duration: "1m", target: 5 }] },
        estimatedDurationSeconds: 60,
      },
      thresholds: { http_req_duration: ["p(95)<500"] },
      dataRequirements: { csvFiles: [], factories: [] },
      authConfig: { type: "none" },
      source: input.format,
      warnings: ["[DRY-RUN] Plan generado sin LLM"],
      metadata: {
        agentVersion: "1.0.0-dryrun",
        generatedAt: new Date().toISOString(),
        tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
        confidence: 0.5,
      },
    };
  }

  private createDryRunScript(plan: TestPlan): GeneratedScript {
    return {
      id: `dry-script-${Date.now()}`,
      files: [
        {
          path: `clients/_generated/${plan.name}.ts`,
          content: `// [DRY-RUN] Script k6 generado\nimport http from "k6/http";\nexport const options = {};\nexport default function() { http.get(__ENV.BASE_URL + "/api/health"); }`,
          type: "script",
          language: "typescript",
        },
      ],
      validationResult: { passed: true, errors: [], warnings: ["[DRY-RUN]"] },
      selfHealingCycles: 0,
      metadata: {
        agentVersion: "1.0.0-dryrun",
        generatedAt: new Date().toISOString(),
        tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
        confidence: 0.5,
        sourceTestPlan: plan.id,
      },
    };
  }

  private createDryRunK6Results(): Record<string, unknown> {
    return {
      metrics: {
        http_req_duration: { values: { avg: 150, p95: 250, p99: 400, max: 800, min: 10 } },
        http_req_failed: { values: { rate: 0.001 } },
        http_reqs: { values: { rate: 50 } },
        vus: { values: { value: 10, max: 10 } },
        iterations: { values: { rate: 45 } },
      },
      state: { testRunDurationMs: 60000 },
      status: 0,
    };
  }

  private createDryRunAnalysisReport(_k6Results: Record<string, unknown>): AnalysisReport {
    return {
      id: `dry-report-${Date.now()}`,
      verdict: "pass",
      anomalies: [],
      correlations: [],
      regressions: [],
      recommendations: [],
      executiveSummary:
        "[DRY-RUN] Analisis simulado sin LLM. Metricas dentro de parametros normales.",
      partial: true,
      warnings: ["[DRY-RUN] Analisis sin datos reales"],
      metadata: {
        agentVersion: "1.0.0-dryrun",
        generatedAt: new Date().toISOString(),
        tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
        confidence: 0.5,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Persistencia de artefactos (CHK-UX-171)
  // -------------------------------------------------------------------------

  private persistArtifacts(runId: string, artifacts: PipelineResult["artifacts"]): void {
    try {
      const dir = path.join(this.artifactsDir, runId);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      if (artifacts.testPlan) {
        fs.writeFileSync(
          path.join(dir, "test-plan.json"),
          JSON.stringify(artifacts.testPlan, null, 2)
        );
      }
      if (artifacts.generatedScript) {
        // Escribir cada archivo generado
        for (const file of artifacts.generatedScript.files) {
          const filePath = path.join(dir, path.basename(file.path));
          fs.writeFileSync(filePath, file.content);
        }
        fs.writeFileSync(
          path.join(dir, "generated-script-meta.json"),
          JSON.stringify(
            {
              id: artifacts.generatedScript.id,
              validationResult: artifacts.generatedScript.validationResult,
              metadata: artifacts.generatedScript.metadata,
            },
            null,
            2
          )
        );
      }
      if (artifacts.k6Results) {
        fs.writeFileSync(
          path.join(dir, "k6-results.json"),
          JSON.stringify(artifacts.k6Results, null, 2)
        );
      }
      if (artifacts.analysisReport) {
        fs.writeFileSync(
          path.join(dir, "analysis-report.json"),
          JSON.stringify(artifacts.analysisReport, null, 2)
        );
      }
    } catch {
      // No fallar el pipeline por errores de persistencia
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private reportProgress(step: PipelineStep, status: StepStatus, detail?: string): void {
    this.options.onProgress(step, status, detail);
    // CHK-UX-171: progreso visible en stdout
    const icon = status === "running" ? "⟳" : status === "completed" ? "✓" : "✗";
    if (status === "running") process.stdout.write(`  ${icon} [${step}]... `);
  }

  private makeStepResult(step: PipelineStep, status: StepStatus, startMs: number): StepResult {
    return {
      stepName: step,
      status,
      startedAt: new Date(startMs).toISOString(),
    };
  }

  private updateStepResult(
    steps: StepResult[],
    step: PipelineStep,
    status: StepStatus,
    startMs: number,
    error?: AIError
  ): void {
    const record = steps.find((s) => s.stepName === step);
    if (record) {
      record.status = status;
      record.completedAt = new Date().toISOString();
      record.latencyMs = Date.now() - startMs;
      if (error) record.error = error;
    }
  }

  private wrapError(step: PipelineStep, err: unknown): AIError {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      code: "EC-AI-010",
      message: `[${step}] ${msg}`,
      agentName: step,
      retryable: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Utilidad: timeout de promesa
// ---------------------------------------------------------------------------

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  stepName: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(`EC-AI-001: Timeout del paso '${stepName}' despues de ${timeoutMs / 1000}s`)
      );
    }, timeoutMs);

    promise.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
