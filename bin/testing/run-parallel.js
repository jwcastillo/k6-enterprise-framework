#!/usr/bin/env node
/**
 * T-056: Parallel test runner
 *
 * Runs k6 tests in parallel with configurable concurrency.
 * Each test is launched as an isolated subprocess via run-test.sh.
 *
 * Usage:
 *   node bin/testing/run-parallel.js --client myapp --tests "scenarios/**\/*.ts" --concurrency 4
 *   node bin/testing/run-parallel.js --client myapp --tests "scenarios/api/*.ts" --env staging
 */

"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawnSync, spawn } = require("child_process");
const { glob } = require("glob");

// ── Argument parsing ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const opts = {
  client: null,
  tests: null,
  concurrency: 4,
  env: "default",
  help: false,
};

for (let i = 0; i < args.length; i++) {
  const [key, val] = args[i].split("=");
  switch (key) {
    case "--client":      opts.client = val ?? args[++i]; break;
    case "--tests":       opts.tests  = val ?? args[++i]; break;
    case "--concurrency": opts.concurrency = parseInt(val ?? args[++i], 10); break;
    case "--env":         opts.env    = val ?? args[++i]; break;
    case "--help": case "-h": opts.help = true; break;
  }
}

const ROOT_DIR  = path.resolve(__dirname, "../..");
const BIN_DIR   = path.resolve(__dirname, "..");
const RUN_TEST  = path.join(BIN_DIR, "run-test.sh");

// ── Help ──────────────────────────────────────────────────────────────────────

if (opts.help) {
  console.log(`
k6 Enterprise Framework — Parallel Test Runner

USAGE:
  node bin/testing/run-parallel.js --client <name> --tests <glob> [OPTIONS]

OPTIONS:
  --client <name>         Client name (required)
  --tests <glob>          Glob pattern relative to client dir (required)
  --concurrency <n>       Max parallel tests (default: 4)
  --env <name>            Environment config to use (default: default)

EXAMPLES:
  node bin/testing/run-parallel.js --client myapp --tests "scenarios/**/*.ts"
  node bin/testing/run-parallel.js --client myapp --tests "scenarios/api/*.ts" --concurrency 8

CONCURRENCY GUIDE:
  CPU-bound tests  : # of CPU cores (${os.cpus().length} on this machine)
  I/O-bound tests  : 2-4x CPU cores
  Browser tests    : 1-2 (resource intensive)
`);
  process.exit(0);
}

// ── Validation ────────────────────────────────────────────────────────────────

if (!opts.client) { console.error("Error: --client is required."); process.exit(1); }
if (!opts.tests)  { console.error("Error: --tests glob pattern is required."); process.exit(1); }
if (isNaN(opts.concurrency) || opts.concurrency < 1) {
  console.error("Error: --concurrency must be a positive integer.");
  process.exit(1);
}

const clientDir = path.join(ROOT_DIR, "clients", opts.client);
if (!fs.existsSync(clientDir)) {
  console.error(`Error: Client '${opts.client}' not found at ${clientDir}`);
  process.exit(1);
}

// CPU saturation warning
const cpuCount = os.cpus().length;
if (opts.concurrency > cpuCount * 2) {
  console.warn(`\x1b[33m[WARN]\x1b[0m  Concurrency (${opts.concurrency}) greatly exceeds CPU cores (${cpuCount}). Results may be distorted.`);
}

// ── Discover test files ───────────────────────────────────────────────────────

const globPattern = path.join("clients", opts.client, opts.tests);
let testFiles = glob.sync(globPattern, { cwd: ROOT_DIR }).sort();

if (testFiles.length === 0) {
  console.error(`Error: No test files matched pattern '${opts.tests}' in clients/${opts.client}/`);
  console.error(`  Try: scenarios/*.ts or scenarios/**/*.ts`);
  process.exit(1);
}

// Convert to scenario paths relative to scenarios/ dir
const scenarios = testFiles.map(f => {
  // clients/myapp/scenarios/api/smoke.ts -> api/smoke
  return f
    .replace(`clients/${opts.client}/`, "")
    .replace(/^scenarios\//, "")
    .replace(/\.ts$/, "");
});

// ── Result tracking ───────────────────────────────────────────────────────────

const results = [];
let completedCount = 0;
const total = scenarios.length;
const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const supportsColor = process.stdout.isTTY;
const GREEN  = supportsColor ? "\x1b[32m" : "";
const RED    = supportsColor ? "\x1b[31m" : "";
const YELLOW = supportsColor ? "\x1b[33m" : "";
const BLUE   = supportsColor ? "\x1b[34m" : "";
const RESET  = supportsColor ? "\x1b[0m"  : "";
const BOLD   = supportsColor ? "\x1b[1m"  : "";

// ── Signal handling ───────────────────────────────────────────────────────────

const activeProcesses = new Set();
let interrupted = false;

function shutdown(signal) {
  interrupted = true;
  console.log(`\n${YELLOW}[WARN]${RESET}  Received ${signal} — stopping active tests...`);
  for (const proc of activeProcesses) {
    try { proc.kill(signal); } catch {}
  }
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

// ── Parallel executor ─────────────────────────────────────────────────────────

async function runTest(scenario, index) {
  const startMs = Date.now();
  const label = `[${index + 1}/${total}] ${scenario}`;

  console.log(`${BLUE}[START]${RESET} ${label}`);

  return new Promise((resolve) => {
    const proc = spawn("bash", [
      RUN_TEST,
      `--client=${opts.client}`,
      `--scenario=${scenario}`,
      `--env=${opts.env}`,
    ], {
      env: { ...process.env, FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    activeProcesses.add(proc);

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", d => { stdout += d; });
    proc.stderr.on("data", d => { stderr += d; });

    proc.on("close", (code) => {
      activeProcesses.delete(proc);
      const durationMs = Date.now() - startMs;
      const passed = code === 0;
      completedCount++;

      const status = passed
        ? `${GREEN}[PASS]${RESET}`
        : `${RED}[FAIL]${RESET}`;
      const dur = `(${(durationMs / 1000).toFixed(1)}s)`;
      console.log(`${status}  ${label} ${dur}`);

      const result = {
        scenario,
        passed,
        durationMs,
        exitCode: code ?? -1,
        stdout,
        stderr,
        status: interrupted && !passed ? "interrupted" : (passed ? "pass" : "fail"),
      };
      results.push(result);
      resolve(result);
    });
  });
}

async function runWithConcurrency(tasks, concurrency) {
  const queue = [...tasks];
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (queue.length > 0 && !interrupted) {
      const task = queue.shift();
      if (task) await task();
    }
  });
  await Promise.all(workers);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${BOLD}k6 Parallel Runner${RESET}`);
  console.log(`  Client      : ${opts.client}`);
  console.log(`  Tests       : ${total} files matched`);
  console.log(`  Concurrency : ${opts.concurrency}`);
  console.log(`  Environment : ${opts.env}\n`);

  const startMs = Date.now();

  const tasks = scenarios.map((scenario, i) => () => runTest(scenario, i));
  await runWithConcurrency(tasks, opts.concurrency);

  const totalMs = Date.now() - startMs;
  const passed  = results.filter(r => r.passed).length;
  const failed  = results.filter(r => !r.passed).length;

  // ── Consolidated output for T-057 ────────────────────────────────────────
  const reportsBase = path.join(ROOT_DIR, "reports", opts.client);
  const batchDir    = path.join(reportsBase, `all-tests-${timestamp}`);
  fs.mkdirSync(batchDir, { recursive: true });

  // summary.md
  let md = `# Batch Execution Summary\n\n`;
  md += `| Key | Value |\n|---|---|\n`;
  md += `| Client | ${opts.client} |\n`;
  md += `| Environment | ${opts.env} |\n`;
  md += `| Date | ${new Date().toISOString()} |\n`;
  md += `| Tests found | ${total} |\n`;
  md += `| Concurrency | ${opts.concurrency} |\n`;
  md += `| Pattern | ${opts.tests} |\n`;
  md += `| Total duration | ${(totalMs / 1000).toFixed(1)}s |\n\n`;
  md += `## Results\n\n`;
  md += `| Test | Status | Duration |\n|---|---|---|\n`;
  for (const r of results) {
    const s = r.status === "pass" ? "✅ PASS" : r.status === "interrupted" ? "⚠ INTERRUPTED" : "❌ FAIL";
    md += `| ${r.scenario} | ${s} | ${(r.durationMs / 1000).toFixed(1)}s |\n`;
  }
  md += `\n## Summary\n\n`;
  md += `**Total**: ${total} | **Passed**: ${passed} | **Failed**: ${failed} | **Duration**: ${(totalMs / 1000).toFixed(1)}s\n`;
  fs.writeFileSync(path.join(batchDir, "summary.md"), md);

  // execution.log
  let log = `Batch Execution Log — ${new Date().toISOString()}\n${"=".repeat(60)}\n\n`;
  for (const r of results) {
    log += `\n--- ${r.scenario} (${r.status.toUpperCase()}, ${(r.durationMs / 1000).toFixed(1)}s) ---\n`;
    if (r.stdout) log += r.stdout;
    if (r.stderr) log += r.stderr;
  }
  fs.writeFileSync(path.join(batchDir, "execution.log"), log);

  // ── Console summary (T-058) ───────────────────────────────────────────────
  console.log(`\n${"─".repeat(50)}`);
  console.log(`${BOLD}Batch Execution Complete${RESET}`);
  console.log(`  Total    : ${total}`);
  console.log(`  ${GREEN}Passed${RESET}   : ${passed}`);
  if (failed > 0) {
    console.log(`  ${RED}Failed${RESET}   : ${failed}`);
    console.log(`\nFailed tests:`);
    for (const r of results.filter(r => !r.passed)) {
      console.log(`  ${RED}✗${RESET} ${r.scenario}`);
    }
  }
  console.log(`  Duration : ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`  Report   : ${batchDir}/summary.md`);
  console.log(`${"─".repeat(50)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
