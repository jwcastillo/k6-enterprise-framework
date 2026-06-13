/**
 * T-109: Extension del servidor MCP con tools para agentes de IA
 *
 * Nuevos tools:
 *   query_knowledge_base     — busqueda RAG en ChromaDB
 *   get_observability_data   — consultas a Prometheus/Tempo/Loki/Pyroscope
 *   validate_generated_code  — validacion de codigo TypeScript generado
 *   get_test_history         — historico de ejecuciones de un cliente/test
 *   create_jira_ticket       — crear ticket en Jira para bug de rendimiento
 *
 * FRs: FR-170, FR-177
 * CHK: CHK-API-350, CHK-API-358, CHK-SEC-109, CHK-SEC-110, CHK-SEC-117, CHK-UX-167
 */

import { execSync } from "child_process";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { FRAMEWORK_ROOT, sanitizeArg, mcpError, formatError } from "../utils/framework.js";

// ---------------------------------------------------------------------------
// Utilidades de validacion y seguridad
// ---------------------------------------------------------------------------

/** Validar que un string no contiene caracteres de inyeccion de comandos (CHK-SEC-110) */
function validateNoInjection(value: string, fieldName: string): void {
  // Bloquear caracteres shell peligrosos
  const DANGEROUS = /[;&|`$<>\\]/;
  if (DANGEROUS.test(value)) {
    throw mcpError(
      "INVALID_PARAMS",
      `Campo '${fieldName}' contiene caracteres no permitidos.`
    );
  }
}

/** Enmascarar URLs con credenciales en outputs (CHK-SEC-110) */
function maskSensitiveData(text: string): string {
  return text
    .replace(/https?:\/\/[^:@\s]+:[^@\s]+@/gi, "https://***:***@")
    .replace(/Bearer\s+[A-Za-z0-9._-]{20,}/gi, "Bearer ***")
    .replace(/token[=:]\s*[A-Za-z0-9._-]{10,}/gi, "token=***");
}

// ---------------------------------------------------------------------------
// query_knowledge_base — CHK-API-374
// ---------------------------------------------------------------------------

export interface QueryKnowledgeBaseParams {
  query: string;
  collection?: string;
  top_k?: number;
  type?: "script" | "doc" | "helper" | "pattern";
  client_id?: string;
}

export interface QueryKnowledgeBaseResult {
  query: string;
  collection: string;
  documents: Array<{
    id: string;
    path: string;
    type: string;
    description: string;
    similarityScore: number;
    preview: string;
  }>;
  totalDocumentsInCollection: number;
  searchLatencyMs: number;
}

export async function queryKnowledgeBase(
  params: QueryKnowledgeBaseParams
): Promise<QueryKnowledgeBaseResult> {
  try {
    const { query, top_k = 5, type, client_id } = params;

    if (!query || query.trim().length < 3) {
      throw mcpError("INVALID_PARAMS", "El campo 'query' debe tener al menos 3 caracteres.");
    }
    validateNoInjection(query, "query");
    if (client_id) validateNoInjection(client_id, "client_id");

    // Importar el manager en runtime para no requerir chromadb en arranque del MCP
    const { KnowledgeBaseManager } = await import(
      "../../../../../../k6-framework/src/ai/knowledge-base/knowledge-base.js" as string
    ).catch(() => {
      throw mcpError(
        "DEPENDENCY_ERROR",
        "Modulo knowledge-base no disponible. Asegurate de compilar el framework."
      );
    });

    const manager = new KnowledgeBaseManager();

    const ctx = client_id
      ? await manager.searchWithClientContext(query.trim(), client_id, top_k)
      : await manager.search(query.trim(), { topK: top_k, type });

    return {
      query: ctx.query,
      collection: ctx.collection,
      documents: ctx.documents.map((doc: any) => ({
        id: doc.id,
        path: doc.metadata.path,
        type: doc.metadata.type,
        description: doc.metadata.description,
        similarityScore: Math.round(doc.similarityScore * 1000) / 1000,
        preview: doc.content.slice(0, 300).replace(/\n/g, " "),
      })),
      totalDocumentsInCollection: ctx.totalDocumentsInCollection,
      searchLatencyMs: ctx.searchLatencyMs,
    };
  } catch (err) {
    throw formatError(err);
  }
}

// ---------------------------------------------------------------------------
// get_observability_data — CHK-API-380
// ---------------------------------------------------------------------------

export interface GetObservabilityDataParams {
  source: "prometheus" | "tempo" | "loki" | "pyroscope";
  query: string;
  from: string;
  to?: string;
  step?: string;
  limit?: number;
}

export interface GetObservabilityDataResult {
  source: string;
  query: string;
  data: unknown;
  partial: boolean;
  latencyMs: number;
}

export async function getObservabilityData(
  params: GetObservabilityDataParams
): Promise<GetObservabilityDataResult> {
  try {
    const { source, query, from, to = "now", step = "15s", limit = 100 } = params;

    const VALID_SOURCES = ["prometheus", "tempo", "loki", "pyroscope"];
    if (!VALID_SOURCES.includes(source)) {
      throw mcpError(
        "INVALID_PARAMS",
        `source debe ser uno de: ${VALID_SOURCES.join(", ")}`
      );
    }

    validateNoInjection(query, "query");
    validateNoInjection(from, "from");
    validateNoInjection(to, "to");

    const start = Date.now();

    // URLs internas de los servicios (solo accesibles en k6-net)
    const SERVICE_URLS: Record<string, string> = {
      prometheus: process.env.PROMETHEUS_URL ?? "http://prometheus:9090",
      tempo: process.env.TEMPO_URL ?? "http://tempo:3200",
      loki: process.env.LOKI_URL ?? "http://loki:3100",
      pyroscope: process.env.PYROSCOPE_URL ?? "http://pyroscope:4040",
    };

    const baseUrl = SERVICE_URLS[source];
    let endpoint: string;
    let data: unknown = null;
    let partial = false;

    try {
      switch (source) {
        case "prometheus": {
          // PromQL range query
          const url = `${baseUrl}/api/v1/query_range?query=${encodeURIComponent(query)}&start=${encodeURIComponent(from)}&end=${encodeURIComponent(to)}&step=${encodeURIComponent(step)}`;
          const res = await fetchWithTimeout(url, 10000);
          data = await res.json();
          break;
        }
        case "loki": {
          // LogQL query_range
          const url = `${baseUrl}/loki/api/v1/query_range?query=${encodeURIComponent(query)}&start=${encodeURIComponent(from)}&end=${encodeURIComponent(to)}&limit=${limit}`;
          const res = await fetchWithTimeout(url, 10000);
          data = await res.json();
          break;
        }
        case "tempo": {
          // Busqueda de trazas por tags o traceID
          endpoint = query.match(/^[0-9a-f]{16,32}$/i)
            ? `${baseUrl}/api/traces/${query}`
            : `${baseUrl}/api/search?tags=${encodeURIComponent(query)}&start=${encodeURIComponent(from)}&end=${encodeURIComponent(to)}&limit=${limit}`;
          const res = await fetchWithTimeout(endpoint, 10000);
          data = await res.json();
          break;
        }
        case "pyroscope": {
          // Flame graph data
          const url = `${baseUrl}/pyroscope/render?query=${encodeURIComponent(query)}&from=${encodeURIComponent(from)}&until=${encodeURIComponent(to)}&format=json`;
          const res = await fetchWithTimeout(url, 10000);
          data = await res.json();
          break;
        }
      }
    } catch (fetchErr) {
      // EC-AI-005: degradacion graceful si servicio no disponible
      partial = true;
      data = {
        error: `Servicio ${source} no disponible: ${fetchErr}`,
        hint: `Asegurate de que el perfil 'observability' esta activo: ./bin/observability.sh up --full`,
      };
    }

    return {
      source,
      query: maskSensitiveData(query),
      data,
      partial,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    throw formatError(err);
  }
}

/** fetch con timeout */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// validate_generated_code — CHK-API-364
// ---------------------------------------------------------------------------

export interface ValidateGeneratedCodeParams {
  code: string;
  filename?: string;
}

export interface ValidateGeneratedCodeResult {
  valid: boolean;
  errors: Array<{ code: string; message: string; line?: number }>;
  warnings: string[];
}

export async function validateGeneratedCode(
  params: ValidateGeneratedCodeParams
): Promise<ValidateGeneratedCodeResult> {
  try {
    const { code, filename = "generated-script.ts" } = params;

    if (!code || code.trim().length === 0) {
      throw mcpError("INVALID_PARAMS", "El campo 'code' no puede estar vacio.");
    }

    const errors: Array<{ code: string; message: string; line?: number }> = [];
    const warnings: string[] = [];

    // Reglas de validacion del framework (deterministas, sin LLM)

    // 1. Debe importar k6 http o RequestHelper
    if (!code.includes("from 'k6/http'") && !code.includes("RequestHelper")) {
      errors.push({
        code: "CHK-API-363-a",
        message: "El script debe importar 'k6/http' o 'RequestHelper' del framework.",
      });
    }

    // 2. Debe tener export default function
    if (!code.match(/export\s+default\s+function/)) {
      errors.push({
        code: "CHK-API-362-a",
        message: "El script debe exportar una funcion default: 'export default function()'",
      });
    }

    // 3. No debe contener secretos hardcodeados (CHK-SEC-112)
    const SECRET_PATTERNS = [
      { pattern: /password\s*=\s*['"][^'"]{4,}['"]/i, label: "password hardcodeado" },
      { pattern: /Bearer\s+[A-Za-z0-9._-]{20,}/i, label: "token hardcodeado" },
      { pattern: /api.?key\s*[:=]\s*['"][^'"]{10,}['"]/i, label: "API key hardcodeada" },
      { pattern: /secret\s*[:=]\s*['"][^'"]{6,}['"]/i, label: "secret hardcodeado" },
    ];
    for (const { pattern, label } of SECRET_PATTERNS) {
      if (pattern.test(code)) {
        errors.push({
          code: "CHK-SEC-112",
          message: `Posible ${label} detectado. Usa __ENV.VARIABLE_NAME en su lugar.`,
        });
      }
    }

    // 4. Debe tener export const options
    if (!code.match(/export\s+const\s+options\s*=/)) {
      warnings.push("Sin 'export const options'. Se recomienda definir VUs, duracion y thresholds.");
    }

    // 5. Verificar que usa StructuredLogger si usa console.log (CHK-API-363-b)
    if (code.includes("console.log") && !code.includes("StructuredLogger")) {
      warnings.push("Se usa console.log. Considera usar StructuredLogger del framework para logging estructurado.");
    }

    // 6. Verificar imports de k6 validos (no imports de Node.js)
    const NODE_IMPORTS = ["require(", "import.*from 'fs'", "import.*from 'path'"];
    for (const nodeImport of NODE_IMPORTS) {
      if (new RegExp(nodeImport).test(code)) {
        errors.push({
          code: "CHK-API-362-b",
          message: `Import de Node.js detectado: '${nodeImport}'. Los scripts k6 no pueden usar modulos de Node.js.`,
        });
      }
    }

    // 7. Validacion TypeScript via tsc si disponible
    const tscResult = await runTscCheck(code, filename);
    if (tscResult.errors.length > 0) {
      errors.push(...tscResult.errors);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  } catch (err) {
    throw formatError(err);
  }
}

/** Ejecutar tsc --noEmit sobre el codigo generado */
async function runTscCheck(
  code: string,
  filename: string
): Promise<{ errors: Array<{ code: string; message: string; line?: number }> }> {
  const os = await import("os");
  const fsModule = await import("fs");
  const pathModule = await import("path");

  const tmpDir = fsModule.mkdtempSync(pathModule.join(os.tmpdir(), "k6-validate-"));
  const tmpFile = pathModule.join(tmpDir, filename);

  try {
    fsModule.writeFileSync(tmpFile, code, "utf-8");
    execSync(`npx tsc --noEmit --strict --target ES2020 --moduleResolution node "${tmpFile}"`, {
      cwd: FRAMEWORK_ROOT,
      stdio: "pipe",
      timeout: 15000,
    });
    return { errors: [] };
  } catch (err: any) {
    const output = String(err.stdout ?? err.stderr ?? "");
    const errors = output
      .split("\n")
      .filter((l) => l.includes("error TS"))
      .slice(0, 10)
      .map((line) => {
        const match = line.match(/\((\d+),\d+\).*error (TS\d+): (.+)/);
        return {
          code: match?.[2] ?? "TSError",
          message: match?.[3] ?? line.trim(),
          line: match?.[1] ? parseInt(match[1], 10) : undefined,
        };
      });
    return { errors };
  } finally {
    try {
      fsModule.rmSync(tmpDir, { recursive: true });
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// get_test_history — CHK-API-350
// ---------------------------------------------------------------------------

export interface GetTestHistoryParams {
  client: string;
  test?: string;
  limit?: number;
}

export interface TestHistoryEntry {
  runId: string;
  client: string;
  test: string;
  timestamp: string;
  status: "pass" | "fail";
  metrics: {
    p95Ms?: number;
    errorRatePct?: number;
    rps?: number;
    vus?: number;
    durationS?: number;
  };
}

export interface GetTestHistoryResult {
  client: string;
  test?: string;
  total: number;
  entries: TestHistoryEntry[];
}

export function getTestHistory(params: GetTestHistoryParams): GetTestHistoryResult {
  try {
    const { client, test, limit = 20 } = params;

    // Validar y sanitizar (CHK-SEC-110)
    validateNoInjection(client, "client");
    if (test) validateNoInjection(test, "test");

    const reportsBase = join(FRAMEWORK_ROOT, "reports", sanitizeArg(client));

    if (!existsSync(reportsBase)) {
      return { client, test, total: 0, entries: [] };
    }

    const entries: TestHistoryEntry[] = [];

    // Recorrer estructura: reports/{client}/{test}/{timestamp}/
    const testDirs = test
      ? [join(reportsBase, sanitizeArg(test))]
      : readdirSync(reportsBase).map((d) => join(reportsBase, d));

    for (const testDir of testDirs) {
      if (!existsSync(testDir)) continue;
      const testName = testDir.split("/").pop() ?? "";

      const runDirs = readdirSync(testDir)
        .filter((d) => /^\d{8}[-_]\d{6}/.test(d))
        .sort()
        .reverse()
        .slice(0, limit);

      for (const runDir of runDirs) {
        const summaryPath = join(testDir, runDir, "summary.json");
        if (!existsSync(summaryPath)) continue;

        try {
          const summary = JSON.parse(readFileSync(summaryPath, "utf-8"));
          entries.push({
            runId: `${client}/${testName}/${runDir}`,
            client,
            test: testName,
            timestamp: summary.timestamp ?? runDir,
            status: summary.status ?? (summary.thresholds_passed ? "pass" : "fail"),
            metrics: {
              p95Ms: summary.metrics?.http_req_duration?.p95,
              errorRatePct: summary.metrics?.http_req_failed?.rate
                ? summary.metrics.http_req_failed.rate * 100
                : undefined,
              rps: summary.metrics?.http_reqs?.rate,
              vus: summary.metrics?.vus_max?.value,
              durationS: summary.state?.testRunDurationMs
                ? summary.state.testRunDurationMs / 1000
                : undefined,
            },
          });
        } catch {
          // Skip malformed summaries
        }
      }
    }

    // Ordenar por timestamp descendente y limitar
    entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    return {
      client,
      test,
      total: entries.length,
      entries: entries.slice(0, limit),
    };
  } catch (err) {
    throw formatError(err);
  }
}

// ---------------------------------------------------------------------------
// create_jira_ticket — CHK-API-372, CHK-SEC-117
// ---------------------------------------------------------------------------

export interface CreateJiraTicketParams {
  project: string;
  summary: string;
  description: string;
  priority?: "Highest" | "High" | "Medium" | "Low" | "Lowest";
  labels?: string[];
  /** Credenciales: si no se pasan, se leen de env vars (CHK-SEC-117) */
  jiraUrl?: string;
  jiraUser?: string;
  jiraToken?: string;
}

export interface CreateJiraTicketResult {
  success: boolean;
  ticketKey?: string;
  ticketUrl?: string;
  /** Si Jira no esta accesible, el hallazgo se persiste localmente (EC-AI-009) */
  persistedLocallyAt?: string;
  error?: string;
}

export async function createJiraTicket(
  params: CreateJiraTicketParams
): Promise<CreateJiraTicketResult> {
  try {
    const { project, summary, description, priority = "High", labels = ["performance"] } = params;

    // Sanitizacion de inputs (CHK-SEC-110)
    validateNoInjection(project, "project");

    // Credenciales SOLO desde env vars (CHK-SEC-117) — nunca desde params
    // Si se pasan en params, los ignoramos y usamos env vars
    const jiraUrl = process.env.JIRA_URL;
    const jiraUser = process.env.JIRA_USER;
    const jiraToken = process.env.JIRA_API_TOKEN;

    if (!jiraUrl || !jiraUser || !jiraToken) {
      // EC-AI-009: persistir localmente si credenciales no configuradas
      const localPath = await persistFindingLocally({ project, summary, description, priority, labels });
      return {
        success: false,
        persistedLocallyAt: localPath,
        error: "Credenciales de Jira no configuradas (JIRA_URL, JIRA_USER, JIRA_API_TOKEN). Hallazgo persistido localmente.",
      };
    }

    const payload = {
      fields: {
        project: { key: project },
        summary: summary.slice(0, 255),
        description: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: description.slice(0, 32767) }],
            },
          ],
        },
        issuetype: { name: "Bug" },
        priority: { name: priority },
        labels: ["performance-test", ...labels],
      },
    };

    let response: Response;
    try {
      response = await fetchWithTimeout(`${jiraUrl}/rest/api/3/issue`, 15000);
      // Actually POST
      response = await fetch(`${jiraUrl}/rest/api/3/issue`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(`${jiraUser}:${jiraToken}`).toString("base64")}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
    } catch (fetchErr) {
      // EC-AI-009: Jira no accesible — persistir localmente
      const localPath = await persistFindingLocally({ project, summary, description, priority, labels });
      return {
        success: false,
        persistedLocallyAt: localPath,
        error: `Jira no accesible: ${fetchErr}. Hallazgo persistido en ${localPath}`,
      };
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const localPath = await persistFindingLocally({ project, summary, description, priority, labels });
      return {
        success: false,
        persistedLocallyAt: localPath,
        error: `Jira retorno ${response.status}: ${body.slice(0, 200)}`,
      };
    }

    const data = (await response.json()) as { key: string; self: string };
    return {
      success: true,
      ticketKey: data.key,
      ticketUrl: `${jiraUrl}/browse/${data.key}`,
    };
  } catch (err) {
    throw formatError(err);
  }
}

/** Persistir hallazgo localmente como JSON cuando Jira no esta disponible (EC-AI-009) */
async function persistFindingLocally(finding: object): Promise<string> {
  const fsModule = await import("fs");
  const pathModule = await import("path");

  const dir = pathModule.join(FRAMEWORK_ROOT, "reports", "_jira-pending");
  if (!fsModule.existsSync(dir)) fsModule.mkdirSync(dir, { recursive: true });

  const filename = `finding-${Date.now()}.json`;
  const filePath = pathModule.join(dir, filename);
  fsModule.writeFileSync(filePath, JSON.stringify({ ...finding, persistedAt: new Date().toISOString() }, null, 2));
  return filePath;
}
