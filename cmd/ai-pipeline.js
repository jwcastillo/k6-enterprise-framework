#!/usr/bin/env node
/**
 * CLI del Pipeline Agentico de IA (T-120)
 *
 * Uso:
 *   node cmd/ai-pipeline.js --spec="API de checkout" --format=natural-language --client=acme
 *   node cmd/ai-pipeline.js --spec=./openapi.json --format=openapi --client=acme
 *   node cmd/ai-pipeline.js --start-from=analyst --input=./summary.json
 *   node cmd/ai-pipeline.js --dry-run --spec="test" --format=text
 *
 * Variables de entorno requeridas:
 *   ANTHROPIC_API_KEY   — API key de Claude
 *
 * Opcionales:
 *   NOTIFY_SLACK_WEBHOOK, NOTIFY_TEAMS_WEBHOOK, JIRA_URL, JIRA_USER, JIRA_API_TOKEN
 *   CHROMA_HOST, CHROMA_PORT
 *
 * FR-178 | CHK-API-373, CHK-UX-171
 */

"use strict";

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Parse args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function getArg(name) {
  const flag = args.find((a) => a.startsWith(`--${name}=`));
  return flag ? flag.split("=").slice(1).join("=") : null;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

const SPEC = getArg("spec");
const FORMAT = getArg("format") ?? "text";
const CLIENT = getArg("client") ?? "default";
const BASE_URL = getArg("base-url");
const START_FROM = getArg("start-from") ?? "planner";
const END_AT = getArg("end-at") ?? "reporter";
const INPUT_FILE = getArg("input");
const DRY_RUN = hasFlag("dry-run");
const PLAN_NAME = getArg("plan-name");

if (!SPEC && !INPUT_FILE) {
  console.error(`
k6 Enterprise Framework — Pipeline Agentico de IA

Uso:
  node cmd/ai-pipeline.js --spec=<spec> [opciones]
  node cmd/ai-pipeline.js --start-from=<paso> --input=<archivo.json>

Opciones:
  --spec=<texto|path>      Especificacion de entrada (texto, path a OpenAPI JSON)
  --format=<formato>       Formato: natural-language | text | openapi (default: text)
  --client=<id>            ID del cliente (default: default)
  --base-url=<url>         URL base del servicio a testear
  --plan-name=<nombre>     Nombre del TestPlan generado
  --start-from=<paso>      Iniciar desde: planner | builder | run-test | analyst | reporter
  --end-at=<paso>          Terminar en: planner | builder | run-test | analyst | reporter
  --input=<archivo.json>   Artefacto de entrada para --start-from
  --dry-run                Sin LLM ni ejecucion real (validacion de flujo)

Ejemplos:
  node cmd/ai-pipeline.js --dry-run --spec="API de health check" --format=natural-language
  node cmd/ai-pipeline.js --spec=./openapi.json --format=openapi --client=acme
  node cmd/ai-pipeline.js --start-from=analyst --input=./reports/summary.json
  node cmd/ai-pipeline.js --start-from=planner --end-at=builder --spec="CRUD users"
`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\nk6 Enterprise Framework — Pipeline Agentico de IA");
  console.log(`Modo: ${DRY_RUN ? "DRY-RUN" : "REAL"} | Pasos: ${START_FROM} → ${END_AT}`);
  if (CLIENT) console.log(`Cliente: ${CLIENT}`);
  console.log("");

  // Importar modulos compilados del framework
  let PipelineOrchestrator;
  try {
    ({ PipelineOrchestrator } = require("../dist/ai/pipeline/orchestrator"));
  } catch (err) {
    console.error("Error: modulos de IA no compilados.");
    console.error("Ejecuta: npm run build primero.");
    console.error(`Detalle: ${err.message}`);
    process.exit(1);
  }

  // Preparar input del pipeline
  const pipelineInput = {};

  if (START_FROM === "planner" && SPEC) {
    let specContent = SPEC;

    // Si el spec es un path a un archivo, leerlo
    if (fs.existsSync(SPEC)) {
      specContent = fs.readFileSync(SPEC, "utf-8");
    }

    pipelineInput.plannerInput = {
      format: FORMAT,
      spec: specContent,
      baseUrl: BASE_URL,
      clientId: CLIENT,
      planName: PLAN_NAME,
    };
  }

  // Cargar artefacto de entrada si se especifico --input
  if (INPUT_FILE) {
    if (!fs.existsSync(INPUT_FILE)) {
      console.error(`Archivo de entrada no encontrado: ${INPUT_FILE}`);
      process.exit(1);
    }
    const inputData = JSON.parse(fs.readFileSync(INPUT_FILE, "utf-8"));

    switch (START_FROM) {
      case "builder": pipelineInput.testPlan = inputData; break;
      case "run-test": pipelineInput.generatedScript = inputData; break;
      case "analyst": pipelineInput.k6Results = inputData; break;
      case "reporter": pipelineInput.analysisReport = inputData; break;
    }
  }

  // Crear y ejecutar el orquestador
  const orchestrator = new PipelineOrchestrator({
    startFrom: START_FROM,
    endAt: END_AT,
    dryRun: DRY_RUN,
    onProgress: (step, status, detail) => {
      if (status === "failed" && detail) {
        console.error(`  [ERROR] ${step}: ${detail}`);
      }
    },
  });

  try {
    const result = await orchestrator.run(pipelineInput);

    console.log("\n" + "─".repeat(60));
    console.log("RESULTADO DEL PIPELINE");
    console.log("─".repeat(60));
    console.log(`Run ID    : ${result.runId}`);
    console.log(`Estado    : ${result.status.toUpperCase()}`);
    console.log(`Pasos     : ${result.stepsCompleted.join(" → ")}`);
    console.log(`Duracion  : ${result.totalDurationMs}ms`);
    if (!DRY_RUN) {
      console.log(`Costo     : $${result.totalCostUsd.toFixed(4)} USD`);
    }

    if (result.artifacts.analysisReport) {
      const report = result.artifacts.analysisReport;
      console.log(`\nVeredicto : ${report.verdict.toUpperCase()}`);
      console.log(`Anomalias : ${report.anomalies.length}`);
      console.log(`Regresiones: ${report.regressions.length}`);
      if (report.executiveSummary) {
        console.log(`\nResumen   : ${report.executiveSummary.slice(0, 200)}`);
      }
    }

    console.log("─".repeat(60));
    process.exit(result.status === "failed" ? 1 : 0);
  } catch (err) {
    console.error(`\nPipeline fallido: ${err.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error fatal:", err.message);
  process.exit(1);
});
