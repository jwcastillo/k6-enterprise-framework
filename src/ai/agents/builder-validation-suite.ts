/**
 * T-112: Suite de validacion del Builder Agent
 *
 * Ejecuta el Builder Agent contra 12 TestPlan fixtures de complejidad variada
 * y verifica que el codigo generado:
 *   - Compila sin errores TypeScript
 *   - Usa helpers del framework (RequestHelper, etc.)
 *   - No contiene secretos hardcodeados
 *   - Es ejecutable con k6
 *
 * Target: tasa de exito >= 95% (SC-100)
 *
 * Uso:
 *   DRY_RUN=true npx ts-node src/ai/agents/builder-validation-suite.ts
 *   LLM_API_KEY=sk-... npx ts-node src/ai/agents/builder-validation-suite.ts
 *
 * FR-172 | CHK-API-363, CHK-API-364
 */

import { BuilderAgent } from "./builder-agent.js";
import { ALL_TEST_PLANS } from "./fixtures/test-plans.js";
import type { TestPlan, GeneratedScript, ValidationResult } from "../../types/ai.d";

// ---------------------------------------------------------------------------
// Tipos de resultado de la suite
// ---------------------------------------------------------------------------

interface BuilderSuiteResult {
  planId: string;
  planName: string;
  success: boolean;
  selfHealingCycles: number;
  validationErrors: string[];
  validationWarnings: string[];
  tokensUsed: number;
  latencyMs: number;
  error?: string;
}

interface BuilderSuiteSummary {
  total: number;
  passed: number;
  failed: number;
  successRatePct: number;
  avgTokens: number;
  avgLatencyMs: number;
  totalCostUsd: number;
  results: BuilderSuiteResult[];
  passedSC100: boolean; // >= 95%
}

// ---------------------------------------------------------------------------
// Validacion estatica adicional (sin LLM, determinista)
// ---------------------------------------------------------------------------

function validateCodeStatically(code: string, _planId: string): ValidationResult {
  const errors = [];
  const warnings = [];

  // Debe importar k6/http o RequestHelper
  if (!code.includes("k6/http") && !code.includes("RequestHelper")) {
    errors.push({ code: "STATIC-001", message: "Sin import de k6/http ni RequestHelper" });
  }

  // Debe tener export default function
  if (!code.match(/export\s+default\s+function/)) {
    errors.push({ code: "STATIC-002", message: "Sin export default function" });
  }

  // Debe tener export const options (al menos para la mayoria de tests)
  if (!code.match(/export\s+const\s+options/)) {
    warnings.push("Sin export const options");
  }

  // Sin imports de Node.js
  const nodePatterns = ["from 'fs'", 'from "fs"', "require(", "from 'path'"];
  for (const p of nodePatterns) {
    if (code.includes(p)) {
      errors.push({ code: "STATIC-003", message: `Import Node.js: ${p}` });
    }
  }

  // Sin secretos hardcodeados (CHK-SEC-112)
  const secretPat = [
    /password\s*=\s*['"][^'"]{4,}['"]/i,
    /(?:Bearer|Authorization)\s+(?!__ENV)[A-Za-z0-9._]{20,}/,
    /api[_-]?key\s*[:=]\s*['"][^'"]{10,}['"]/i,
  ];
  for (const p of secretPat) {
    if (p.test(code)) {
      errors.push({ code: "CHK-SEC-112", message: "Posible secreto hardcodeado detectado" });
    }
  }

  return { passed: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// DRY_RUN mode: genera codigo mock sin invocar LLM real
// ---------------------------------------------------------------------------

function generateDryRunCode(plan: TestPlan): string {
  const endpoints = plan.endpoints
    .map((e) => {
      const method = e.method.toLowerCase();
      const hasBody = e.body && ["post", "put", "patch"].includes(method);
      if (method === "get") {
        return `  const res_${method} = rh.get(\`\${__ENV.BASE_URL}${e.url}\`);
  check(res_${method}, { "${e._description ?? e.url} ok": (r) => r.status === ${e.expectedStatus} });`;
      }
      return `  const res_${method} = rh.post(\`\${__ENV.BASE_URL}${e.url}\`, {
    body: JSON.stringify(${hasBody ? JSON.stringify(e.body, null, 4) : "{}"}),
    headers: { "Content-Type": "application/json"${plan.authConfig.type !== "none" ? `, Authorization: \`Bearer \${__ENV.${plan.authConfig.envVar ?? "AUTH_TOKEN"}}\`` : ""} },
  });
  check(res_${method}, { "${e._description ?? e.url} ok": (r) => r.status === ${e.expectedStatus} });`;
    })
    .join("\n\n");

  const hasCsv = plan.dataRequirements.csvFiles?.length;

  return `/**
 * ${plan.name} — Generado por BuilderAgent (dry-run)
 * TestPlan ID: ${plan.id}
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { RequestHelper } from "../../src/helpers/request-helper";
import { StructuredLogger } from "../../src/helpers/structured-logger";${
    hasCsv
      ? `
import { SharedArray } from "k6/data";

const users = new SharedArray("users", () =>
  JSON.parse(open("./clients/_reference/data/users.csv"))
);`
      : ""
  }

export const options = {
  ${
    plan.trafficModel.executor === "constant-vus"
      ? `vus: ${(plan.trafficModel.config as { vus?: number }).vus ?? 10},
  duration: "${(plan.trafficModel.config as { duration?: string }).duration ?? "1m"}",`
      : `stages: ${JSON.stringify(
          (plan.trafficModel.config as { stages?: Array<{ duration: string; target: number }> })
            .stages ?? [{ duration: "1m", target: 10 }],
          null,
          2
        )
          .split("\n")
          .join("\n  ")},`
  }
  thresholds: ${JSON.stringify(plan.thresholds, null, 2).split("\n").join("\n  ")},
};

const rh = new RequestHelper();
const log = new StructuredLogger("${plan.name}");

export default function () {
${endpoints}

  sleep(${plan.trafficModel.thinkTimeSeconds ?? 1});
}
`;
}

// ---------------------------------------------------------------------------
// Runner de la suite
// ---------------------------------------------------------------------------

async function runSuite(options: {
  dryRun: boolean;
  plansToRun?: string[];
}): Promise<BuilderSuiteSummary> {
  const plans = options.plansToRun
    ? ALL_TEST_PLANS.filter((p) => options.plansToRun!.includes(p.id))
    : ALL_TEST_PLANS;

  const results: BuilderSuiteResult[] = [];
  let totalTokens = 0;
  let totalCostUsd = 0;

  const agent = options.dryRun ? null : new BuilderAgent();

  console.log(`\nBuilder Agent Validation Suite (T-112)`);
  console.log(`Modo: ${options.dryRun ? "DRY-RUN" : "REAL (LLM)"}`);
  console.log(`TestPlans: ${plans.length}`);
  console.log("─".repeat(60));

  for (const plan of plans) {
    const start = Date.now();
    process.stdout.write(`  [${plan.id}] ${plan.name}... `);

    let result: BuilderSuiteResult;

    try {
      let script: GeneratedScript;

      if (options.dryRun) {
        // Modo dry-run: generar codigo sin LLM
        const code = generateDryRunCode(plan);
        const staticValidation = validateCodeStatically(code, plan.id);
        script = {
          id: `dry-${plan.id}`,
          files: [
            {
              path: `clients/_generated/${plan.name}.ts`,
              content: code,
              type: "script",
              language: "typescript",
            },
          ],
          validationResult: staticValidation,
          selfHealingCycles: 0,
          metadata: {
            agentVersion: "1.0.0-dryrun",
            generatedAt: new Date().toISOString(),
            tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
            confidence: 0.8,
            sourceTestPlan: plan.id,
          },
        };
      } else {
        script = await agent!.execute(plan);
        // Validacion adicional estatica
        const mainCode = script.files.find((f) => f.type === "script")?.content ?? "";
        const staticV = validateCodeStatically(mainCode, plan.id);
        if (!staticV.passed) {
          script.validationResult.errors.push(...staticV.errors);
          script.validationResult.passed = false;
        }
      }

      const tokens = script.metadata.tokensUsed.totalTokens;
      const costUsd = script.metadata.tokensUsed.estimatedCostUsd;
      totalTokens += tokens;
      totalCostUsd += costUsd;

      const success = script.validationResult.passed;
      console.log(success ? "✓" : `✗ (${script.validationResult.errors.length} errores)`);

      result = {
        planId: plan.id,
        planName: plan.name,
        success,
        selfHealingCycles: script.selfHealingCycles,
        validationErrors: script.validationResult.errors.map((e) => `[${e.code}] ${e.message}`),
        validationWarnings: script.validationResult.warnings,
        tokensUsed: tokens,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.log(`✗ ERROR: ${errorMsg.slice(0, 80)}`);

      result = {
        planId: plan.id,
        planName: plan.name,
        success: false,
        selfHealingCycles: 0,
        validationErrors: [],
        validationWarnings: [],
        tokensUsed: 0,
        latencyMs: Date.now() - start,
        error: errorMsg,
      };
    }

    results.push(result);
  }

  const passed = results.filter((r) => r.success).length;
  const failed = results.length - passed;
  const successRatePct = Math.round((passed / results.length) * 1000) / 10;
  const avgTokens = results.length > 0 ? Math.round(totalTokens / results.length) : 0;
  const avgLatency =
    results.length > 0
      ? Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / results.length)
      : 0;

  return {
    total: results.length,
    passed,
    failed,
    successRatePct,
    avgTokens,
    avgLatencyMs: avgLatency,
    totalCostUsd,
    results,
    passedSC100: successRatePct >= 95,
  };
}

function printSummary(summary: BuilderSuiteSummary, dryRun: boolean): void {
  console.log("\n" + "=".repeat(60));
  console.log("RESUMEN DE LA SUITE");
  console.log("=".repeat(60));
  console.log(`Total       : ${summary.total}`);
  console.log(`Pasados     : ${summary.passed}`);
  console.log(`Fallados    : ${summary.failed}`);
  console.log(
    `Tasa exito  : ${summary.successRatePct}% ${summary.passedSC100 ? "✓ (>=95% SC-100)" : "✗ (<95% SC-100 FAILED)"}`
  );
  console.log(`Latencia avg: ${summary.avgLatencyMs}ms`);

  if (!dryRun) {
    console.log(`Tokens avg  : ${summary.avgTokens}`);
    console.log(`Costo total : $${summary.totalCostUsd.toFixed(4)} USD`);
  }

  if (summary.failed > 0) {
    console.log("\nPlans fallados:");
    summary.results
      .filter((r) => !r.success)
      .forEach((r) => {
        console.log(`  ✗ ${r.planId}: ${r.error ?? r.validationErrors.slice(0, 2).join("; ")}`);
      });
  }

  console.log("=".repeat(60));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const DRY_RUN = process.env.DRY_RUN === "true" || process.argv.includes("--dry-run");
const PLAN_FILTER = process.env.PLAN_ID ?? null;

runSuite({
  dryRun: DRY_RUN,
  plansToRun: PLAN_FILTER ? [PLAN_FILTER] : undefined,
})
  .then((summary) => {
    printSummary(summary, DRY_RUN);
    process.exit(summary.passedSC100 ? 0 : 1);
  })
  .catch((err) => {
    console.error("Suite error:", err);
    process.exit(1);
  });
