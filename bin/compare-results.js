#!/usr/bin/env node
/**
 * T-151: Standalone baseline comparator
 *
 * Compares two k6 summary JSON files (baseline vs current) and reports
 * metric deltas. Accepts both framework report format (schemaVersion) and
 * k6 native --summary-export format (metrics top-level).
 *
 * Usage:
 *   node bin/compare-results.js --baseline=<file> --current=<file>
 *   node bin/compare-results.js --baseline=<file> --current=<file> --threshold=10
 *   node bin/compare-results.js --help
 *
 * Exit codes:
 *   0  — no degradation beyond threshold
 *   1  — at least one metric degraded beyond threshold
 */

"use strict";

const fs = require("fs");
const path = require("path");

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(name) {
  const prefix = `--${name}=`;
  const match = args.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

if (hasFlag("help") || args.includes("-h")) {
  require("./_help").printHelp({
    name: "compare-results",
    description: "Compare two k6 JSON summary files and report metric deltas (T-151)",
    usage: "node bin/compare-results.js --baseline=<file> --current=<file> [options]",
    flags: [
      { flag: "--baseline=<file>", description: "Path to baseline JSON summary (required)" },
      { flag: "--current=<file>", description: "Path to current run JSON summary (required)" },
      { flag: "--threshold=<pct>", description: "Degradation threshold % (default: 10)" },
      { flag: "--out=<file>", description: "Write markdown report to file" },
      { flag: "--json", description: "Output results as JSON" },
      { flag: "--help, -h", description: "Show this help and exit" },
    ],
    examples: [
      "node bin/compare-results.js --baseline=reports/base.json --current=reports/now.json",
      "node bin/compare-results.js --baseline=base.json --current=now.json --threshold=5 --out=delta.md",
    ],
  });
  process.exit(0);
}

const baselineFile = getArg("baseline");
const currentFile = getArg("current");
const threshold = parseFloat(getArg("threshold") || "10");
const outFile = getArg("out");
const jsonOutput = hasFlag("json");

if (!baselineFile || !currentFile) {
  console.error("[compare-results] --baseline and --current are required.");
  console.error("  Run with --help for usage.");
  process.exit(1);
}

// ── Metrics normalization ─────────────────────────────────────────────────────

const HIGHER_IS_BETTER = new Set([
  "checks",
  "http_req_success",
  "checkPassRate",
  "iterations",
  "http_reqs",
  "data_received",
]);

function extractMetrics(filePath) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (err) {
    console.error(`[compare-results] Cannot read ${filePath}: ${err.message}`);
    process.exit(1);
  }

  // Framework format: { schemaVersion, summary: { metrics } }
  if (raw.schemaVersion && raw.summary) {
    return raw.summary.metrics || raw.summary;
  }
  // k6 native format: { metrics: { ... } }
  if (raw.metrics) return raw.metrics;
  // Flat format
  return raw;
}

function getKeyValues(metrics) {
  const out = {};
  for (const [name, data] of Object.entries(metrics)) {
    const v = data.values || data;
    if (v["p(95)"] !== undefined) out[`${name}.p95`] = v["p(95)"];
    if (v["p(99)"] !== undefined) out[`${name}.p99`] = v["p(99)"];
    if (v.avg !== undefined) out[`${name}.avg`] = v.avg;
    if (v.rate !== undefined) out[`${name}.rate`] = v.rate;
    if (v.count !== undefined) out[`${name}.count`] = v.count;
  }
  return out;
}

// ── Compare ───────────────────────────────────────────────────────────────────

const baselineMetrics = extractMetrics(baselineFile);
const currentMetrics = extractMetrics(currentFile);
const baselineValues = getKeyValues(baselineMetrics);
const currentValues = getKeyValues(currentMetrics);

const deltas = [];

for (const [key, currentVal] of Object.entries(currentValues)) {
  const baselineVal = baselineValues[key];
  if (baselineVal === undefined || baselineVal === 0) continue;

  const pctChange = ((currentVal - baselineVal) / Math.abs(baselineVal)) * 100;
  const metricName = key.split(".")[0];
  const higherIsBetter = HIGHER_IS_BETTER.has(metricName);

  // Degradation: higher is worse for latency/errors, lower is worse for success metrics
  const isDegradation = higherIsBetter ? pctChange < 0 : pctChange > 0;
  const absPct = Math.abs(pctChange);

  let status = "ok";
  if (absPct >= 10) status = "critical";
  else if (absPct >= 5) status = "significant";
  else if (absPct >= 1) status = "minimal";

  deltas.push({
    metric: key,
    baseline: baselineVal,
    current: currentVal,
    pctChange,
    absPct,
    isDegradation,
    status,
  });
}

deltas.sort(
  (a, b) => (b.isDegradation ? 1 : -1) - (a.isDegradation ? 1 : -1) || b.absPct - a.absPct
);

const degradations = deltas.filter((d) => d.isDegradation && d.absPct >= threshold);
const hasFailed = degradations.length > 0;

// ── Output ────────────────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BOLD = "\x1b[1m";

function statusColor(d) {
  if (!d.isDegradation) return GREEN;
  if (d.status === "critical") return RED;
  if (d.status === "significant") return YELLOW;
  return RESET;
}

function arrow(d) {
  if (!d.isDegradation) return "▲ +";
  return "▼ -";
}

if (jsonOutput) {
  console.log(
    JSON.stringify({ threshold, hasFailed, degradations: degradations.length, deltas }, null, 2)
  );
} else {
  console.log(`\n${BOLD}k6 Compare Results${RESET}`);
  console.log(`  Baseline: ${path.basename(baselineFile)}`);
  console.log(`  Current:  ${path.basename(currentFile)}`);
  console.log(`  Threshold: ${threshold}%\n`);

  const colW = [40, 12, 12, 12, 12];
  const header = ["Metric", "Baseline", "Current", "Change %", "Status"]
    .map((h, i) => h.padEnd(colW[i]))
    .join("  ");
  console.log(BOLD + header + RESET);
  console.log("-".repeat(header.length));

  for (const d of deltas.slice(0, 20)) {
    const col = statusColor(d);
    const row = [
      d.metric.padEnd(colW[0]),
      d.baseline.toFixed(2).padEnd(colW[1]),
      d.current.toFixed(2).padEnd(colW[2]),
      `${arrow(d)}${d.absPct.toFixed(1)}%`.padEnd(colW[3]),
      d.status.padEnd(colW[4]),
    ].join("  ");
    console.log(col + row + RESET);
  }

  if (degradations.length > 0) {
    console.log(
      `\n${RED}${BOLD}✗ ${degradations.length} metric(s) degraded beyond ${threshold}% threshold:${RESET}`
    );
    for (const d of degradations) {
      console.log(`  ${RED}▼ ${d.metric}: ${d.absPct.toFixed(1)}% worse${RESET}`);
    }
  } else {
    console.log(`\n${GREEN}${BOLD}✓ No degradation beyond ${threshold}% threshold${RESET}`);
  }
  console.log("");
}

// ── Markdown report ───────────────────────────────────────────────────────────

if (outFile) {
  const md = [
    `# Comparison Report`,
    ``,
    `- **Baseline**: \`${path.basename(baselineFile)}\``,
    `- **Current**: \`${path.basename(currentFile)}\``,
    `- **Threshold**: ${threshold}%`,
    `- **Result**: ${hasFailed ? "❌ FAILED" : "✅ PASSED"}`,
    ``,
    `## Metric Deltas`,
    ``,
    `| Metric | Baseline | Current | Change % | Status |`,
    `|--------|----------|---------|----------|--------|`,
    ...deltas.slice(0, 30).map((d) => {
      const chg = `${d.isDegradation ? "▼" : "▲"} ${d.absPct.toFixed(1)}%`;
      return `| \`${d.metric}\` | ${d.baseline.toFixed(2)} | ${d.current.toFixed(2)} | ${chg} | ${d.status} |`;
    }),
    ``,
    hasFailed
      ? `## ⚠️ Degradations Beyond Threshold\n\n${degradations.map((d) => `- \`${d.metric}\`: **${d.absPct.toFixed(1)}%** worse`).join("\n")}`
      : `## ✅ No Critical Degradations`,
    ``,
    `---`,
    `*Generated: ${new Date().toISOString()}*`,
  ].join("\n");

  fs.writeFileSync(outFile, md, "utf-8");
}

process.exit(hasFailed ? 1 : 0);
