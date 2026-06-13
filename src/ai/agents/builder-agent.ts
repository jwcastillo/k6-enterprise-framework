/**
 * T-111: Builder Agent — Generacion de scripts TypeScript k6 desde TestPlan
 *
 * Recibe un TestPlan y genera scripts TypeScript k6 ejecutables.
 * Consulta la base de conocimiento (RAG) para ejemplos few-shot.
 * Valida el codigo generado con hasta 3 ciclos de auto-correccion.
 *
 * FR-172, FR-175
 * CHK: CHK-API-362, CHK-API-363, CHK-API-364, CHK-API-365, CHK-API-377,
 *      CHK-SEC-112, CHK-UX-173
 */

import type { LLMProvider } from "../core/llm-provider.js";
import { AnthropicProvider } from "../core/providers/anthropic-provider.js";
import * as crypto from "crypto";
import type {
  Agent,
  AgentConfig,
  TestPlan,
  GeneratedScript,
  GeneratedFile,
  ValidationResult,
  RAGContext,
  TokenUsage,
} from "../../types/ai.d";
import { KnowledgeBaseManager } from "../knowledge-base/knowledge-base.js";
import { BudgetManager } from "../core/budget-manager.js";
import { DEFAULT_AGENT_CONFIGS } from "../../types/ai.d";

// ---------------------------------------------------------------------------
// Constantes del Builder
// ---------------------------------------------------------------------------

const MAX_SELF_HEALING_CYCLES = 3; // SC-100 + EC-AI-007

const _FRAMEWORK_HELPERS_IMPORTS = ["RequestHelper", "StructuredLogger", "HeaderHelper"];

// ---------------------------------------------------------------------------
// BuilderAgent
// ---------------------------------------------------------------------------

export class BuilderAgent implements Agent<TestPlan, GeneratedScript> {
  readonly name = "builder-agent";
  readonly version = "1.0.0";

  private readonly config: AgentConfig;
  private readonly provider: LLMProvider;
  private readonly kb: KnowledgeBaseManager;
  private readonly budget: BudgetManager;

  constructor(options?: {
    config?: Partial<AgentConfig>;
    /** API key — resolves LLM_API_KEY → ANTHROPIC_API_KEY → explicit param. Ignored if `provider` is set. */
    apiKey?: string;
    /** Phase 5 / AI-01 (D-04, D-25): LLM provider injection. Defaults to AnthropicProvider via apiKey fallback chain. */
    provider?: LLMProvider;
    knowledgeBaseManager?: KnowledgeBaseManager;
    budgetManager?: BudgetManager;
  }) {
    const defaults = DEFAULT_AGENT_CONFIGS.builder;
    this.config = {
      agentId: "builder",
      ...defaults,
      ...options?.config,
    };

    this.provider = options?.provider ?? new AnthropicProvider({ apiKey: options?.apiKey });
    this.kb = options?.knowledgeBaseManager ?? new KnowledgeBaseManager();
    this.budget = options?.budgetManager ?? new BudgetManager({ agentId: "builder" });
  }

  // -------------------------------------------------------------------------
  // Agent interface
  // -------------------------------------------------------------------------

  validate(input: TestPlan): ValidationResult {
    const errors = [];
    const warnings = [];

    if (!input.id) errors.push({ code: "CHK-API-362-a", message: "TestPlan.id es requerido." });
    if (!input.endpoints || input.endpoints.length === 0) {
      errors.push({ code: "CHK-API-362-b", message: "TestPlan.endpoints no puede estar vacio." });
    }
    if (!input.trafficModel) {
      errors.push({ code: "CHK-API-362-c", message: "TestPlan.trafficModel es requerido." });
    }
    if (!input.baseUrl) {
      warnings.push("TestPlan.baseUrl no definido. Se usara __ENV.BASE_URL.");
    }

    return { passed: errors.length === 0, errors, warnings };
  }

  getConfig(): AgentConfig {
    return this.config;
  }

  async execute(input: TestPlan): Promise<GeneratedScript> {
    // 1. Validar entrada
    const validation = this.validate(input);
    if (!validation.passed) {
      throw new Error(
        `BuilderAgent input invalid: ${validation.errors.map((e) => e.message).join("; ")}`
      );
    }

    // 2. Buscar ejemplos few-shot similares en la base de conocimiento (CHK-API-377)
    const ragContext = await this.fetchFewShotExamples(input);

    // 3. Generar codigo con ciclos de auto-correccion (SC-100, EC-AI-007)
    let generatedCode = "";
    let selfHealingCycles = 0;
    let lastValidation: ValidationResult = { passed: false, errors: [], warnings: [] };
    let totalTokensUsed = { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 };

    for (let cycle = 0; cycle <= MAX_SELF_HEALING_CYCLES; cycle++) {
      // Verificar budget antes de cada ciclo
      this.budget.checkBudget("builder");

      const errorFeedback = cycle > 0 ? lastValidation.errors : undefined;
      const { code, tokensUsed } = await this.generateCode(input, ragContext, errorFeedback);

      // Acumular tokens
      totalTokensUsed.inputTokens += tokensUsed.inputTokens;
      totalTokensUsed.outputTokens += tokensUsed.outputTokens;
      totalTokensUsed.totalTokens += tokensUsed.totalTokens;
      totalTokensUsed.estimatedCostUsd += tokensUsed.estimatedCostUsd;

      this.budget.recordUsage("builder", tokensUsed);

      // Validar el codigo generado
      lastValidation = this.validateGeneratedCode(code);

      if (lastValidation.passed) {
        generatedCode = code;
        selfHealingCycles = cycle;
        break;
      }

      selfHealingCycles = cycle + 1;

      if (cycle === MAX_SELF_HEALING_CYCLES) {
        // EC-AI-007: max reintentos alcanzado
        throw new Error(
          `EC-AI-007: Builder Agent no pudo generar codigo valido despues de ${MAX_SELF_HEALING_CYCLES} reintentos. ` +
            `Ultimo error: ${lastValidation.errors.map((e) => e.message).join("; ")}`
        );
      }

      generatedCode = code; // Usar el ultimo aunque falle (para debug)
    }

    // 4. Generar archivos adicionales (CSVs de datos si el TestPlan los requiere)
    const dataFiles = this.generateDataFiles(input);

    // 5. Construir el artefacto GeneratedScript
    const scriptFile: GeneratedFile = {
      path: this.buildScriptPath(input),
      content: generatedCode,
      type: "script",
      language: "typescript",
    };

    return {
      id: crypto.randomUUID(),
      files: [scriptFile, ...dataFiles],
      validationResult: lastValidation,
      selfHealingCycles,
      metadata: {
        agentVersion: this.version,
        generatedAt: new Date().toISOString(),
        tokensUsed: totalTokensUsed,
        confidence: lastValidation.passed ? 0.9 - selfHealingCycles * 0.1 : 0.3,
        sourceTestPlan: input.id,
      },
    };
  }

  // -------------------------------------------------------------------------
  // RAG few-shot retrieval (CHK-API-377)
  // -------------------------------------------------------------------------

  private async fetchFewShotExamples(input: TestPlan): Promise<RAGContext | null> {
    try {
      const query = this.buildFewShotQuery(input);
      return await this.kb.search(query, { topK: 3, type: "script" });
    } catch {
      return null; // RAG no disponible — continuar sin ejemplos
    }
  }

  private buildFewShotQuery(input: TestPlan): string {
    const methods = [...new Set(input.endpoints.map((e) => e.method))].join(" ");
    const auth = input.authConfig.type !== "none" ? `${input.authConfig.type} authentication` : "";
    const dataPool = input.dataRequirements.csvFiles?.length ? "SharedArray users data pool" : "";
    return [
      `k6 ${input.testTypes.join(" ")} test`,
      methods,
      auth,
      dataPool,
      input.endpoints
        .slice(0, 3)
        .map((e) => e._description ?? e.url)
        .join(" "),
    ]
      .filter(Boolean)
      .join(" ");
  }

  // -------------------------------------------------------------------------
  // Generacion de codigo (CHK-API-362, CHK-API-363, CHK-SEC-112, CHK-UX-173)
  // -------------------------------------------------------------------------

  private async generateCode(
    input: TestPlan,
    ragContext: RAGContext | null,
    errorFeedback?: Array<{ code: string; message: string }>
  ): Promise<{ code: string; tokensUsed: TokenUsage }> {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(input, ragContext, errorFeedback);

    const response = await this.provider.chat([{ role: "user", content: userPrompt }], {
      model: this.config.model,
      maxTokens: this.config.maxOutputTokens,
      temperature: this.config.temperature,
      system: systemPrompt,
    });

    // Extract code from markdown block if wrapped
    const code = this.extractCode(response.text);

    const { usd } = this.provider.estimateCost(response.usage, this.config.model);
    const tokensUsed = {
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      totalTokens: response.usage.totalTokens,
      estimatedCostUsd: usd,
    };

    return { code, tokensUsed };
  }

  private buildSystemPrompt(): string {
    return `Eres el Builder Agent del k6 Enterprise Framework, un experto en escritura de scripts TypeScript k6.

REGLAS ESTRICTAS:
1. El script DEBE importar y usar RequestHelper del framework para TODOS los requests HTTP.
   Importar: import { RequestHelper } from "../../src/helpers/request-helper";
2. El script DEBE usar StructuredLogger para logging estructurado.
   Importar: import { StructuredLogger } from "../../src/helpers/structured-logger";
3. El script DEBE exportar: export const options = { ... } con VUs, duracion y thresholds.
4. El script DEBE exportar: export default function () { ... }
5. NUNCA hardcodees credenciales, passwords, tokens o API keys. SIEMPRE usa __ENV.VARIABLE_NAME. (CHK-SEC-112)
6. NO uses imports de Node.js (fs, path, etc.) — los scripts k6 se ejecutan en el runtime de k6.
7. Incluye comentarios explicativos en cada seccion del script. (CHK-UX-173)
8. Para autenticacion con token: usa headers: { Authorization: \`Bearer \${__ENV.AUTH_TOKEN}\` }
9. Para datos de prueba: usa SharedArray de k6/data para cargar CSVs eficientemente.
10. Los checks k6 deben verificar status code Y validar la respuesta cuando sea posible.

FORMATO DE RESPUESTA:
Responde SOLO con el codigo TypeScript, sin texto adicional antes o despues.
NO uses bloques markdown (sin \`\`\`typescript). Solo el codigo puro.`;
  }

  private buildUserPrompt(
    input: TestPlan,
    ragContext: RAGContext | null,
    errorFeedback?: Array<{ code: string; message: string }>
  ): string {
    const parts: string[] = [];

    // Feedback de errores si es un ciclo de auto-correccion
    if (errorFeedback && errorFeedback.length > 0) {
      parts.push("ERRORES EN EL CODIGO ANTERIOR QUE DEBES CORREGIR:");
      parts.push(errorFeedback.map((e) => `- [${e.code}] ${e.message}`).join("\n"));
      parts.push("Genera una version corregida del script que solucione estos errores.");
      parts.push("");
    }

    // Ejemplos few-shot de la base de conocimiento (CHK-API-377)
    if (ragContext && ragContext.documents.length > 0) {
      parts.push("EJEMPLOS DE SCRIPTS IDIOMATICOS DEL FRAMEWORK (usa como referencia de estilo):");
      ragContext.documents.forEach((doc, i) => {
        parts.push(`--- Ejemplo ${i + 1}: ${doc.metadata.description} ---`);
        parts.push(doc.content.slice(0, 800));
        parts.push("");
      });
    }

    // TestPlan completo
    parts.push("TESTPLAN A IMPLEMENTAR:");
    parts.push(JSON.stringify(input, null, 2));

    parts.push("");
    parts.push("GENERA un script TypeScript k6 que implemente EXACTAMENTE este TestPlan.");
    parts.push("El script debe:");
    parts.push(`- Testear los ${input.endpoints.length} endpoints definidos`);
    parts.push(`- Implementar el executor: ${input.trafficModel.executor}`);
    parts.push(`- Incluir los thresholds: ${JSON.stringify(input.thresholds)}`);
    parts.push(`- Usar autenticacion tipo: ${input.authConfig.type}`);
    if (input.dataRequirements.csvFiles?.length) {
      parts.push(
        `- Cargar datos de: ${input.dataRequirements.csvFiles.map((f) => f.filename).join(", ")}`
      );
    }

    return parts.join("\n");
  }

  private extractCode(raw: string): string {
    // Eliminar bloques markdown si el LLM los incluyó
    const match = raw.match(/```(?:typescript|ts|javascript|js)?\n?([\s\S]*?)\n?```/);
    return match ? match[1].trim() : raw.trim();
  }

  // -------------------------------------------------------------------------
  // Validacion del codigo generado (CHK-API-364)
  // -------------------------------------------------------------------------

  private validateGeneratedCode(code: string): ValidationResult {
    const errors: { code: string; message: string }[] = [];
    const warnings: string[] = [];

    if (!code || code.trim().length < 50) {
      errors.push({
        code: "CHK-API-362-empty",
        message: "El codigo generado esta vacio o es demasiado corto.",
      });
      return { passed: false, errors, warnings };
    }

    // 1. Debe usar RequestHelper o importar k6/http (CHK-API-363)
    if (
      !code.includes("RequestHelper") &&
      !code.includes("from 'k6/http'") &&
      !code.includes('from "k6/http"')
    ) {
      errors.push({
        code: "CHK-API-363-a",
        message: "El script debe importar RequestHelper del framework o 'k6/http'.",
      });
    }

    // 2. Debe tener export default function (CHK-API-362)
    if (!code.match(/export\s+default\s+function/)) {
      errors.push({
        code: "CHK-API-362-fn",
        message: "El script debe exportar una funcion default: 'export default function()'",
      });
    }

    // 3. Debe tener export const options (CHK-API-362)
    if (!code.match(/export\s+const\s+options/)) {
      warnings.push("Sin 'export const options'. Considera agregar VUs, duracion y thresholds.");
    }

    // 4. Sin secretos hardcodeados (CHK-SEC-112)
    const secretPatterns = [
      { pattern: /password\s*=\s*['"][^'"]{4,}['"]/i, label: "password hardcodeado" },
      { pattern: /(?:Bearer|token)\s+(?!__ENV)[A-Za-z0-9._\-]{20,}/i, label: "token hardcodeado" },
      { pattern: /api[_-]?key\s*[:=]\s*['"][^'"]{10,}['"]/i, label: "API key hardcodeada" },
      { pattern: /secret\s*[:=]\s*['"][^'"]{6,}['"]/i, label: "secret hardcodeado" },
    ];
    for (const { pattern, label } of secretPatterns) {
      if (pattern.test(code)) {
        errors.push({
          code: "CHK-SEC-112",
          message: `${label} detectado. Usa __ENV.VARIABLE_NAME.`,
        });
      }
    }

    // 5. Sin imports de Node.js
    const nodeImports = ["from 'fs'", 'from "fs"', "from 'path'", 'from "path"', "require("];
    for (const imp of nodeImports) {
      if (code.includes(imp)) {
        errors.push({
          code: "CHK-API-362-node",
          message: `Import de Node.js detectado: '${imp}'. Los scripts k6 no pueden usar modulos Node.js.`,
        });
      }
    }

    return { passed: errors.length === 0, errors, warnings };
  }

  // -------------------------------------------------------------------------
  // Generacion de archivos de datos (CHK-API-365)
  // -------------------------------------------------------------------------

  private generateDataFiles(input: TestPlan): GeneratedFile[] {
    const files: GeneratedFile[] = [];

    if (!input.dataRequirements.csvFiles?.length) return files;

    for (const csvSpec of input.dataRequirements.csvFiles) {
      // Generar CSV de ejemplo con headers y algunas filas de muestra
      const headers = csvSpec.columns.join(",");
      const sampleRows = Array.from({ length: Math.min(5, csvSpec.rowsNeeded) }, (_, i) =>
        csvSpec.columns.map((col) => `sample_${col}_${i + 1}`).join(",")
      );

      const csvContent = [
        `# ${csvSpec._description ?? csvSpec.filename} — ${csvSpec.rowsNeeded} filas necesarias`,
        `# Reemplaza este archivo con datos reales antes de ejecutar el test`,
        headers,
        ...sampleRows,
      ].join("\n");

      files.push({
        path: `clients/_reference/data/${csvSpec.filename}`,
        content: csvContent,
        type: "data",
        language: "csv",
      });
    }

    return files;
  }

  // -------------------------------------------------------------------------
  // Utilidades
  // -------------------------------------------------------------------------

  private buildScriptPath(input: TestPlan): string {
    const name = input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return `clients/_generated/${name}.ts`;
  }
}
