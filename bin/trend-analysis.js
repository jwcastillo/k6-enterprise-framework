#!/usr/bin/env node
/**
 * T-151: Trend analysis report generator
 *
 * Analyzes a series of k6 run summary JSONs for a client/test combination
 * and generates a markdown trend report with charts (ASCII) and statistics.
 *
 * Usage:
 *   node bin/trend-analysis.js --client=my-team --test=smoke-users
 *   node bin/trend-analysis.js --client=my-team --test=smoke-users --limit=20
 *   node bin/trend-analysis.js --client=my-team --test=smoke-users --out=reports/trend.md
 *   node bin/trend-analysis.js --help
 *
 * Exit codes:
 *   0  — report generated
 *   1  — error
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

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
    name: "trend-analysis",
    description: "Generate a markdown trend report from historical k6 runs (T-151)",
    usage: "node bin/trend-analysis.js --client=<name> --test=<scenario> [options]",
    flags: [
      { flag: "--client=<name>", description: "Client name (matches clients/<name>/) (required)" },
      {
        flag: "--test=<scenario>",
        description: "Scenario slug (e.g. smoke-users or api_smoke-users) (required)",
      },
      { flag: "--limit=<n>", description: "Max number of runs to analyze (default: 20)" },
      { flag: "--out=<file>", description: "Write markdown to file instead of stdout" },
      {
        flag: "--metric=<name>",
        description: "Primary metric to trend (default: http_req_duration.p95)",
      },
      { flag: "--help, -h", description: "Show this help and exit" },
    ],
    examples: [
      "node bin/trend-analysis.js --client=myapp --test=smoke-users",
      "node bin/trend-analysis.js --client=myapp --test=smoke-users --limit=50 --out=reports/trend.md",
    ],
  });
  process.exit(0);
}

const clientName = getArg("client");
const testName = getArg("test");
const limit = parseInt(getArg("limit") || "20", 10);
const outFile = getArg("out");
const primaryMetric = getArg("metric") || "http_req_duration.p95";

if (!clientName || !testName) {
  console.error("[trend-analysis] --client and --test are required.");
  process.exit(1);
}

// ── Locate run files ──────────────────────────────────────────────────────────

const ROOT_DIR = path.resolve(__dirname, "..");
const reportsBase = path.join(ROOT_DIR, "reports");

// Find summary JSONs for this client/test — sorted by mtime (newest last)
const clientDir = path.join(reportsBase, clientName, testName);
let runs = [];

if (fs.existsSync(clientDir)) {
  runs = fs
    .readdirSync(clientDir)
    .filter((f) => f.endsWith("-summary.json"))
    .map((f) => {
      const fullPath = path.join(clientDir, f);
      const stat = fs.statSync(fullPath);
      return { file: fullPath, name: f, mtime: stat.mtimeMs };
    })
    .sort((a, b) => a.mtime - b.mtime)
    .slice(-limit);
}

// Also search flat reports/ dir for older naming convention
if (runs.length === 0) {
  const allFiles = fs.existsSync(reportsBase)
    ? fs
        .readdirSync(reportsBase)
        .filter(
          (f) => f.startsWith(`${clientName}_`) && f.includes(testName) && f.endsWith(".json")
        )
        .map((f) => {
          const fullPath = path.join(reportsBase, f);
          return { file: fullPath, name: f, mtime: fs.statSync(fullPath).mtimeMs };
        })
        .sort((a, b) => a.mtime - b.mtime)
        .slice(-limit)
    : [];
  runs = allFiles;
}

if (runs.length < 2) {
  console.error(
    `[trend-analysis] Need at least 2 runs for client '${clientName}' test '${testName}'.`
  );
  console.error(`  Found: ${runs.length} run(s) in ${clientDir}`);
  process.exit(1);
}

// ── Extract metrics from each run ─────────────────────────────────────────────

function extractValue(metrics, metricKey) {
  const [name, stat] = metricKey.split(".");
  const m = metrics[name];
  if (!m) return null;
  const v = m.values || m;
  return v[stat] !== undefined
    ? v[stat]
    : v[`p(${stat.replace("p", "")})`] !== undefined
      ? v[`p(${stat.replace("p", "")})`]
      : null;
}

function loadRun(runInfo) {
  try {
    const raw = JSON.parse(fs.readFileSync(runInfo.file, "utf-8"));
    const metrics = raw.metrics || raw.summary?.metrics || raw;
    return {
      file: runInfo.name,
      date: new Date(runInfo.mtime).toISOString().slice(0, 19),
      p95:
        extractValue(metrics, "http_req_duration.p95") ??
        metrics.http_req_duration?.values?.["p(95)"] ??
        null,
      p99:
        extractValue(metrics, "http_req_duration.p99") ??
        metrics.http_req_duration?.values?.["p(99)"] ??
        null,
      avg: metrics.http_req_duration?.values?.avg ?? null,
      errorRate: metrics.http_req_failed?.values?.rate ?? null,
      checkRate: metrics.checks?.values?.rate ?? null,
      reqCount: metrics.http_reqs?.values?.count ?? null,
      reqRate: metrics.http_reqs?.values?.rate ?? null,
      primary: extractValue(metrics, primaryMetric) ?? null,
    };
  } catch {
    return null;
  }
}

const data = runs.map(loadRun).filter(Boolean);

if (data.length < 2) {
  console.error("[trend-analysis] Could not parse enough valid run files.");
  process.exit(1);
}

// ── Statistics ────────────────────────────────────────────────────────────────

function stats(values) {
  const v = values.filter((x) => x !== null);
  if (v.length === 0) return { min: 0, max: 0, avg: 0, trend: "stable" };
  const min = Math.min(...v);
  const max = Math.max(...v);
  const avg = v.reduce((a, b) => a + b, 0) / v.length;
  const first = v[0];
  const last = v[v.length - 1];
  const pct = first !== 0 ? ((last - first) / Math.abs(first)) * 100 : 0;
  const trend = pct > 5 ? "degrading" : pct < -5 ? "improving" : "stable";
  return { min, max, avg, trend, pct, first, last };
}

const p95Stats = stats(data.map((d) => d.p95));
const errStats = stats(data.map((d) => d.errorRate));
const chkStats = stats(data.map((d) => d.checkRate));

// ── ASCII sparkline ───────────────────────────────────────────────────────────

const SPARK_CHARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

function sparkline(values) {
  const v = values.filter((x) => x !== null);
  if (v.length < 2) return "";
  const min = Math.min(...v);
  const max = Math.max(...v);
  const range = max - min || 1;
  return v
    .map((val) => SPARK_CHARS[Math.min(7, Math.floor(((val - min) / range) * 7.99))])
    .join("");
}

// ── Build markdown ────────────────────────────────────────────────────────────

const trendIcon = (t) => (t === "improving" ? "✅" : t === "degrading" ? "⚠️" : "➡️");

const md = [
  `# Trend Analysis — \`${clientName}/${testName}\``,
  ``,
  `- **Client**: ${clientName}`,
  `- **Test**: ${testName}`,
  `- **Runs analyzed**: ${data.length} (last ${limit} max)`,
  `- **Period**: ${data[0].date} → ${data[data.length - 1].date}`,
  `- **Generated**: ${new Date().toISOString()}`,
  ``,
  `## Summary`,
  ``,
  `| Metric | First | Last | Min | Max | Avg | Trend |`,
  `|--------|-------|------|-----|-----|-----|-------|`,
  `| p95 Response (ms) | ${p95Stats.first?.toFixed(0) ?? "N/A"} | ${p95Stats.last?.toFixed(0) ?? "N/A"} | ${p95Stats.min.toFixed(0)} | ${p95Stats.max.toFixed(0)} | ${p95Stats.avg.toFixed(0)} | ${trendIcon(p95Stats.trend)} ${p95Stats.trend} ${p95Stats.pct !== undefined ? `(${p95Stats.pct > 0 ? "+" : ""}${p95Stats.pct.toFixed(1)}%)` : ""} |`,
  `| Error Rate | ${errStats.first !== undefined ? (errStats.first * 100).toFixed(2) + "%" : "N/A"} | ${errStats.last !== undefined ? (errStats.last * 100).toFixed(2) + "%" : "N/A"} | ${(errStats.min * 100).toFixed(2)}% | ${(errStats.max * 100).toFixed(2)}% | ${(errStats.avg * 100).toFixed(2)}% | ${trendIcon(errStats.trend === "degrading" ? "degrading" : errStats.trend === "improving" ? "improving" : "stable")} ${errStats.trend} |`,
  `| Check Pass Rate | ${chkStats.first !== undefined ? (chkStats.first * 100).toFixed(1) + "%" : "N/A"} | ${chkStats.last !== undefined ? (chkStats.last * 100).toFixed(1) + "%" : "N/A"} | ${(chkStats.min * 100).toFixed(1)}% | ${(chkStats.max * 100).toFixed(1)}% | ${(chkStats.avg * 100).toFixed(1)}% | ${trendIcon(chkStats.trend === "improving" ? "degrading" : chkStats.trend === "degrading" ? "improving" : "stable")} ${chkStats.trend} |`,
  ``,
  `## p95 Response Time Trend`,
  ``,
  `\`${sparkline(data.map((d) => d.p95))}\``,
  ``,
  `## Run History`,
  ``,
  `| # | Date | p95 (ms) | p99 (ms) | Avg (ms) | Error Rate | Checks | Req/s |`,
  `|---|------|----------|----------|----------|------------|--------|-------|`,
  ...data.map((d, i) => {
    return `| ${i + 1} | ${d.date} | ${d.p95?.toFixed(0) ?? "N/A"} | ${d.p99?.toFixed(0) ?? "N/A"} | ${d.avg?.toFixed(0) ?? "N/A"} | ${d.errorRate !== null ? (d.errorRate * 100).toFixed(2) + "%" : "N/A"} | ${d.checkRate !== null ? (d.checkRate * 100).toFixed(1) + "%" : "N/A"} | ${d.reqRate?.toFixed(1) ?? "N/A"} |`;
  }),
  ``,
  `---`,
  `*Generated by k6 Enterprise Framework trend-analysis.js*`,
].join("\n");

// ── Output ────────────────────────────────────────────────────────────────────

if (outFile) {
  const dir = path.dirname(path.resolve(outFile));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outFile, md, "utf-8");
  console.log(`[trend-analysis] Report written to: ${outFile}`);
} else {
  console.log(md);
}

process.exit(0);
