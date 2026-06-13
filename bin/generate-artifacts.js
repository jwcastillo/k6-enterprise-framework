#!/usr/bin/env node
// generate-artifacts.js — Standalone report artifact generator (thin CLI wrapper).
//
// Phase 6 / DX-06 (D-18, D-20, D-21):
// The 2,644-LOC monolith was split into pure TypeScript sub-modules under
// `src/reporting/artifacts/`. This wrapper only:
//   1. Parses CLI args (preserving every legacy flag for backward compat).
//   2. Reads the k6 summary JSON from disk.
//   3. Calls `generateArtifacts(input)` from the artifacts pipeline.
//   4. Writes the returned bodies to disk + enriches the summary JSON
//      with generator-health captured via Node-only `os` APIs.
//   5. Forwards sub-module warnings to stderr (legacy "[WARN]" prefix).
//
// Usage (unchanged from legacy CLI):
//   node generate-artifacts.js \
//     --input=<summary.json> --output-dir=<dir> [--html=<dashboard.html>]
//     [--scenario=<name>] [--profile=<name>] [--env=<name>] [--client=<name>]
//     [--run-id=<id>] [--run-label=<label>] [--timestamp=<ISO>]
//     [--exit-code=<0|1|99>] [--comparison=<file>] [--story=<id>]
//     [--story-url=<url>] [--help|-h]

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") {
      out.help = "true";
      continue;
    }
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq !== -1) out[a.slice(2, eq)] = a.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) out[a.slice(2)] = argv[++i];
    else out[a.slice(2)] = "true";
  }
  return out;
}

const args = parseArgs(process.argv);

// Delegates to bin/_help.js (DX-01 D-01 canonical shape).
if (args.help === "true") {
  require("./_help").printHelp({
    name: "generate-artifacts",
    description: "Generate report artifacts from a k6 summary JSON (DX-06 thin CLI wrapper)",
    usage: "node bin/generate-artifacts.js --input=<summary.json> --output-dir=<dir> [options]",
    flags: [
      { flag: "--input=<file>", description: "k6 summary JSON to read (required)" },
      { flag: "--output-dir=<dir>", description: "Directory to write artifacts into (required)" },
      { flag: "--html=<file>", description: "k6 dashboard HTML to inject the banner into" },
      { flag: "--scenario=<name>", description: "Scenario name (stamped into artifacts)" },
      { flag: "--profile=<name>", description: "Profile name" },
      { flag: "--env=<name>", description: "Environment name (default: 'default')" },
      { flag: "--client=<name>", description: "Client name" },
      { flag: "--run-id=<id>", description: "Run identifier" },
      { flag: "--run-label=<label>", description: "Free-form label" },
      { flag: "--timestamp=<ISO>", description: "Run timestamp (YYYYMMDD-HHMMSS)" },
      { flag: "--exit-code=<0|1|99>", description: "k6 exit code (default: 0)" },
      { flag: "--comparison=<file>", description: "Comparison markdown file" },
      { flag: "--story=<id>", description: "Jira/GitHub story ID" },
      { flag: "--story-url=<url>", description: "Jira/GitHub story URL" },
      { flag: "--help, -h", description: "Show this help and exit" },
    ],
    examples: [
      "node bin/generate-artifacts.js --input=reports/summary.json --output-dir=reports",
      "node bin/generate-artifacts.js --input=summary.json --output-dir=reports --client=myapp --profile=smoke",
    ],
  });
  process.exit(0);
}

if (!args.input || !args["output-dir"]) {
  process.stderr.write(
    "Error: --input and --output-dir are required. Run with --help for usage.\n"
  );
  process.exit(1);
}
if (!fs.existsSync(args.input)) {
  process.stderr.write("Error: input file not found: " + args.input + "\n");
  process.exit(1);
}

// ── Locate the artifact pipeline (prefer compiled output, fall back to TS) ──
function loadPipeline() {
  try {
    return require("../dist/src/reporting/artifacts");
  } catch (_) {
    process.env.TS_NODE_COMPILER_OPTIONS =
      process.env.TS_NODE_COMPILER_OPTIONS || JSON.stringify({ module: "commonjs" });
    require("ts-node/register/transpile-only");
    return require("../src/reporting/artifacts");
  }
}

const { generateArtifacts, enrichSummary } = loadPipeline();

const k6Summary = JSON.parse(fs.readFileSync(args.input, "utf8"));

const meta = {
  runId: args["run-id"] || "",
  timestamp:
    args.timestamp ||
    path
      .basename(args.input)
      .replace(/^summary-/, "")
      .replace(/\.json$/, ""),
  scenario: args.scenario || "",
  profile: args.profile || "",
  env: args.env || "default",
  client: args.client || "",
  runLabel: args["run-label"] || "",
  exitCode: parseInt(args["exit-code"] || "0", 10),
  storyId: args.story || "",
  storyUrl: args["story-url"] || "",
};

const bundle = generateArtifacts({
  k6Summary,
  meta,
  outputDir: args["output-dir"],
  htmlInputPath: args.html || undefined,
  comparisonMarkdownPath: args.comparison || undefined,
});

function safeWrite(label, filePath, body) {
  if (!filePath || body === undefined) return;
  try {
    fs.writeFileSync(filePath, body);
    process.stderr.write("[OK] " + label + ": " + filePath + "\n");
  } catch (e) {
    process.stderr.write("[WARN] " + label + " write failed: " + e.message + "\n");
  }
}

safeWrite("Metrics CSV", bundle.metricsCsvPath, bundle.metricsCsv);
safeWrite("LLM analysis", bundle.analysisPath, bundle.analysisMarkdown);
safeWrite("Message template", bundle.messagePath, bundle.messageMarkdown);

if (bundle.htmlOutputPath && bundle.injectedHtml && fs.existsSync(bundle.htmlOutputPath)) {
  try {
    const original = fs.readFileSync(bundle.htmlOutputPath, "utf8");
    const injected = original.includes("</body>")
      ? original.replace("</body>", bundle.injectedHtml + "</body>")
      : original + bundle.injectedHtml;
    fs.writeFileSync(bundle.htmlOutputPath, injected);
    process.stderr.write("[OK] HTML banner injected: " + bundle.htmlOutputPath + "\n");
  } catch (e) {
    process.stderr.write("[WARN] HTML injection failed: " + e.message + "\n");
  }
}

// JSON enrichment must run in Node (uses `os` for generator-health).
try {
  const mem = process.memoryUsage();
  const la = os.loadavg();
  const cpuPercent = Math.round((la[0] / os.cpus().length) * 100);
  const warnings = [];
  if (cpuPercent > 80) warnings.push("CPU > 80% during test — results may be distorted");
  const enriched = enrichSummary({
    summary: k6Summary,
    meta,
    generatorHealth: {
      cpu: [cpuPercent],
      memory: [Math.round(mem.rss / 1024 / 1024)],
      loadAvg1m: parseFloat(la[0].toFixed(2)),
      warnings,
      capturedAt: new Date().toISOString(),
    },
    maxVus:
      (k6Summary.metrics && k6Summary.metrics.vus_max && k6Summary.metrics.vus_max.max) || null,
  });
  fs.writeFileSync(args.input, JSON.stringify(enriched, null, 2));
  process.stderr.write("[OK] JSON enriched: " + args.input + "\n");
} catch (e) {
  process.stderr.write("[WARN] JSON enrichment failed: " + e.message + "\n");
}

(bundle.warnings || []).forEach((w) => process.stderr.write("[WARN] " + w + "\n"));
process.stderr.write("[OK] All artifacts generated in: " + args["output-dir"] + "\n");

// Force-exit: avoid hanging on stray Node handles (mirrors legacy behavior).
process.exit(0);
