#!/usr/bin/env node
/**
 * T-142: Bulk data export for historical run summaries
 *
 * Scans reports/ directory for k6 summary JSON files matching the given
 * client and date range, then exports them in CSV or JSON format.
 *
 * Usage:
 *   node bin/export-data.js --client=X --from=2026-01-01 --to=2026-02-01 --format=csv
 *   node bin/export-data.js --client=X --format=json --out=export.json
 *   node bin/export-data.js --help
 *
 * Exit codes:
 *   0  success
 *   1  error or no data found
 */

"use strict";

const fs = require("fs");
const path = require("path");

// ── CLI ───────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name) {
  const m = args.find((a) => a.startsWith(`--${name}=`));
  return m ? m.slice(name.length + 3) : null;
}
function hasFlag(f) {
  return args.includes(`--${f}`);
}

if (hasFlag("help") || args.includes("-h")) {
  require("./_help").printHelp({
    name: "export-data",
    description: "Export historical k6 run summaries in CSV or JSON (T-142)",
    usage: "node bin/export-data.js --client=<name> [options]",
    flags: [
      { flag: "--client=<name>", description: "Client to export (required)" },
      { flag: "--from=<date>", description: "Start date ISO 8601 (e.g. 2026-01-01)" },
      { flag: "--to=<date>", description: "End date ISO 8601 (e.g. 2026-02-01)" },
      { flag: "--format=<fmt>", description: "csv | json (default: csv)" },
      { flag: "--out=<file>", description: "Write to file instead of stdout" },
      { flag: "--reports-dir=<d>", description: "Reports directory (default: ./reports)" },
      { flag: "--help, -h", description: "Show this help and exit" },
    ],
    examples: [
      "node bin/export-data.js --client=myapp --from=2026-01-01 --to=2026-02-01 --format=csv",
      "node bin/export-data.js --client=myapp --format=json --out=reports/export.json",
    ],
  });
  process.exit(0);
}

const clientName = getArg("client");
const fromDate = getArg("from") ? new Date(getArg("from")) : null;
const toDate = getArg("to") ? new Date(getArg("to") + "T23:59:59Z") : null;
const format = (getArg("format") || "csv").toLowerCase();
const outFile = getArg("out");
const ROOT_DIR = path.resolve(__dirname, "..");
const reportsDir = getArg("reports-dir") || path.join(ROOT_DIR, "reports");

if (!clientName) {
  console.error("[export-data] --client is required.");
  process.exit(1);
}

// ── Scan reports ──────────────────────────────────────────────────────────────

function walkDir(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full, results);
    else if (entry.name.endsWith("-summary.json") || entry.name.endsWith(".json")) {
      results.push(full);
    }
  }
  return results;
}

const clientReportsDir = path.join(reportsDir, clientName);
const allFiles = walkDir(clientReportsDir);

// Also check flat naming: reports/<client>_*_<profile>_<ts>.json
const flatFiles = fs.existsSync(reportsDir)
  ? fs
      .readdirSync(reportsDir)
      .filter((f) => f.startsWith(`${clientName}_`) && f.endsWith(".json"))
      .map((f) => path.join(reportsDir, f))
  : [];

const candidates = [...new Set([...allFiles, ...flatFiles])];

// ── Parse each run ────────────────────────────────────────────────────────────

function parseRunFile(filePath) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }

  const stat = fs.statSync(filePath);
  const mtime = stat.mtime;

  // Framework format
  let metrics = raw.metrics || raw.summary?.metrics || raw;
  const schemaVersion = raw.schemaVersion || "1.0.0";
  const runMeta = raw.summary || {};

  // Extract name parts from filename
  const base = path.basename(filePath, ".json").replace(/-summary$/, "");
  const parts = base.split("_");
  // Expect: <client>_<scenario>_<profile>_<timestamp>
  const client = parts[0] || clientName;
  const profile = parts[parts.length - 2] || "unknown";
  const scenario = parts.slice(1, -2).join("_") || "unknown";

  const dur = (metrics.http_req_duration || {}).values || {};
  const reqs = (metrics.http_reqs || {}).values || {};
  const failed = (metrics.http_req_failed || {}).values || {};
  const checks = (metrics.checks || {}).values || {};

  return {
    run_id: base,
    client,
    scenario,
    profile,
    timestamp: mtime.toISOString(),
    schema_version: schemaVersion,
    p50: dur["p(50)"] ?? dur.med ?? null,
    p95: dur["p(95)"] ?? null,
    p99: dur["p(99)"] ?? null,
    avg: dur.avg ?? null,
    error_rate: failed.rate ?? null,
    check_rate: checks.rate ?? null,
    req_count: reqs.count ?? null,
    req_rate: reqs.rate ?? null,
    file: filePath,
    _mtime: mtime,
  };
}

let runs = candidates
  .map(parseRunFile)
  .filter(Boolean)
  .filter((r) => {
    if (fromDate && r._mtime < fromDate) return false;
    if (toDate && r._mtime > toDate) return false;
    return true;
  })
  .sort((a, b) => a._mtime - b._mtime);

if (runs.length === 0) {
  console.error(
    `[export-data] No runs found for client '${clientName}'${fromDate ? ` from ${getArg("from")}` : ""}${toDate ? ` to ${getArg("to")}` : ""}`
  );
  process.exit(1);
}

console.error(`[export-data] Exporting ${runs.length} run(s) for client '${clientName}'`);

// ── Format output ─────────────────────────────────────────────────────────────

const COLUMNS = [
  "run_id",
  "client",
  "scenario",
  "profile",
  "timestamp",
  "p50",
  "p95",
  "p99",
  "avg",
  "error_rate",
  "check_rate",
  "req_count",
  "req_rate",
  "schema_version",
];

function fmt(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return v.toFixed(4);
  return String(v);
}

function escapeCsv(v) {
  const s = fmt(v);
  return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
}

let output;
if (format === "json") {
  const exportData = {
    schemaVersion: "2.0.0",
    exportedAt: new Date().toISOString(),
    client: clientName,
    from: fromDate?.toISOString() || null,
    to: toDate?.toISOString() || null,
    count: runs.length,
    runs: runs.map((r) => {
      const { _mtime, file, ...rest } = r;
      return rest;
    }),
  };
  output = JSON.stringify(exportData, null, 2);
} else {
  // CSV
  const header = COLUMNS.join(",");
  const rows = runs.map((r) => COLUMNS.map((c) => escapeCsv(r[c])).join(","));
  output = [header, ...rows].join("\n") + "\n";
}

if (outFile) {
  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  fs.writeFileSync(outFile, output, "utf-8");
  console.error(`[export-data] Written to: ${outFile}`);
} else {
  process.stdout.write(output);
}
