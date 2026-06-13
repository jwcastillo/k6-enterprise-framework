/**
 * T-121: Motor de ejecucion adaptativo — Tests auto-reparables
 *
 * Cuando un script k6 falla por cambio de schema de API:
 *   1. Detecta el tipo de error (campo renombrado, tipo cambiado, etc.)
 *   2. Invoca al BuilderAgent con el log de error como contexto
 *   3. Valida la correccion generada
 *   4. Re-ejecuta automaticamente
 *   5. Maximo 3 reintentos (EC-AI-007, CHK-SEC-116)
 *
 * FR-173 (adaptive execution)
 * SC-105: tasa de reparacion >= 70% para cambios simples de schema
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import * as readline from "readline";
import { spawn } from "child_process";

import type { GeneratedScript, GeneratedFile, ValidationResult } from "../../types/ai.d";
import { BuilderAgent } from "../agents/builder-agent.js";
import { BudgetManager } from "../core/budget-manager.js";
import type { LLMProvider } from "../core/llm-provider.js";
import { AnthropicProvider } from "../core/providers/anthropic-provider.js";
import { computeUnifiedDiff } from "./healing-diff.js";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type SchemaErrorType =
  | "field-renamed"
  | "type-changed"
  | "field-removed"
  | "field-required"
  | "status-code-changed"
  | "http-400-validation"
  | "http-422-validation"
  | "unknown";

export interface SchemaError {
  type: SchemaErrorType;
  field?: string;
  expectedType?: string;
  actualType?: string;
  statusCode?: number;
  rawMessage: string;
}

export interface HealingAttempt {
  attemptNumber: number;
  errorDetected: SchemaError;
  scriptBefore: string;
  scriptAfter: string;
  validationResult: ValidationResult;
  success: boolean;
  durationMs: number;
  tokensUsed: number;
}

export interface HealingResult {
  originalScriptPath: string;
  success: boolean;
  healedScript?: GeneratedScript;
  attempts: HealingAttempt[];
  totalDurationMs: number;
  totalTokensUsed: number;
  /** Historial de auditoria (CHK-SEC-116) */
  auditTrail: HealingAuditEntry[];
}

/**
 * Self-healing-specific audit entry. Distinct from types/audit.d.ts::AuditEntry
 * which is the framework's general audit-log row schema.
 */
export interface HealingAuditEntry {
  timestamp: string;
  action: string;
  scriptPath?: string;
  errorType?: string;
  result: "success" | "failure" | "in-progress";
}

/** @deprecated renamed to HealingAuditEntry — collided with types/audit.d.ts::AuditEntry. */
export type AuditEntry = HealingAuditEntry;

// ---------------------------------------------------------------------------
// SelfHealingEngine
// ---------------------------------------------------------------------------

export class SelfHealingEngine {
  private static readonly MAX_RETRIES = 3; // EC-AI-007

  private readonly builder: BuilderAgent;
  private readonly budget: BudgetManager;
  private readonly tmpDir: string;
  private readonly provider: LLMProvider;
  private readonly testCommand: string[];
  /**
   * Promotion mode: when "filesystem", a successful heal is copied from the
   * tmpdir sandbox to the original source path (gated by D-12). When "in-memory"
   * (default for backwards compat with the existing GeneratedScript API), no
   * filesystem promotion occurs and callers get the healed script in the result.
   */
  private readonly promote: "filesystem" | "in-memory";

  constructor(options?: {
    builderAgent?: BuilderAgent;
    budgetManager?: BudgetManager;
    /** Base tmpdir; per-heal UUID subdir is created inside. D-10. Defaults to os.tmpdir()/k6-self-healing. */
    tmpDir?: string;
    /** API key — resolves LLM_API_KEY → ANTHROPIC_API_KEY → explicit param. Used to build the default provider. */
    apiKey?: string;
    /** Optional LLMProvider DI hook. Defaults to a new AnthropicProvider using apiKey resolution. */
    provider?: LLMProvider;
    /** Command used by D-13 test-pass gate before promotion. Defaults to ["pnpm","vitest","run","--passWithNoTests"]. */
    testCommand?: string[];
    /** "filesystem" enables the D-10..D-13 sandbox→diff→gate→promote pipeline. Default "in-memory" preserves the legacy GeneratedScript-only flow. */
    promote?: "filesystem" | "in-memory";
  }) {
    this.budget = options?.budgetManager ?? new BudgetManager({ agentId: "builder" });
    this.tmpDir = options?.tmpDir ?? path.join(os.tmpdir(), "k6-self-healing");
    this.provider = options?.provider ?? new AnthropicProvider({ apiKey: options?.apiKey });
    // Propagate the resolved provider to a default BuilderAgent so engine-level
    // provider injection satisfies D-25 without re-resolving env vars / re-throwing.
    this.builder =
      options?.builderAgent ??
      new BuilderAgent({ provider: this.provider, apiKey: options?.apiKey });
    this.testCommand = options?.testCommand ?? ["pnpm", "vitest", "run", "--passWithNoTests"];
    this.promote = options?.promote ?? "in-memory";

    if (!fs.existsSync(this.tmpDir)) {
      fs.mkdirSync(this.tmpDir, { recursive: true });
    }
  }

  // -------------------------------------------------------------------------
  // Entry point: intentar auto-reparar un script que fallo
  // -------------------------------------------------------------------------

  async heal(
    script: GeneratedScript,
    executionError: string,
    serviceResponse?: string
  ): Promise<HealingResult> {
    const startMs = Date.now();
    const auditTrail: HealingAuditEntry[] = [];
    const attempts: HealingAttempt[] = [];

    const mainFile = script.files.find((f) => f.type === "script");
    if (!mainFile) {
      return {
        originalScriptPath: "",
        success: false,
        attempts: [],
        totalDurationMs: Date.now() - startMs,
        totalTokensUsed: 0,
        auditTrail: [
          {
            timestamp: new Date().toISOString(),
            action: "heal-start",
            result: "failure",
            errorType: "no-script-file",
          },
        ],
      };
    }

    this.audit(auditTrail, "heal-start", "in-progress", mainFile.path);

    let currentCode = mainFile.content;
    let healSuccess = false;
    let healedScript: GeneratedScript | undefined;

    for (let attempt = 1; attempt <= SelfHealingEngine.MAX_RETRIES; attempt++) {
      const attemptStart = Date.now();
      this.audit(auditTrail, `attempt-${attempt}`, "in-progress");

      // 1. Detectar tipo de error
      const schemaError = this.detectSchemaError(executionError, serviceResponse);

      // 2. Si no es un error de schema, no podemos auto-reparar
      if (schemaError.type === "unknown" && attempt === 1) {
        this.audit(auditTrail, "heal-abort", "failure", undefined, schemaError.type);
        break;
      }

      try {
        // 3. Invocar al Builder con contexto del error
        const healedCode = await this.requestHeal(currentCode, schemaError, serviceResponse ?? "");
        const tokens = 0; // El builder maneja sus propios tokens internamente

        // 4. Validar la correccion
        const validation = this.validateHealedCode(healedCode);

        const attemptResult: HealingAttempt = {
          attemptNumber: attempt,
          errorDetected: schemaError,
          scriptBefore: currentCode,
          scriptAfter: healedCode,
          validationResult: validation,
          success: validation.passed,
          durationMs: Date.now() - attemptStart,
          tokensUsed: tokens,
        };
        attempts.push(attemptResult);

        if (validation.passed) {
          // 5. Sandbox + diff + gate + test-pass + promote (D-10..D-13)
          if (this.promote === "filesystem") {
            const runDir = path.join(this.tmpDir, crypto.randomUUID());
            await fs.promises.mkdir(runDir, { recursive: true });
            const basename = path.basename(mainFile.path);
            // Sanitize basename — reject path traversal (D-15)
            if (basename !== mainFile.path && (basename.includes("..") || basename.includes("/"))) {
              this.audit(auditTrail, "heal-rejected-path-traversal", "failure", mainFile.path);
              break;
            }
            const tmpPath = path.join(runDir, `${basename}.fixed.ts`);
            await fs.promises.writeFile(tmpPath, healedCode, "utf8");

            // D-11: emit unified diff (always, before gate)
            const diff = computeUnifiedDiff(currentCode, healedCode, mainFile.path, tmpPath);
            if (diff) console.warn(diff);

            // D-12: gate
            const gate = await this.checkApplyGate(tmpPath);
            if (gate === "skip") {
              this.audit(auditTrail, "heal-gate-skipped", "failure", mainFile.path);
              break;
            }

            // D-13: test-pass before promote
            const testsPassed = await this.runAffectedTest(tmpPath);
            if (!testsPassed) {
              this.audit(auditTrail, "heal-tests-failed", "failure", mainFile.path);
              break;
            }

            try {
              await fs.promises.copyFile(tmpPath, mainFile.path);
              this.audit(auditTrail, "heal-promoted", "success", mainFile.path);
            } catch (err) {
              this.audit(auditTrail, "heal-promote-error", "failure", mainFile.path, String(err));
              break;
            }
          }

          currentCode = healedCode;
          healSuccess = true;
          healedScript = this.buildHealedScript(script, healedCode, attempt);
          this.audit(auditTrail, `attempt-${attempt}`, "success", mainFile.path, schemaError.type);
          break;
        }

        // Continuar con el siguiente intento usando el codigo corregido
        currentCode = healedCode;
        this.audit(auditTrail, `attempt-${attempt}`, "failure", mainFile.path, schemaError.type);
      } catch (err) {
        attempts.push({
          attemptNumber: attempt,
          errorDetected: schemaError,
          scriptBefore: currentCode,
          scriptAfter: "",
          validationResult: {
            passed: false,
            errors: [{ code: "HEAL-ERR", message: String(err) }],
            warnings: [],
          },
          success: false,
          durationMs: Date.now() - attemptStart,
          tokensUsed: 0,
        });
        this.audit(auditTrail, `attempt-${attempt}`, "failure", mainFile.path, "exception");
      }
    }

    if (!healSuccess) {
      // EC-AI-007: max reintentos alcanzado
      this.audit(auditTrail, "heal-max-retries", "failure");
    } else {
      this.audit(auditTrail, "heal-success", "success", mainFile.path);
    }

    const totalTokens = attempts.reduce((s, a) => s + a.tokensUsed, 0);

    return {
      originalScriptPath: mainFile.path,
      success: healSuccess,
      healedScript,
      attempts,
      totalDurationMs: Date.now() - startMs,
      totalTokensUsed: totalTokens,
      auditTrail,
    };
  }

  // -------------------------------------------------------------------------
  // Deteccion del tipo de error de schema (CHK-API-121)
  // -------------------------------------------------------------------------

  detectSchemaError(errorLog: string, serviceResponse?: string): SchemaError {
    const log = errorLog.toLowerCase();
    const response = (serviceResponse ?? "").toLowerCase();

    // HTTP 400 Bad Request con body de validacion
    if (log.includes("status 400") || log.includes("http 400")) {
      return {
        type: "http-400-validation",
        statusCode: 400,
        rawMessage: errorLog,
      };
    }

    // HTTP 422 Unprocessable Entity (validacion de schema)
    if (log.includes("status 422") || log.includes("http 422")) {
      return {
        type: "http-422-validation",
        statusCode: 422,
        rawMessage: errorLog,
      };
    }

    // Campo renombrado (puede aparecer como "unknown field" o "unexpected key")
    if (
      log.includes("unknown field") ||
      log.includes("unexpected key") ||
      log.includes("unrecognized field") ||
      response.includes("unknown_field")
    ) {
      const fieldMatch = errorLog.match(/field[:\s]+'?(\w+)'?/i);
      return {
        type: "field-renamed",
        field: fieldMatch?.[1],
        rawMessage: errorLog,
      };
    }

    // Campo requerido faltante
    if (
      log.includes("required") ||
      log.includes("missing") ||
      response.includes("required_field")
    ) {
      const fieldMatch = errorLog.match(/(?:required|missing)[:\s]+'?(\w+)'?/i);
      return {
        type: "field-required",
        field: fieldMatch?.[1],
        rawMessage: errorLog,
      };
    }

    // Campo eliminado
    if (
      log.includes("field removed") ||
      log.includes("deprecated") ||
      log.includes("not found in schema")
    ) {
      return { type: "field-removed", rawMessage: errorLog };
    }

    // Tipo cambiado (error de cast/parse)
    if (
      log.includes("type error") ||
      log.includes("cannot parse") ||
      log.includes("invalid type")
    ) {
      const typeMatch = errorLog.match(/expected\s+(\w+)/i);
      return {
        type: "type-changed",
        expectedType: typeMatch?.[1],
        rawMessage: errorLog,
      };
    }

    // Status code cambiado
    const statusMatch = errorLog.match(/expected\s+status\s+(\d+)\s+got\s+(\d+)/i);
    if (statusMatch) {
      return {
        type: "status-code-changed",
        statusCode: parseInt(statusMatch[2]),
        rawMessage: errorLog,
      };
    }

    return { type: "unknown", rawMessage: errorLog };
  }

  // -------------------------------------------------------------------------
  // Solicitar reparacion al LLM
  // -------------------------------------------------------------------------

  private async requestHeal(
    originalCode: string,
    error: SchemaError,
    serviceResponse: string
  ): Promise<string> {
    const prompt = `Tienes un script k6 que esta fallando. Debes corregirlo.

ERROR DETECTADO (tipo: ${error.type}):
${error.rawMessage}

${serviceResponse ? `RESPUESTA DEL SERVICIO:\n${serviceResponse}\n` : ""}

SCRIPT ORIGINAL:
\`\`\`typescript
${originalCode}
\`\`\`

INSTRUCCIONES DE REPARACION:
${this.buildRepairInstructions(error)}

Genera el script corregido. Responde SOLO con el codigo TypeScript, sin texto adicional.
NUNCA hardcodees credenciales. Usa __ENV.VARIABLE_NAME para todos los secretos.`;

    const response = await this.provider.chat([{ role: "user", content: prompt }], {
      model: "claude-haiku-4-5-20251001",
      maxTokens: 4096,
      temperature: 0.05,
    });

    // Extract code from markdown block if wrapped
    const match = response.text.match(/```(?:typescript|ts|javascript|js)?\n?([\s\S]*?)\n?```/);
    return match ? match[1].trim() : response.text.trim();
  }

  private buildRepairInstructions(error: SchemaError): string {
    switch (error.type) {
      case "field-renamed":
        return `El campo '${error.field ?? "desconocido"}' fue renombrado en la API. Busca el nuevo nombre en la respuesta de error y actualiza todas las referencias en el script.`;
      case "field-required":
        return `El campo '${error.field ?? "desconocido"}' es ahora requerido. Agrégalo al body del request correspondiente.`;
      case "field-removed":
        return `Un campo fue eliminado de la API. Elimina las referencias al campo deprecado del script.`;
      case "type-changed":
        return `El tipo del campo cambio (esperado: ${error.expectedType ?? "desconocido"}). Ajusta el tipo del valor enviado en el request.`;
      case "status-code-changed":
        return `El status code de respuesta exitosa cambio a ${error.statusCode}. Actualiza el check correspondiente.`;
      case "http-400-validation":
      case "http-422-validation":
        return `El servidor retorno ${error.statusCode} indicando un error de validacion. Revisa los campos del request body y corrige la estructura segun el mensaje de error.`;
      default:
        return `Analiza el error y corrige el script para que pase los checks de k6.`;
    }
  }

  // -------------------------------------------------------------------------
  // Validacion del codigo reparado
  // -------------------------------------------------------------------------

  private validateHealedCode(code: string): ValidationResult {
    const errors: { code: string; message: string }[] = [];
    const warnings: string[] = [];

    if (!code || code.trim().length < 50) {
      errors.push({ code: "HEAL-001", message: "Codigo reparado esta vacio." });
      return { passed: false, errors, warnings };
    }

    if (!code.match(/export\s+default\s+function/)) {
      errors.push({ code: "HEAL-002", message: "Sin export default function." });
    }

    if (!code.includes("k6/http") && !code.includes("RequestHelper")) {
      errors.push({ code: "HEAL-003", message: "Sin import de k6/http ni RequestHelper." });
    }

    // Sin secretos hardcodeados (CHK-SEC-116)
    const secretPatterns = [
      /password\s*=\s*['"][^'"]{4,}['"]/i,
      /Bearer\s+(?!__ENV)[A-Za-z0-9._-]{20,}/i,
    ];
    for (const p of secretPatterns) {
      if (p.test(code)) {
        errors.push({
          code: "CHK-SEC-116",
          message: "Posible secreto hardcodeado en codigo reparado.",
        });
      }
    }

    // Verificar que no se introdujo codigo Node.js
    if (code.includes("require(") || code.includes("from 'fs'")) {
      errors.push({ code: "HEAL-004", message: "Import de Node.js en codigo reparado." });
    }

    return { passed: errors.length === 0, errors, warnings };
  }

  // -------------------------------------------------------------------------
  // Construir GeneratedScript reparado
  // -------------------------------------------------------------------------

  private buildHealedScript(
    original: GeneratedScript,
    healedCode: string,
    cycleCount: number
  ): GeneratedScript {
    const now = new Date().toISOString();
    const healedFiles: GeneratedFile[] = original.files.map((f) => {
      if (f.type === "script") {
        return { ...f, content: healedCode, path: f.path.replace(".ts", `-healed.ts`) };
      }
      return f;
    });

    return {
      id: crypto.randomUUID(),
      files: healedFiles,
      validationResult: {
        passed: true,
        errors: [],
        warnings: [`Auto-reparado en ${cycleCount} ciclo(s)`],
      },
      selfHealingCycles: cycleCount,
      metadata: {
        ...original.metadata,
        agentVersion: `${original.metadata.agentVersion}-healed`,
        generatedAt: now,
        confidence: Math.max(0.5, original.metadata.confidence - cycleCount * 0.1),
        sourceTestPlan: original.metadata.sourceTestPlan,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Audit trail (CHK-SEC-116)
  // -------------------------------------------------------------------------

  private audit(
    trail: HealingAuditEntry[],
    action: string,
    result: HealingAuditEntry["result"],
    scriptPath?: string,
    errorType?: string
  ): void {
    trail.push({
      timestamp: new Date().toISOString(),
      action,
      scriptPath,
      errorType,
      result,
    });
  }

  // -------------------------------------------------------------------------
  // D-12: apply gate (env → TTY → neither). Strict precedence order.
  // -------------------------------------------------------------------------

  private async checkApplyGate(tmpPath: string): Promise<"apply" | "skip"> {
    // (1) env override
    if (process.env.K6_AI_AUTO_APPLY === "true") {
      console.warn("[self-healing] auto-applying fix (K6_AI_AUTO_APPLY=true)");
      return "apply";
    }

    // (2) interactive TTY prompt, 30s timeout, default no
    if (process.stdin.isTTY === true) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answer = await new Promise<string | null>((resolve) => {
          const timer = setTimeout(() => {
            console.warn("[self-healing] prompt timed out, fix not applied");
            resolve(null);
          }, 30000);
          rl.question("Apply this fix? (y/N): ", (a) => {
            clearTimeout(timer);
            resolve(a);
          });
        });
        if (answer && /^y(es)?$/i.test(answer.trim())) return "apply";
        return "skip";
      } finally {
        rl.close();
      }
    }

    // (3) neither — log and skip (D-12 exact wording)
    console.warn(
      `[self-healing] fix proposed at ${tmpPath}, not applied (set K6_AI_AUTO_APPLY=true or run interactively to apply)`
    );
    return "skip";
  }

  // -------------------------------------------------------------------------
  // D-13: run the affected test before promotion. Returns true iff exit 0.
  // -------------------------------------------------------------------------

  private async runAffectedTest(tmpPath: string): Promise<boolean> {
    const [cmd, ...args] = this.testCommand;
    return new Promise<boolean>((resolve) => {
      const child = spawn(cmd, args, {
        cwd: process.cwd(),
        env: { ...process.env, K6_AI_HEAL_TARGET: tmpPath },
        stdio: "inherit",
      });
      child.on("exit", (code) => resolve(code === 0));
      child.on("error", () => resolve(false));
    });
  }
}
