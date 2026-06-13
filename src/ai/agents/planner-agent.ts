/**
 * T-110: Planner Agent — Generacion de TestPlan desde especificaciones
 *
 * Acepta:
 *   (a) Especificacion OpenAPI/Swagger (JSON o YAML)
 *   (b) Requerimientos funcionales en texto estructurado
 *   (c) Descripcion en lenguaje natural (e.g., "venta flash de Black Friday")
 *
 * Salida: artefacto TestPlan valido, legible y editable por humanos.
 *
 * FR-171
 * CHK: CHK-API-359, CHK-API-360, CHK-API-361, CHK-SEC-111, CHK-UX-168
 */

import type { LLMProvider } from "../core/llm-provider.js";
import { AnthropicProvider } from "../core/providers/anthropic-provider.js";
import type {
  Agent,
  AgentConfig,
  TestPlan,
  EndpointSpec,
  HttpMethod,
  TestType,
  TrafficModel,
  RAGContext,
  ValidationResult,
  ArtifactMetadata,
  TokenUsage,
} from "../../types/ai.d";
import { KnowledgeBaseManager } from "../knowledge-base/knowledge-base.js";
import { BudgetManager } from "../core/budget-manager.js";
import { DEFAULT_AGENT_CONFIGS } from "../../types/ai.d";
import * as crypto from "crypto";

// ---------------------------------------------------------------------------
// Tipos de entrada del Planner
// ---------------------------------------------------------------------------

export type PlannerInputFormat = "openapi" | "text" | "natural-language";

export interface PlannerInput {
  /** Formato de la especificacion */
  format: PlannerInputFormat;
  /** Contenido de la especificacion (JSON string, YAML string, o texto libre) */
  spec: string;
  /** URL base del servicio a testear */
  baseUrl?: string;
  /** ID del cliente para RAG multi-tenant */
  clientId?: string;
  /** Nombre descriptivo para el plan generado */
  planName?: string;
  /** Overrides de configuracion del agente */
  agentOverrides?: Partial<AgentConfig>;
}

// ---------------------------------------------------------------------------
// PlannerAgent
// ---------------------------------------------------------------------------

export class PlannerAgent implements Agent<PlannerInput, TestPlan> {
  readonly name = "planner-agent";
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
    const defaults = DEFAULT_AGENT_CONFIGS.planner;
    this.config = {
      agentId: "planner",
      ...defaults,
      ...options?.config,
    };

    this.provider = options?.provider ?? new AnthropicProvider({ apiKey: options?.apiKey });
    this.kb = options?.knowledgeBaseManager ?? new KnowledgeBaseManager();
    this.budget = options?.budgetManager ?? new BudgetManager({ agentId: "planner" });
  }

  // -------------------------------------------------------------------------
  // Agent interface
  // -------------------------------------------------------------------------

  validate(input: PlannerInput): ValidationResult {
    const errors = [];
    const warnings = [];

    if (!input.spec || input.spec.trim().length < 10) {
      errors.push({
        code: "CHK-API-359-a",
        message: "El campo 'spec' esta vacio o es demasiado corto.",
      });
    }
    if (!["openapi", "text", "natural-language"].includes(input.format)) {
      errors.push({ code: "CHK-API-359-b", message: `Formato '${input.format}' no soportado.` });
    }
    if (input.format === "openapi") {
      try {
        JSON.parse(input.spec);
      } catch {
        // YAML u otro formato no parseable como JSON — advertencia, no error
        warnings.push("La spec OpenAPI no es JSON valido. Se intentara parsear como YAML.");
      }
    }
    if (!input.baseUrl) {
      warnings.push("Sin 'baseUrl'. Se usara __ENV.BASE_URL en el TestPlan generado.");
    }

    return { passed: errors.length === 0, errors, warnings };
  }

  getConfig(): AgentConfig {
    return this.config;
  }

  async execute(input: PlannerInput): Promise<TestPlan> {
    // 1. Validar entrada
    const validation = this.validate(input);
    if (!validation.passed) {
      throw new Error(
        `PlannerAgent input invalid: ${validation.errors.map((e) => e.message).join("; ")}`
      );
    }

    // 2. Consultar base de conocimiento (RAG) para contexto de arquitectura (CHK-API-360)
    const ragContext = await this.fetchRagContext(input);

    // 3. Parsear la especificacion segun el formato
    const parsedSpec = this.parseSpec(input);

    // 4. Invocar al LLM para generar el TestPlan
    const { testPlan, tokensUsed } = await this.generateTestPlan(input, parsedSpec, ragContext);

    // 5. Registrar uso de tokens en el budget manager
    this.budget.recordUsage("planner", tokensUsed);

    return testPlan;
  }

  // -------------------------------------------------------------------------
  // RAG context retrieval
  // -------------------------------------------------------------------------

  private async fetchRagContext(input: PlannerInput): Promise<RAGContext | null> {
    try {
      const query = this.buildRagQuery(input);
      return input.clientId
        ? await this.kb.searchWithClientContext(query, input.clientId, 3)
        : await this.kb.search(query, { topK: 3, type: "doc" });
    } catch {
      // RAG no disponible — continuar sin contexto (degradacion graceful)
      return null;
    }
  }

  private buildRagQuery(input: PlannerInput): string {
    if (input.format === "natural-language") return input.spec.slice(0, 200);
    if (input.format === "openapi") {
      try {
        const parsed = JSON.parse(input.spec);
        return `API ${parsed.info?.title ?? ""} ${parsed.info?.description ?? ""}`.trim();
      } catch {
        return "API specification load test configuration";
      }
    }
    return input.spec.slice(0, 200);
  }

  // -------------------------------------------------------------------------
  // Spec parsing (CHK-API-359)
  // -------------------------------------------------------------------------

  private parseSpec(input: PlannerInput): ParsedSpec {
    switch (input.format) {
      case "openapi":
        return this.parseOpenApiSpec(input.spec);
      case "text":
      case "natural-language":
        return { type: input.format, raw: input.spec, endpoints: [] };
    }
  }

  private parseOpenApiSpec(spec: string): ParsedSpec {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(spec);
    } catch {
      // Intentar parseo simple de YAML-like (solo keys basicos)
      return {
        type: "openapi",
        raw: spec,
        endpoints: [],
        warnings: ["Spec no parseable como JSON. El LLM infiere endpoints del texto."],
      };
    }

    const endpoints: Partial<EndpointSpec>[] = [];
    const warnings: string[] = [];

    if (parsed.paths) {
      for (const [path, methods] of Object.entries(
        parsed.paths as Record<string, Record<string, unknown>>
      )) {
        for (const [method, operation] of Object.entries(methods)) {
          if (!["get", "post", "put", "patch", "delete", "head"].includes(method)) continue;
          const op = operation as {
            requestBody?: { content?: Record<string, { schema?: Record<string, unknown> }> };
            responses?: Record<
              string,
              { content?: Record<string, { schema?: Record<string, unknown> }> }
            >;
            summary?: string;
            operationId?: string;
            tags?: string[];
          };

          // Detectar schema de request body
          const bodySchema = op.requestBody?.content?.["application/json"]?.schema;

          // Status code esperado
          const successStatus =
            Object.keys(op.responses ?? {})
              .map(Number)
              .filter((s) => s >= 200 && s < 300)[0] ?? 200;

          if (!bodySchema && ["post", "put", "patch"].includes(method)) {
            warnings.push(
              `${method.toUpperCase()} ${path}: sin schema de request body — generacion parcial (EC-AI-003)`
            );
          }

          endpoints.push({
            url: path,
            method: method.toUpperCase() as HttpMethod,
            expectedStatus: successStatus,
            responseSchema:
              op.responses?.[String(successStatus)]?.content?.["application/json"]?.schema,
            _description: op.summary ?? op.operationId ?? `${method.toUpperCase()} ${path}`,
            tags: op.tags,
          });
        }
      }
    } else {
      warnings.push("La spec OpenAPI no contiene 'paths'. El LLM infiere endpoints del contenido.");
    }

    return {
      type: "openapi",
      raw: spec,
      endpoints,
      parsedTitle: (parsed.info as { title?: string } | undefined)?.title,
      warnings,
    };
  }

  // -------------------------------------------------------------------------
  // LLM generation (CHK-API-361)
  // -------------------------------------------------------------------------

  private async generateTestPlan(
    input: PlannerInput,
    parsedSpec: ParsedSpec,
    ragContext: RAGContext | null
  ): Promise<{ testPlan: TestPlan; tokensUsed: TokenUsage }> {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(input, parsedSpec, ragContext);

    // Verificar budget antes de invocar (CHK-API-361)
    this.budget.checkBudget("planner");

    const response = await this.provider.chat([{ role: "user", content: userPrompt }], {
      model: this.config.model,
      maxTokens: this.config.maxOutputTokens,
      temperature: this.config.temperature,
      system: systemPrompt,
    });

    const raw = response.text;
    const { usd } = this.provider.estimateCost(response.usage, this.config.model);
    const tokensUsed = {
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      totalTokens: response.usage.totalTokens,
      estimatedCostUsd: usd,
    };

    // Parsear respuesta JSON del LLM
    let planData: Record<string, unknown>;
    try {
      const jsonMatch = raw.match(/```json\n?([\s\S]*?)\n?```/) ?? raw.match(/(\{[\s\S]+\})/);
      planData = JSON.parse(jsonMatch?.[1] ?? raw);
    } catch {
      throw new Error(
        `EC-AI-008: Respuesta del LLM no es JSON parseable. Raw: ${raw.slice(0, 300)}`
      );
    }

    const testPlan = this.buildTestPlan(input, parsedSpec, planData, tokensUsed);
    return { testPlan, tokensUsed };
  }

  private buildSystemPrompt(): string {
    return `Eres el Planner Agent del k6 Enterprise Framework, un experto en diseño de pruebas de rendimiento.
Tu tarea es analizar especificaciones de API y generar un TestPlan estructurado en JSON.

REGLAS:
1. El TestPlan debe ser un JSON valido, sin texto adicional fuera del JSON.
2. Usa __ENV.BASE_URL como baseUrl si no se provee una URL concreta.
3. Para secretos y credenciales, SIEMPRE usa __ENV.VARIABLE_NAME. NUNCA hardcodees valores. (CHK-SEC-111)
4. Genera modelos de trafico realistas con ramping gradual para evitar thundering herd.
5. Incluye thresholds conservadores: p(95)<500ms, error rate <1% para prueba de carga.
6. Incluye campo "confidence" (0.0-1.0) en metadata indicando tu nivel de certeza.
7. Si la spec esta incompleta, genera un plan parcial con "warnings" explicativos (EC-AI-003).
8. NO incluyas informacion sensible de la documentacion interna en el TestPlan. (CHK-SEC-111)

FORMATO DE RESPUESTA:
Responde SOLO con un JSON que siga exactamente esta estructura TestPlan.`;
  }

  private buildUserPrompt(
    input: PlannerInput,
    parsedSpec: ParsedSpec,
    ragContext: RAGContext | null
  ): string {
    const parts: string[] = [];

    // Contexto RAG si esta disponible (CHK-API-360)
    if (ragContext && ragContext.documents.length > 0) {
      parts.push("CONTEXTO DE ARQUITECTURA (documentacion interna relevante):");
      parts.push(
        ragContext.documents
          .slice(0, 2)
          .map((d) => `[${d.metadata.type}] ${d.metadata.description}:\n${d.content.slice(0, 400)}`)
          .join("\n\n")
      );
      parts.push("");
    }

    // Endpoints pre-parseados si los hay
    if (parsedSpec.endpoints && parsedSpec.endpoints.length > 0) {
      parts.push(
        `ENDPOINTS EXTRAIDOS DE LA ESPECIFICACION (${parsedSpec.endpoints.length} endpoints):`
      );
      parts.push(JSON.stringify(parsedSpec.endpoints.slice(0, 20), null, 2));
      parts.push("");
    }

    if (parsedSpec.warnings?.length) {
      parts.push("ADVERTENCIAS DE PARSEO:");
      parts.push(parsedSpec.warnings.join("\n"));
      parts.push("");
    }

    parts.push(`ESPECIFICACION DE ENTRADA (formato: ${input.format}):`);
    parts.push(input.spec.slice(0, this.config.maxInputTokens * 3)); // Limitar tokens

    parts.push("");
    parts.push(`URL BASE: ${input.baseUrl ?? "__ENV.BASE_URL"}`);
    parts.push(`NOMBRE DEL PLAN: ${input.planName ?? "performance-test-" + Date.now()}`);

    parts.push("");
    parts.push(`GENERA un TestPlan JSON con esta estructura exacta:
{
  "id": "uuid-generado",
  "name": "nombre-del-plan",
  "baseUrl": "${input.baseUrl ?? "__ENV.BASE_URL"}",
  "endpoints": [
    {
      "url": "/api/endpoint",
      "method": "GET",
      "headers": {},
      "body": null,
      "expectedStatus": 200,
      "_description": "descripcion del endpoint",
      "requiresAuth": false,
      "tags": ["categoria"]
    }
  ],
  "testTypes": ["load", "stress"],
  "trafficModel": {
    "executor": "ramping-vus",
    "config": {
      "stages": [
        {"duration": "1m", "target": 10},
        {"duration": "3m", "target": 50},
        {"duration": "1m", "target": 0}
      ]
    },
    "estimatedDurationSeconds": 300,
    "thinkTimeSeconds": 1
  },
  "thresholds": {
    "http_req_duration": ["p(95)<500"],
    "http_req_failed": ["rate<0.01"]
  },
  "dataRequirements": {
    "csvFiles": [],
    "factories": []
  },
  "authConfig": {
    "type": "bearer",
    "envVar": "AUTH_TOKEN",
    "_description": "Bearer token desde __ENV.AUTH_TOKEN"
  },
  "source": "${input.format}",
  "warnings": [],
  "metadata": {
    "agentVersion": "1.0.0",
    "generatedAt": "${new Date().toISOString()}",
    "tokensUsed": {"inputTokens": 0, "outputTokens": 0, "totalTokens": 0, "estimatedCostUsd": 0},
    "confidence": 0.85
  }
}`);

    return parts.join("\n");
  }

  private buildTestPlan(
    input: PlannerInput,
    parsedSpec: ParsedSpec,
    planData: Record<string, unknown>,
    tokensUsed: TokenUsage
  ): TestPlan {
    const now = new Date().toISOString();

    // Mezclar warnings del parseo con los del LLM
    const allWarnings = [
      ...(parsedSpec.warnings ?? []),
      ...(Array.isArray(planData.warnings) ? (planData.warnings as string[]) : []),
    ];

    const metadata: ArtifactMetadata = {
      agentVersion: this.version,
      generatedAt: now,
      tokensUsed,
      confidence: (planData.metadata as { confidence?: number } | undefined)?.confidence ?? 0.75,
      clientId: input.clientId,
    };

    return {
      id: (planData.id as string | undefined) ?? crypto.randomUUID(),
      name: (planData.name as string | undefined) ?? input.planName ?? `perf-plan-${Date.now()}`,
      baseUrl: (planData.baseUrl as string | undefined) ?? input.baseUrl ?? "__ENV.BASE_URL",
      endpoints: this.normalizeEndpoints(
        (planData.endpoints as unknown[] | undefined) ?? parsedSpec.endpoints ?? []
      ),
      testTypes: this.normalizeTestTypes(planData.testTypes),
      trafficModel: this.normalizeTrafficModel(planData.trafficModel),
      thresholds: (planData.thresholds as Record<string, string[]> | undefined) ?? {
        http_req_duration: ["p(95)<500"],
        http_req_failed: ["rate<0.01"],
      },
      dataRequirements: (planData.dataRequirements as TestPlan["dataRequirements"]) ?? {
        csvFiles: [],
        factories: [],
      },
      authConfig: (planData.authConfig as TestPlan["authConfig"]) ?? { type: "none" },
      source: input.format,
      warnings: allWarnings,
      metadata,
    };
  }

  private normalizeEndpoints(raw: unknown[]): EndpointSpec[] {
    return raw.map((entry) => {
      const e = (entry ?? {}) as Record<string, unknown>;
      return {
        url: String(e.url ?? "/"),
        method: String(e.method ?? "GET").toUpperCase() as HttpMethod,
        headers: (e.headers as Record<string, string>) ?? {},
        body: e.body as string | Record<string, unknown> | undefined,
        expectedStatus: (e.expectedStatus as number) ?? 200,
        responseSchema: e.responseSchema as Record<string, unknown> | undefined,
        _description: (e._description as string) ?? (e.summary as string) ?? "",
        requiresAuth: (e.requiresAuth as boolean) ?? false,
        tags: (e.tags as string[]) ?? [],
      };
    });
  }

  private normalizeTestTypes(raw: unknown): TestType[] {
    const valid: TestType[] = ["load", "stress", "spike", "soak", "breakpoint"];
    if (!Array.isArray(raw) || raw.length === 0) return ["load"];
    return (raw as unknown[]).filter((t): t is TestType => valid.includes(t as TestType));
  }

  private normalizeTrafficModel(raw: unknown): TrafficModel {
    if (!raw || typeof raw !== "object") {
      return {
        executor: "ramping-vus",
        config: {
          stages: [
            { duration: "1m", target: 10 },
            { duration: "3m", target: 50 },
            { duration: "1m", target: 0 },
          ],
        },
        estimatedDurationSeconds: 300,
        thinkTimeSeconds: 1,
      };
    }
    const r = raw as {
      executor?: string;
      config?: Record<string, unknown>;
      estimatedDurationSeconds?: number;
      thinkTimeSeconds?: number;
    };
    return {
      executor: r.executor ?? "ramping-vus",
      config: r.config ?? {},
      estimatedDurationSeconds: r.estimatedDurationSeconds ?? 300,
      thinkTimeSeconds: r.thinkTimeSeconds ?? 1,
    };
  }
}

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

interface ParsedSpec {
  type: PlannerInputFormat;
  raw: string;
  endpoints: Partial<EndpointSpec>[];
  parsedTitle?: string;
  warnings?: string[];
}
