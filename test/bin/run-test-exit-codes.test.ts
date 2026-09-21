/**
 * El gate del gate: verifica que bin/run-test.sh propague el codigo de salida.
 *
 * Existe por un bug real: el runner devolvia exit 2 en TODA corrida, exitosa o no.
 * Cuatro bloques con la forma `VAR=$(cmd)` seguida de `_exit=$?` morian bajo
 * `set -e` antes de leer el codigo, y el script nunca llegaba a su `exit
 * "${FINAL_EXIT}"` final. El efecto era tapar por igual el PASS (0) y el fallo de
 * SLOs (99), asi que el quality gate no podia pasar ni fallar por el motivo
 * correcto — durante meses nadie lo noto.
 *
 * No se puede probar con un perfil de thresholds imposibles: VALID_PROFILES es una
 * lista hardcodeada en el runner (run-test.sh:608). En su lugar se stubea el binario
 * de k6 via K6_BINARY_PATH, que es un mecanismo que el runner ya soporta, y se
 * comprueba que cada codigo que emite k6 llegue intacto al caller.
 *
 * Alcance, medido por mutacion: reintroduciendo el patron roto en el bloque de
 * unexpected_status (el que causo el bug) los tres casos fallan, y con el arreglo
 * pasan. Los otros tres sitios del mismo patron NO quedan cubiertos, porque sus
 * bloques necesitan condiciones que este stub no produce: el de auditoria XSS pide
 * un reporte HTML, el de build pide que falle webpack y el editorial pide
 * EDITORIAL_REPORT=1. Si alguien toca esos, el test no lo va a ver.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const ROOT = path.resolve(__dirname, "../..");
const RUN_TEST = path.join(ROOT, "bin/run-test.sh");
const SCENARIO = "api/exit-codes";

let clientDir: string;
let clientName: string;
let stubDir: string;
let reportsDir: string;

/**
 * Stub de k6: escribe los dos artefactos que el runner espera y termina con el
 * codigo pedido.
 *
 * Escribirlos importa. Todo el post-procesamiento del runner (comparacion,
 * generacion de artefactos, extraccion de errores, auditoria XSS) esta detras de
 * `if [[ -f "${K6_LOG}" ]]` o `-f "${SUMMARY_JSON}"`. Un stub que solo hace
 * `exit N` los saltea — y ahi viven justamente los bloques que rompian el codigo
 * de salida. Las rutas llegan en el argv: `--summary-export <path>` y
 * `--log-output file=<path>` (run-test.sh:1167 y 1169).
 */
function writeStubK6(exitCode: number): string {
  const stub = path.join(stubDir, "k6");
  const src = [
    "#!/usr/bin/env node",
    '"use strict";',
    'const fs = require("fs");',
    'const path = require("path");',
    "const argv = process.argv.slice(2);",
    'let summary = "", logFile = "";',
    "for (let i = 0; i < argv.length; i++) {",
    '  if (argv[i] === "--summary-export") summary = argv[i + 1] || "";',
    '  if (argv[i] === "--log-output") logFile = (argv[i + 1] || "").replace(/^file=/, "");',
    "}",
    "const write = (p, body) => {",
    "  if (!p) return;",
    "  fs.mkdirSync(path.dirname(p), { recursive: true });",
    "  fs.writeFileSync(p, body);",
    "};",
    'write(logFile, \'time="2026-01-01T00:00:00Z" level=info msg="stub run" source=console\\n\');',
    // A proposito NO se escribe el summary: la generacion de artefactos (que cuelga
    // su timeout de 120s con un summary sintetico) esta detras de `-f SUMMARY_JSON`,
    // mientras que el bloque que rompia el codigo de salida solo pide K6_LOG.
    "void summary;",
    `console.log("stub k6 (exit ${exitCode})");`,
    `process.exit(${exitCode});`,
    "",
  ].join("\n");
  fs.writeFileSync(stub, src, { mode: 0o755 });
  return stub;
}

beforeAll(() => {
  clientDir = fs.mkdtempSync(path.join(ROOT, "clients/_test-exitcodes-"));
  clientName = path.basename(clientDir);
  fs.mkdirSync(path.join(clientDir, "scenarios", "api"), { recursive: true });
  fs.writeFileSync(
    path.join(clientDir, "scenarios", "api", "exit-codes.ts"),
    "export const options = { vus: 1, iterations: 1 };\nexport default function () {}\n"
  );

  // --skip-build exige el bundle ya compilado; se escribe a mano para no pagar webpack.
  // CLIENT_DIST = CLIENT sin el guion bajo inicial (run-test.sh:648).
  const distDir = path.join(ROOT, "dist", clientName.replace(/^_/, ""), "api");
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, "exit-codes.js"), "export default function () {}\n");

  // realpathSync: en macOS /tmp es un symlink a /private/tmp, y el runner compara
  // el binario resuelto con realpath contra K6_BINARY_ALLOWED_PATHS. Sin resolver,
  // el allow-list no matchea y rebota con "not in a trusted directory".
  stubDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "k6stub-")));
  reportsDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "k6reports-")));
});

afterAll(() => {
  for (const dir of [clientDir, stubDir, reportsDir]) {
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
  const distDir = path.join(ROOT, "dist", clientName.replace(/^_/, ""));
  if (fs.existsSync(distDir)) fs.rmSync(distDir, { recursive: true, force: true });
});

function runWithStubK6(k6Exit: number) {
  const stub = writeStubK6(k6Exit);
  return spawnSync(
    "bash",
    [
      RUN_TEST,
      `--client=${clientName}`,
      `--scenario=${SCENARIO}`,
      "--profile=smoke",
      "--skip-build",
      "--skip-validate",
      `--reports-dir=${reportsDir}`,
    ],
    {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 120_000,
      env: {
        ...process.env,
        K6_BINARY_PATH: stub,
        K6_BINARY_ALLOWED_PATHS: stubDir,
        // El runner falla cerrado sin rbac.json; aca no hay usuario que autorizar.
        K6_RBAC_PERMISSIVE: "true",
      },
    }
  );
}

describe("bin/run-test.sh — propagacion del codigo de salida", () => {
  it("devuelve 0 cuando k6 pasa (regresion: devolvia 2 siempre)", () => {
    const r = runWithStubK6(0);
    expect(r.status, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`).toBe(0);
    expect(r.stdout).toContain("PASS");
  });

  it("devuelve 99 cuando k6 falla thresholds — el camino que usa el quality gate", () => {
    const r = runWithStubK6(99);
    expect(r.status, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`).toBe(99);
    expect(r.stdout).toContain("THRESHOLD FAILURE");
  });

  it("no colapsa 0 y 99 en el mismo codigo", () => {
    expect(runWithStubK6(0).status).not.toBe(runWithStubK6(99).status);
  });
});
