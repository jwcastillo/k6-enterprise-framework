/**
 * T-107: Interfaces TypeScript para artefactos del pipeline agentico de IA
 *
 * Tipos para: TestPlan, GeneratedScript, AnalysisReport, AgentConfig,
 * PipelineConfig, ObservabilityQuery, RAGContext y la interfaz base Agent.
 *
 * FRs: FR-169, FR-178
 * CHK: CHK-API-361, CHK-API-365, CHK-API-369
 */

// ---------------------------------------------------------------------------
// Primitivos compartidos
// ---------------------------------------------------------------------------

/** Severidad de hallazgos y alertas */
export type Severity = "info" | "warning" | "critical";

/** Resultado de validacion generico */
export interface ValidationResult {
  passed: boolean;
  errors: ValidationError[];
  warnings: string[];
}

export interface ValidationError {
  code: string;
  message: string;
  field?: string;
}

/** Metadata de trazabilidad comun a todos los artefactos */
export interface ArtifactMetadata {
  /** Version del agente que produjo el artefacto */
  agentVersion: string;
  /** Timestamp ISO 8601 de generacion */
  generatedAt: string;
  /** Tokens consumidos en la generacion */
  tokensUsed: TokenUsage;
  /** Confianza del agente (0.0 - 1.0) */
  confidence: number;
  /** ID de correlacion del pipeline */
  correlationId?: string;
  /** Identificador del cliente (multi-tenant) */
  clientId?: string;
}

/** Consumo de tokens por llamada LLM */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

// ---------------------------------------------------------------------------
// TestPlan — salida del Planner Agent, entrada del Builder Agent (FR-171)
// ---------------------------------------------------------------------------

/** Tipos de test de rendimiento soportados */
export type TestType = "load" | "stress" | "spike" | "soak" | "breakpoint";

/** Metodo HTTP */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

/** Definicion de un endpoint a testear */
export interface EndpointSpec {
  /** URL o path relativo al baseUrl */
  url: string;
  method: HttpMethod;
  /** Headers estaticos adicionales */
  headers?: Record<string, string>;
  /** Body de la peticion (puede referenciar __ENV.VARIABLE o factories) */
  body?: string | Record<string, unknown>;
  /** Status code(s) esperados como exitosos */
  expectedStatus: number | number[];
  /** Schema JSON esperado en la respuesta (para validacion) */
  responseSchema?: Record<string, unknown>;
  /** Descripcion legible por humanos */
  _description?: string;
  /** Si el endpoint requiere autenticacion */
  requiresAuth?: boolean;
  /** Etiquetas para agrupar endpoints en el reporte */
  tags?: string[];
}

/** Modelo de trafico — mapea a opciones de k6 */
export interface TrafficModel {
  /** Executor de k6: ramping-vus, constant-arrival-rate, ramping-arrival-rate, etc. */
  executor: string;
  /** Configuracion de VUs o arrival rate segun el executor */
  config: Record<string, unknown>;
  /** Duracion total estimada en segundos */
  estimatedDurationSeconds: number;
  /** Think time entre iteraciones en segundos */
  thinkTimeSeconds?: number;
}

/** Requisitos de datos de prueba */
export interface DataRequirements {
  /** Archivos CSV necesarios con descripcion de columnas */
  csvFiles?: Array<{
    filename: string;
    columns: string[];
    rowsNeeded: number;
    _description?: string;
  }>;
  /** Si se requieren factories (generacion dinamica de datos) */
  factories?: Array<{
    name: string;
    schema: Record<string, unknown>;
    _description?: string;
  }>;
}

/**
 * Auth config attached to AI-generated test plans.
 * Distinct from types/config.d.ts::ClientAuthConfig (client config file shape)
 * and patterns/auth-pattern.ts::AuthConfig (runtime discriminated union).
 */
export interface AiAuthConfig {
  type: "none" | "bearer" | "basic" | "oauth2" | "apikey" | "custom";
  /** Variable de entorno que contiene el token/credencial */
  envVar?: string;
  /** Para OAuth2: URL del token endpoint */
  tokenUrl?: string;
  /** Scopes requeridos para OAuth2 */
  scopes?: string[];
  /** Descripcion legible */
  _description?: string;
}

/** @deprecated renamed to AiAuthConfig — collided with two other AuthConfig shapes. */
export type AuthConfig = AiAuthConfig;

/**
 * TestPlan — artefacto generado por el Planner Agent.
 * Entrada del Builder Agent. Legible y editable por humanos.
 * CHK-API-361
 */
export interface TestPlan {
  /** ID unico del plan */
  id: string;
  /** Nombre descriptivo del plan */
  name: string;
  /** URL base del servicio bajo test */
  baseUrl: string;
  /** Endpoints a incluir en el test */
  endpoints: EndpointSpec[];
  /** Tipos de test a generar */
  testTypes: TestType[];
  /** Modelo de trafico por tipo de test */
  trafficModel: TrafficModel;
  /** Thresholds de calidad */
  thresholds: Record<string, string[]>;
  /** Requisitos de datos */
  dataRequirements: DataRequirements;
  /** Configuracion de autenticacion */
  authConfig: AuthConfig;
  /** Fuente de la especificacion original */
  source: "openapi" | "text" | "natural-language" | "manual";
  /** Warnings generados por el Planner (plan parcial, CHK-EC-AI-003) */
  warnings?: string[];
  /** Metadata de trazabilidad */
  metadata: ArtifactMetadata;
}

// ---------------------------------------------------------------------------
// GeneratedScript — salida del Builder Agent (FR-172)
// ---------------------------------------------------------------------------

/** Tipo de archivo generado */
export type GeneratedFileType = "script" | "data" | "config" | "fixture";

/** Un archivo generado por el Builder Agent */
export interface GeneratedFile {
  /** Path relativo a la raiz del framework */
  path: string;
  /** Contenido del archivo */
  content: string;
  /** Tipo de archivo */
  type: GeneratedFileType;
  /** Lenguaje del archivo para syntax highlighting */
  language?: string;
}

/**
 * GeneratedScript — artefacto producido por el Builder Agent.
 * Contiene uno o mas archivos TypeScript ejecutables y CSVs de datos.
 * CHK-API-362 a CHK-API-365
 */
export interface GeneratedScript {
  /** ID unico */
  id: string;
  /** Archivos generados (scripts .ts, data .csv, config) */
  files: GeneratedFile[];
  /** Resultado de validacion del codigo generado */
  validationResult: ValidationResult;
  /** Numero de ciclos de auto-correccion realizados (max 3) */
  selfHealingCycles: number;
  /** Metadata de trazabilidad */
  metadata: ArtifactMetadata & {
    /** TestPlan que origino este script */
    sourceTestPlan: string;
  };
}

// ---------------------------------------------------------------------------
// AnalysisReport — salida del Analyst Agent (FR-173)
// ---------------------------------------------------------------------------

/** Anomalia detectada en una metrica */
export interface Anomaly {
  /** Metrica afectada (e.g., "http_req_duration_p95") */
  metric: string;
  /** Tipo de anomalia */
  type: "spike" | "drift" | "pattern-change" | "threshold-breach";
  severity: Severity;
  /** Descripcion legible */
  description: string;
  /** Timestamp ISO de la anomalia */
  timestamp: string;
  /** Valor observado */
  observed: number;
  /** Valor esperado (baseline) */
  expected: number;
  /** Desviacion porcentual */
  deviationPct: number;
  /** Algoritmo que detecto la anomalia (zscore/iqr/cusum/percentile) */
  detectedBy: string;
}

/** Correlacion de causa raiz entre metricas y observabilidad */
export interface Correlation {
  /** Metrica o evento fuente (e.g., "http_req_duration spike a las 10:03") */
  source: string;
  /** Metrica o evento correlacionado (e.g., "CPU 95% en auth-service a las 10:03") */
  target: string;
  /** Confianza de la correlacion (0.0 - 1.0) */
  confidence: number;
  /** Descripcion del mecanismo de correlacion */
  description: string;
  /** Fuente de datos de observabilidad (prometheus/tempo/loki/pyroscope) */
  observabilitySource?: "prometheus" | "tempo" | "loki" | "pyroscope";
  /** Timestamp de la correlacion */
  timestamp?: string;
}

/** Regresion detectada comparando con historico */
export interface Regression {
  /** Metrica afectada */
  metric: string;
  severity: Severity;
  /** Valor en la ejecucion actual */
  current: number;
  /** Mejor valor historico (no solo el mas reciente) */
  baseline: number;
  /** Delta relativo (positivo = peor) */
  deltaRel: number;
  /** Unidad de la metrica */
  unit: string;
  /** Descripcion legible */
  description: string;
}

/** Recomendacion de accion */
export interface Recommendation {
  priority: 1 | 2 | 3;
  title: string;
  description: string;
  /** Categoria de la accion */
  category: "infrastructure" | "code" | "configuration" | "database" | "network" | "other";
  /** Esfuerzo estimado */
  effort: "low" | "medium" | "high";
}

/**
 * AnalysisReport — artefacto generado por el Analyst Agent.
 * Contiene anomalias, correlaciones, regresiones y recomendaciones.
 * CHK-API-366 a CHK-API-369
 */
export interface AnalysisReport {
  /** ID unico */
  id: string;
  /** Veredicto general */
  verdict: "pass" | "fail" | "warning";
  /** Anomalias detectadas (ordenadas por severidad) */
  anomalies: Anomaly[];
  /** Correlaciones de causa raiz */
  correlations: Correlation[];
  /** Regresiones vs historico */
  regressions: Regression[];
  /** Recomendaciones de accion */
  recommendations: Recommendation[];
  /** Resumen ejecutivo en texto (generado por LLM) */
  executiveSummary: string;
  /** Si el analisis es parcial (observabilidad no disponible, EC-AI-005) */
  partial: boolean;
  /** Advertencias del analisis */
  warnings: string[];
  /** Metadata de trazabilidad */
  metadata: ArtifactMetadata;
}

// ---------------------------------------------------------------------------
// AgentConfig — configuracion por agente (FR-169)
// ---------------------------------------------------------------------------

/** Configuracion de un agente de IA */
export interface AgentConfig {
  /** Identificador del agente */
  agentId: string;
  /** Modelo LLM a usar */
  model: string;
  /** Temperature (0.0 = determinista, 1.0 = creativo) */
  temperature: number;
  /** Max tokens para la respuesta */
  maxOutputTokens: number;
  /** Max tokens para el contexto/prompt */
  maxInputTokens: number;
  /** Numero maximo de reintentos de auto-correccion */
  maxSelfHealingCycles: number;
  /** Timeout por llamada LLM en segundos */
  timeoutSeconds: number;
  /** Presupuesto de tokens por invocacion (0 = sin limite) */
  tokenBudgetPerInvocation: number;
  /** Configuracion especifica del agente */
  extra?: Record<string, unknown>;
}

/** Configuracion por defecto recomendada por agente */
export const DEFAULT_AGENT_CONFIGS: Record<string, Omit<AgentConfig, "agentId">> = {
  planner: {
    model: "claude-sonnet-4-6",
    temperature: 0.3,
    maxOutputTokens: 4096,
    maxInputTokens: 16000,
    maxSelfHealingCycles: 2,
    timeoutSeconds: 60,
    tokenBudgetPerInvocation: 20000,
  },
  builder: {
    model: "claude-sonnet-4-6",
    temperature: 0.1,
    maxOutputTokens: 8192,
    maxInputTokens: 32000,
    maxSelfHealingCycles: 3,
    timeoutSeconds: 120,
    tokenBudgetPerInvocation: 50000,
  },
  analyst: {
    model: "claude-sonnet-4-6",
    temperature: 0.2,
    maxOutputTokens: 4096,
    maxInputTokens: 16000,
    maxSelfHealingCycles: 2,
    timeoutSeconds: 120,
    tokenBudgetPerInvocation: 20000,
  },
  reporter: {
    model: "claude-sonnet-4-6",
    temperature: 0.4,
    maxOutputTokens: 4096,
    maxInputTokens: 16000,
    maxSelfHealingCycles: 1,
    timeoutSeconds: 60,
    tokenBudgetPerInvocation: 20000,
  },
};

// ---------------------------------------------------------------------------
// PipelineConfig — configuracion del pipeline completo (FR-178)
// ---------------------------------------------------------------------------

/** Configuracion del pipeline agentico completo */
export interface PipelineConfig {
  /** ID del cliente (multi-tenant) */
  clientId: string;
  /** Configuracion por agente (sobrescribe defaults) */
  agents: Partial<Record<"planner" | "builder" | "analyst" | "reporter", Partial<AgentConfig>>>;
  /** Presupuesto total de tokens para todo el pipeline */
  totalTokenBudget: number;
  /** Rate limit: requests por minuto a la API de Claude */
  claudeRpmLimit: number;
  /** Timeout por paso del pipeline en segundos */
  stepTimeouts: {
    planner: number;
    builder: number;
    runTest: number;
    analyst: number;
    reporter: number;
  };
  /** Canales de notificacion habilitados */
  notifications: {
    slack?: boolean;
    teams?: boolean;
    jira?: boolean;
  };
  /** Modo dry-run: validaciones sin LLM ni ejecucion real */
  dryRun: boolean;
  /** Coleccion de ChromaDB para este cliente (aislamiento multi-tenant) */
  knowledgeBaseCollection: string;
}

// ---------------------------------------------------------------------------
// ObservabilityQuery — consulta a backends de observabilidad (FR-177)
// ---------------------------------------------------------------------------

/** Backend de observabilidad */
export type ObservabilitySource = "prometheus" | "tempo" | "loki" | "pyroscope";

/** Consulta a un backend de observabilidad */
export interface ObservabilityQuery {
  source: ObservabilitySource;
  /** Query nativa del backend (PromQL, LogQL, TraceQL, etc.) */
  query: string;
  /** Rango temporal de inicio (ISO 8601 o expresion relativa como "-5m") */
  from: string;
  /** Rango temporal de fin (ISO 8601 o "now") */
  to: string;
  /** Paso para series temporales (e.g., "15s", "1m") */
  step?: string;
  /** Limite de resultados */
  limit?: number;
}

/** Resultado de una consulta de observabilidad */
export interface ObservabilityResult {
  source: ObservabilitySource;
  query: string;
  /** Series temporales (Prometheus/Pyroscope) */
  series?: Array<{
    labels: Record<string, string>;
    values: Array<[number, number]>; // [timestamp_ms, value]
  }>;
  /** Trazas (Tempo) */
  traces?: Array<{
    traceId: string;
    rootServiceName: string;
    rootTraceName: string;
    durationMs: number;
    spans: Array<{
      spanId: string;
      service: string;
      operation: string;
      durationMs: number;
      status: "ok" | "error" | "unset";
    }>;
  }>;
  /** Logs (Loki) */
  logs?: Array<{
    timestamp: string;
    labels: Record<string, string>;
    message: string;
    level?: string;
  }>;
  /** Si el resultado es parcial por indisponibilidad del servicio */
  partial: boolean;
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// RAGContext — contexto recuperado de la base de conocimiento (FR-175)
// ---------------------------------------------------------------------------

/** Un documento recuperado de la base de conocimiento semantica */
export interface RAGDocument {
  id: string;
  content: string;
  /** Score de similitud (0.0 - 1.0, mayor = mas relevante) */
  similarityScore: number;
  metadata: {
    type: "script" | "doc" | "helper" | "pattern";
    path: string;
    description: string;
    /** ID del cliente si es un documento de coleccion privada */
    clientId?: string;
  };
}

/** Contexto RAG completo para un agente */
export interface RAGContext {
  /** Query original en lenguaje natural */
  query: string;
  /** Coleccion consultada */
  collection: string;
  /** Documentos relevantes recuperados */
  documents: RAGDocument[];
  /** Tiempo de busqueda en ms */
  searchLatencyMs: number;
  /** Numero total de documentos en la coleccion */
  totalDocumentsInCollection: number;
}

// ---------------------------------------------------------------------------
// Interfaz base Agent — implementada por todos los agentes (FR-178)
// ---------------------------------------------------------------------------

/**
 * Interfaz base que deben implementar todos los agentes de IA.
 * T = tipo de entrada, R = tipo de resultado
 */
export interface Agent<T, R> {
  /** Nombre unico del agente */
  readonly name: string;
  /** Version semantica del agente */
  readonly version: string;

  /**
   * Ejecutar el agente con una entrada tipada.
   * @param input — artefacto de entrada (TestPlan, AnalysisReport, etc.)
   * @returns resultado del agente
   */
  execute(input: T): Promise<R>;

  /**
   * Validar la entrada antes de ejecutar.
   * Permite detectar inputs invalidos sin consumir tokens LLM.
   */
  validate(input: T): ValidationResult;

  /**
   * Retornar la configuracion activa del agente.
   */
  getConfig(): AgentConfig;
}

// ---------------------------------------------------------------------------
// AgentError — errores estructurados del pipeline (EC-AI-*)
// ---------------------------------------------------------------------------

/** Codigos de error del pipeline de IA */
export type AIErrorCode =
  | "EC-AI-001" // Timeout de llamada LLM
  | "EC-AI-002" // Budget de tokens excedido
  | "EC-AI-003" // TestPlan parcial (OpenAPI incompleta)
  | "EC-AI-004" // Patron no soportado en Builder
  | "EC-AI-005" // Observabilidad no disponible
  | "EC-AI-006" // ChromaDB no disponible
  | "EC-AI-007" // Max reintentos de auto-correccion alcanzado
  | "EC-AI-008" // Respuesta LLM no parseable como JSON
  | "EC-AI-009" // Jira no accesible
  | "EC-AI-010"; // Pipeline timeout excedido

export interface AIError {
  code: AIErrorCode;
  message: string;
  agentName?: string;
  retryable: boolean;
  context?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// PipelineRun — registro de una ejecucion del pipeline
// ---------------------------------------------------------------------------

/** Estado de un paso del pipeline */
export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

/** Resultado de un paso del pipeline */
export interface StepResult {
  stepName: string;
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
  latencyMs?: number;
  tokensUsed?: TokenUsage;
  error?: AIError;
  /** Path al artefacto persistido */
  artifactPath?: string;
}

/** Registro de una ejecucion completa del pipeline */
export interface PipelineRun {
  id: string;
  clientId: string;
  startedAt: string;
  completedAt?: string;
  status: "running" | "completed" | "failed" | "partial";
  steps: StepResult[];
  totalTokensUsed: TokenUsage;
  /** ID del TestPlan inicial */
  testPlanId?: string;
  /** IDs de scripts generados */
  generatedScriptIds?: string[];
  /** ID del reporte de analisis */
  analysisReportId?: string;
}
