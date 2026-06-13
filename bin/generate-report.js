#!/usr/bin/env node
/**
 * generate-report.js — Standalone HTML performance report generator
 *
 * Extracted from the monorepo's run-test.sh inline Node.js block.
 * Pure Node.js (no external dependencies), generates a self-contained
 * HTML file with SVG-based charts (offline-capable, CDN-free).
 *
 * Usage:
 *   node bin/generate-report.js --input=<summary.json> [options]
 *
 * Options:
 *   --input=<path>        k6 summary JSON file (required)
 *   --compare=<path>      Previous summary JSON for delta comparison
 *   --output=<path>       Output HTML path (default: same dir as input)
 *   --org-name=<name>     Organization name in header (default: "k6 Performance Report")
 *   --color=<hex>         Primary brand color (default: #2563eb)
 *   --logo=<path>         Logo image file (PNG/SVG/JPG) — embedded as base64
 *   --help                Show this help
 *
 * Exit codes:
 *   0  success
 *   1  error (missing input, parse failure, etc.)
 */

"use strict";

const fs = require("fs");
const path = require("path");

// ── CLI argument parsing ─────────────────────────────────────────────────────

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
    name: "generate-report",
    description: "Generate a self-contained HTML performance report from a k6 summary JSON",
    usage: "node bin/generate-report.js --input=<summary.json> [options]",
    flags: [
      { flag: "--input=<path>", description: "k6 summary JSON file (required)" },
      { flag: "--compare=<path>", description: "Previous summary JSON for delta comparison" },
      { flag: "--output=<path>", description: "Output HTML path (default: same dir as input)" },
      {
        flag: "--org-name=<name>",
        description: "Organization name in header (default: 'k6 Performance Report')",
      },
      { flag: "--color=<hex>", description: "Primary brand color (default: #2563eb)" },
      { flag: "--logo=<path>", description: "Logo image file (PNG/SVG/JPG) — embedded as base64" },
      { flag: "--help, -h", description: "Show this help and exit" },
    ],
    examples: [
      "node bin/generate-report.js --input=reports/summary.json",
      "node bin/generate-report.js --input=summary.json --compare=baseline.json --org-name='Acme Corp'",
    ],
  });
  process.exit(0);
}

const inputFile = getArg("input");
const compareFile = getArg("compare");
const outputFile = getArg("output");
const orgName = getArg("org-name") || "k6 Performance Report";
const primaryColor = getArg("color") || "#2563eb";
const logoFile = getArg("logo");

if (!inputFile) {
  console.error("[generate-report] --input is required.");
  console.error("  Run with --help for usage.");
  process.exit(1);
}

if (!fs.existsSync(inputFile)) {
  console.error(`[generate-report] Input file not found: ${inputFile}`);
  process.exit(1);
}

// ── Load k6 summary JSON ─────────────────────────────────────────────────────

let summary;
try {
  summary = JSON.parse(fs.readFileSync(inputFile, "utf-8"));
} catch (err) {
  console.error(`[generate-report] Failed to parse input JSON: ${err.message}`);
  process.exit(1);
}

const m = summary.metrics || {};
const dur = m.http_req_duration || {};
const reqs = m.http_reqs || {};
const failed = m.http_req_failed || {};
const chk = m.checks || {};
const itr = m.iterations || {};
const vus = m.vus_max || {};

// ── Basic metrics ────────────────────────────────────────────────────────────

const pass = chk.passes || 0;
const fail = chk.fails || 0;
const total = pass + fail;
const checkRate = total > 0 ? (pass / total) * 100 : 0;
const errorRatePct = failed.value !== undefined ? failed.value * 100 : null;
const avgMs = dur.avg !== undefined ? dur.avg : null;
const p50Ms = dur.med !== undefined ? dur.med : null;
const p90Ms = dur["p(90)"] !== undefined ? dur["p(90)"] : null;
const p95Ms = dur["p(95)"] !== undefined ? dur["p(95)"] : null;
const p99Ms = dur["p(99)"] !== undefined ? dur["p(99)"] : null;
const maxMs = dur.max !== undefined ? dur.max : null;

// ── APDEX calculation (T=500ms satisfied, F=2000ms frustrated) ───────────────

const APDEX_T = 500;
const APDEX_F = 2000;
let apdex = null;
let apdexLabel = "N/A";
let apdexColor = "#6b7280";

if (p50Ms !== null && p90Ms !== null && p99Ms !== null) {
  const satFraction = p50Ms < APDEX_T ? 0.5 : 0;
  const satFraction2 = p90Ms < APDEX_T ? 0.4 : 0;
  const tolFraction = p90Ms >= APDEX_T && p90Ms < APDEX_F ? 0.4 : 0;
  const tolFraction2 = p99Ms >= APDEX_T && p99Ms < APDEX_F ? 0.09 : 0;
  const satisfied = satFraction + satFraction2;
  const tolerating = tolFraction + tolFraction2;
  apdex = parseFloat(((satisfied + tolerating / 2) / 1).toFixed(2));

  if (apdex >= 0.94) {
    apdexLabel = "Excellent";
    apdexColor = "#16a34a";
  } else if (apdex >= 0.85) {
    apdexLabel = "Good";
    apdexColor = "#2563eb";
  } else if (apdex >= 0.7) {
    apdexLabel = "Fair";
    apdexColor = "#d97706";
  } else if (apdex >= 0.5) {
    apdexLabel = "Poor";
    apdexColor = "#ea580c";
  } else {
    apdexLabel = "Unacceptable";
    apdexColor = "#dc2626";
  }
}

// ── SLA compliance ───────────────────────────────────────────────────────────

const SLA_P95_MS = 2000;
const SLA_P99_MS = 5000;
const SLA_ERR_PCT = 1.0;
const SLA_CHECKS = 95;

const slaP95ok = p95Ms !== null ? p95Ms < SLA_P95_MS : null;
const slaP99ok = p99Ms !== null ? p99Ms < SLA_P99_MS : null;
const slaErrOk = errorRatePct !== null ? errorRatePct < SLA_ERR_PCT : null;
const slaChkOk = checkRate >= SLA_CHECKS;
const slaPass = slaP95ok !== false && slaP99ok !== false && slaErrOk !== false && slaChkOk;

const slaRules = [
  {
    label: `p95 < ${SLA_P95_MS}ms`,
    ok: slaP95ok,
    val: p95Ms !== null ? p95Ms.toFixed(0) + "ms" : "N/A",
  },
  {
    label: `p99 < ${SLA_P99_MS}ms`,
    ok: slaP99ok,
    val: p99Ms !== null ? p99Ms.toFixed(0) + "ms" : "N/A",
  },
  {
    label: `Error rate < ${SLA_ERR_PCT}%`,
    ok: slaErrOk,
    val: errorRatePct !== null ? errorRatePct.toFixed(2) + "%" : "N/A",
  },
  {
    label: `Checks >= ${SLA_CHECKS}%`,
    ok: slaChkOk,
    val: checkRate.toFixed(1) + "%",
  },
];

// ── Anomaly detection ────────────────────────────────────────────────────────

const anomalies = [];

if (maxMs !== null && p95Ms !== null && maxMs > p95Ms * 3) {
  anomalies.push({
    level: "warn",
    msg: `Extreme latency spike: max=${maxMs.toFixed(0)}ms is ${(maxMs / p95Ms).toFixed(1)}x p95`,
  });
}
if (errorRatePct !== null && errorRatePct > 10) {
  anomalies.push({
    level: "crit",
    msg: `High error rate: ${errorRatePct.toFixed(2)}% — service may be degraded`,
  });
} else if (errorRatePct !== null && errorRatePct > 1) {
  anomalies.push({
    level: "warn",
    msg: `Elevated error rate: ${errorRatePct.toFixed(2)}%`,
  });
}
if (p99Ms !== null && p95Ms !== null && p99Ms > p95Ms * 4) {
  anomalies.push({
    level: "warn",
    msg: `Heavy tail latency: p99/p95 ratio=${(p99Ms / p95Ms).toFixed(1)}x (expected <=2x)`,
  });
}
if (p95Ms !== null && p95Ms > SLA_P95_MS) {
  anomalies.push({
    level: "crit",
    msg: `p95 latency (${p95Ms.toFixed(0)}ms) exceeds SLA of ${SLA_P95_MS}ms`,
  });
}
if (checkRate < 100 && total > 0) {
  anomalies.push({
    level: fail > 10 ? "crit" : "warn",
    msg: `${fail} check failure(s) detected (${(100 - checkRate).toFixed(1)}% fail rate)`,
  });
}

// ── Performance recommendations ──────────────────────────────────────────────

const recs = [];

if (p99Ms !== null && p95Ms !== null && p99Ms > p95Ms * 3) {
  recs.push(
    "Long tail detected — investigate outlier requests, consider timeout tuning or circuit breakers."
  );
}
if (errorRatePct !== null && errorRatePct > 0.1) {
  recs.push(
    "Review error logs for root cause; consider retry logic with exponential backoff on transient failures."
  );
}
if (avgMs !== null && avgMs > 1000) {
  recs.push(
    "Average response time > 1s — profile server-side bottlenecks: DB queries, N+1 patterns, or missing caches."
  );
}
if (
  p95Ms !== null &&
  p95Ms < 200 &&
  checkRate === 100 &&
  (errorRatePct === null || errorRatePct < 0.1)
) {
  recs.push(
    "Excellent performance profile — consider increasing load target for capacity planning."
  );
}
if (vus.max !== undefined && vus.max > 50 && p95Ms !== null && p95Ms > 500) {
  recs.push(
    `Under high concurrency (${vus.max} VUs) latency degrades — check connection pool sizing and thread limits.`
  );
}
if (recs.length === 0) {
  recs.push("No specific recommendations — performance looks healthy for this profile.");
}

// ── Comparison data ──────────────────────────────────────────────────────────

let comparisonRows = [];

if (compareFile) {
  if (!fs.existsSync(compareFile)) {
    console.error(`[generate-report] Comparison file not found: ${compareFile}`);
    process.exit(1);
  }

  let prevSummary;
  try {
    prevSummary = JSON.parse(fs.readFileSync(compareFile, "utf-8"));
  } catch (err) {
    console.error(`[generate-report] Failed to parse comparison JSON: ${err.message}`);
    process.exit(1);
  }

  const pm = prevSummary.metrics || {};
  const pDur = pm.http_req_duration || {};
  const pReqs = pm.http_reqs || {};
  const pFailed = pm.http_req_failed || {};
  const pChk = pm.checks || {};

  const pPass = pChk.passes || 0;
  const pFail = pChk.fails || 0;
  const pTotal = pPass + pFail;
  const pCheckRate = pTotal > 0 ? (pPass / pTotal) * 100 : 0;
  const pErrPct = pFailed.value !== undefined ? pFailed.value * 100 : null;

  const metricPairs = [
    { label: "Avg (ms)", curr: avgMs, prev: pDur.avg != null ? pDur.avg : null, lowerBetter: true },
    { label: "p50 (ms)", curr: p50Ms, prev: pDur.med != null ? pDur.med : null, lowerBetter: true },
    {
      label: "p90 (ms)",
      curr: p90Ms,
      prev: pDur["p(90)"] != null ? pDur["p(90)"] : null,
      lowerBetter: true,
    },
    {
      label: "p95 (ms)",
      curr: p95Ms,
      prev: pDur["p(95)"] != null ? pDur["p(95)"] : null,
      lowerBetter: true,
    },
    {
      label: "p99 (ms)",
      curr: p99Ms,
      prev: pDur["p(99)"] != null ? pDur["p(99)"] : null,
      lowerBetter: true,
    },
    { label: "Max (ms)", curr: maxMs, prev: pDur.max != null ? pDur.max : null, lowerBetter: true },
    {
      label: "Req/s",
      curr: reqs.rate != null ? reqs.rate : null,
      prev: pReqs.rate != null ? pReqs.rate : null,
      lowerBetter: false,
    },
    {
      label: "Error %",
      curr: errorRatePct,
      prev: pErrPct,
      lowerBetter: true,
    },
    {
      label: "Check %",
      curr: checkRate,
      prev: pCheckRate,
      lowerBetter: false,
    },
  ];

  for (const mp of metricPairs) {
    if (mp.curr === null || mp.prev === null) continue;
    const absDelta = mp.curr - mp.prev;
    const pctDelta = mp.prev !== 0 ? (absDelta / Math.abs(mp.prev)) * 100 : 0;
    const isWorse = mp.lowerBetter ? absDelta > 0 : absDelta < 0;
    comparisonRows.push({
      label: mp.label,
      prev: mp.prev,
      curr: mp.curr,
      absDelta,
      pctDelta,
      isWorse,
    });
  }
}

// ── Logo handling ────────────────────────────────────────────────────────────

let logoDataUri = "";
if (logoFile) {
  if (!fs.existsSync(logoFile)) {
    console.error(`[generate-report] Logo file not found: ${logoFile}`);
    process.exit(1);
  }
  const ext = path.extname(logoFile).toLowerCase().replace(".", "");
  const mimeMap = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    svg: "image/svg+xml",
    gif: "image/gif",
    webp: "image/webp",
  };
  const mime = mimeMap[ext] || "image/png";
  const buf = fs.readFileSync(logoFile);
  logoDataUri = `data:${mime};base64,${buf.toString("base64")}`;
}

// ── Helper formatters ────────────────────────────────────────────────────────

const fmt = (v, sfx = "ms", d = 1) => (v !== null && v !== undefined ? v.toFixed(d) + sfx : "N/A");
const fmtN = (v) => (v !== null && v !== undefined ? Number(v).toLocaleString("en-US") : "N/A");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ── Derived display values ───────────────────────────────────────────────────

const timestamp = new Date().toISOString();
const scenarioName = summary.testName || summary.scenario || path.basename(inputFile, ".json");
const apdexDisplay = apdex !== null ? apdex.toFixed(2) : "N/A";
const statusLabel = slaPass ? "PASS" : "FAIL";
const statusColor = slaPass ? "#16a34a" : "#dc2626";
const statusBg = slaPass ? "#dcfce7" : "#fee2e2";
const checkColor = checkRate >= 100 ? "#16a34a" : checkRate >= 95 ? "#d97706" : "#dc2626";
const errColor =
  errorRatePct === null
    ? "#6b7280"
    : errorRatePct < 1
      ? "#16a34a"
      : errorRatePct < 10
        ? "#d97706"
        : "#dc2626";

// ── Build SVG bar chart for latency distribution ─────────────────────────────

function buildLatencyChart() {
  const labels = ["p50", "p90", "p95", "p99", "max"];
  const values = [p50Ms, p90Ms, p95Ms, p99Ms, maxMs].map((v) => (v !== null ? v : 0));
  const maxVal = Math.max(...values, SLA_P99_MS, 1);

  const barHeight = 28;
  const gap = 8;
  const labelWidth = 42;
  const valueWidth = 80;
  const chartLeft = labelWidth + 8;
  const chartWidth = 400;
  const totalWidth = chartLeft + chartWidth + valueWidth + 8;
  const totalHeight = labels.length * (barHeight + gap) + 20;

  const slaP95x = chartLeft + (SLA_P95_MS / maxVal) * chartWidth;
  const slaP99x = chartLeft + (SLA_P99_MS / maxVal) * chartWidth;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" `;
  svg += `style="width:100%;max-width:${totalWidth}px;height:auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">`;

  // SLA threshold lines
  if (slaP95x < chartLeft + chartWidth) {
    svg += `<line x1="${slaP95x}" y1="0" x2="${slaP95x}" y2="${totalHeight - 16}" stroke="#dc262660" stroke-width="1" stroke-dasharray="4,3"/>`;
    svg += `<text x="${slaP95x}" y="${totalHeight - 4}" fill="#dc2626" font-size="8" text-anchor="middle">p95 SLA</text>`;
  }
  if (slaP99x < chartLeft + chartWidth) {
    svg += `<line x1="${slaP99x}" y1="0" x2="${slaP99x}" y2="${totalHeight - 16}" stroke="#dc262640" stroke-width="1" stroke-dasharray="4,3"/>`;
    svg += `<text x="${slaP99x}" y="${totalHeight - 4}" fill="#dc2626" font-size="8" text-anchor="middle">p99 SLA</text>`;
  }

  labels.forEach((lbl, i) => {
    const y = i * (barHeight + gap);
    const v = values[i];
    const barW = Math.max((v / maxVal) * chartWidth, 2);

    // Color logic: red if over SLA, amber if > 1000ms, purple default
    let color = "#7c3aed";
    if (i === 2 && v > SLA_P95_MS) color = "#dc2626";
    else if (i >= 3 && v > SLA_P99_MS) color = "#dc2626";
    else if (v > 1000) color = "#d97706";

    // Label
    svg += `<text x="${labelWidth}" y="${y + barHeight / 2 + 4}" fill="#94a3b8" font-size="11" text-anchor="end" font-weight="600">${lbl}</text>`;

    // Bar background
    svg += `<rect x="${chartLeft}" y="${y}" width="${chartWidth}" height="${barHeight}" rx="4" fill="#1e293b"/>`;

    // Bar fill
    svg += `<rect x="${chartLeft}" y="${y}" width="${barW}" height="${barHeight}" rx="4" fill="${color}" opacity="0.85"/>`;

    // Value
    svg += `<text x="${chartLeft + chartWidth + 8}" y="${y + barHeight / 2 + 4}" fill="#f8fafc" font-size="11" font-weight="700" font-family="monospace">${v.toFixed(0)}ms</text>`;
  });

  svg += "</svg>";
  return svg;
}

// ── Build HTML sections ──────────────────────────────────────────────────────

function buildKpiCards() {
  const kpis = [
    {
      label: "Total Requests",
      value: fmtN(reqs.count),
      sub: reqs.rate !== undefined ? reqs.rate.toFixed(1) + " req/s" : "",
      color: "var(--text)",
    },
    {
      label: "Avg Response",
      value: fmt(avgMs),
      sub: "mean latency",
      color: "var(--text)",
    },
    {
      label: "Error Rate",
      value: errorRatePct !== null ? errorRatePct.toFixed(2) + "%" : "N/A",
      sub: `SLA: <${SLA_ERR_PCT}%`,
      color: errColor,
    },
    {
      label: "Check Rate",
      value: checkRate.toFixed(1) + "%",
      sub: `${pass} passed / ${fail} failed`,
      color: checkColor,
    },
    {
      label: "APDEX",
      value: apdexDisplay,
      sub: `${apdexLabel} (T=500ms)`,
      color: apdexColor,
    },
    {
      label: "p95 Response",
      value: fmt(p95Ms),
      sub: `SLA: <${SLA_P95_MS}ms`,
      color: slaP95ok === false ? "#dc2626" : "var(--text)",
    },
  ];

  return kpis
    .map(
      (k) => `
      <div class="kpi-card">
        <div class="kpi-label">${esc(k.label)}</div>
        <div class="kpi-value" style="color:${k.color}">${esc(k.value)}</div>
        <div class="kpi-sub">${k.sub}</div>
      </div>`
    )
    .join("\n");
}

function buildSlaTable() {
  const rows = slaRules
    .map((r) => {
      const icon = r.ok === null ? "&#8212;" : r.ok ? "&#10003;" : "&#10007;";
      const cls = r.ok === null ? "sla-na" : r.ok ? "sla-ok" : "sla-fail";
      return `<tr><td>${esc(r.label)}</td><td class="mono">${esc(r.val)}</td><td class="${cls}">${icon}</td></tr>`;
    })
    .join("\n");

  return `
    <table class="sla-table">
      <thead><tr><th>Rule</th><th>Value</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function buildAnomalies() {
  if (anomalies.length === 0) {
    return '<div class="anomaly anomaly-ok"><span>&#10003;</span> No anomalies detected</div>';
  }
  return anomalies
    .map((a) => {
      const icon = a.level === "crit" ? "&#10007;" : "&#9888;";
      return `<div class="anomaly anomaly-${a.level}"><span>${icon}</span> ${esc(a.msg)}</div>`;
    })
    .join("\n");
}

function buildRecommendations() {
  return "<ol>" + recs.map((r) => `<li>${esc(r)}</li>`).join("\n") + "</ol>";
}

function buildComparison() {
  if (comparisonRows.length === 0) return "";

  const headerRow =
    "<tr><th>Metric</th><th>Previous</th><th>Current</th><th>Delta</th><th>Change %</th></tr>";
  const rows = comparisonRows
    .map((r) => {
      const cls = r.isWorse ? "delta-worse" : "delta-better";
      const sign = r.absDelta >= 0 ? "+" : "";
      const pctSign = r.pctDelta >= 0 ? "+" : "";
      return `<tr>
        <td>${esc(r.label)}</td>
        <td class="mono">${r.prev.toFixed(2)}</td>
        <td class="mono">${r.curr.toFixed(2)}</td>
        <td class="mono ${cls}">${sign}${r.absDelta.toFixed(2)}</td>
        <td class="mono ${cls}">${pctSign}${r.pctDelta.toFixed(1)}%</td>
      </tr>`;
    })
    .join("\n");

  return `
    <section id="comparison">
      <h2>Historical Comparison</h2>
      <p class="comp-note">Comparing against: <code>${esc(path.basename(compareFile))}</code></p>
      <table class="comp-table">
        <thead>${headerRow}</thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

// ── Logo HTML ────────────────────────────────────────────────────────────────

const logoHtml = logoDataUri ? `<img src="${logoDataUri}" alt="Logo" class="header-logo"/>` : "";

// ── Assemble full HTML ───────────────────────────────────────────────────────

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>k6 Performance Report — ${esc(scenarioName)}</title>
  <style>
    :root {
      --primary-color: ${primaryColor};
      --bg: #0f172a;
      --bg2: #1e293b;
      --bg3: #0d1526;
      --border: #334155;
      --text: #f8fafc;
      --muted: #94a3b8;
      --dim: #64748b;
      --ok: #16a34a;
      --warn: #d97706;
      --err: #dc2626;
      --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0; padding: 0;
      font-family: var(--font);
      background: var(--bg3);
      color: var(--text);
      line-height: 1.5;
    }

    /* ── Header ── */
    header {
      background: var(--bg);
      border-bottom: 3px solid var(--primary-color);
      padding: 20px 28px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
    }
    .header-brand {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .header-logo { height: 36px; width: auto; }
    .header-title {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.3px;
    }
    .header-sub {
      font-size: 11px;
      color: var(--muted);
      margin-top: 2px;
      font-family: monospace;
    }
    .status-badge {
      padding: 7px 18px;
      border-radius: 6px;
      font-weight: 700;
      font-size: 14px;
      border: 2px solid ${statusColor};
      background: ${statusBg};
      color: ${statusColor};
      white-space: nowrap;
    }

    /* ── Main container ── */
    main { max-width: 1200px; margin: 0 auto; padding: 0; }

    /* ── Section titles ── */
    section { padding: 24px 28px; border-bottom: 1px solid var(--border); }
    section h2 {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      color: var(--dim);
      font-weight: 700;
      margin: 0 0 16px 0;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border);
    }

    /* ── Executive summary ── */
    #executive {
      background: var(--bg2);
      display: flex;
      align-items: center;
      gap: 32px;
      flex-wrap: wrap;
    }
    .exec-apdex {
      text-align: center;
      min-width: 120px;
    }
    .exec-apdex-score {
      font-size: 48px;
      font-weight: 900;
      line-height: 1;
      color: ${apdexColor};
    }
    .exec-apdex-label {
      font-size: 13px;
      font-weight: 600;
      color: ${apdexColor};
      margin-top: 4px;
    }
    .exec-apdex-desc {
      font-size: 10px;
      color: var(--muted);
      margin-top: 4px;
    }
    .exec-summary-text {
      flex: 1;
      font-size: 13px;
      color: var(--muted);
      line-height: 1.7;
    }
    .exec-summary-text strong { color: var(--text); }

    /* ── KPI cards ── */
    #kpis {
      background: var(--border);
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 1px;
    }
    .kpi-card {
      background: var(--bg2);
      padding: 16px 18px;
    }
    .kpi-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: var(--dim);
      margin-bottom: 6px;
    }
    .kpi-value {
      font-size: 24px;
      font-weight: 800;
      line-height: 1;
    }
    .kpi-sub {
      font-size: 11px;
      color: var(--muted);
      margin-top: 4px;
    }

    /* ── SLA table ── */
    .sla-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .sla-table th {
      text-align: left;
      color: var(--dim);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      padding: 6px 10px;
      border-bottom: 2px solid var(--border);
    }
    .sla-table td { padding: 8px 10px; border-bottom: 1px solid var(--border); }
    .sla-table tr:last-child td { border-bottom: none; }
    .sla-ok { color: var(--ok); font-weight: 700; text-align: center; }
    .sla-fail { color: var(--err); font-weight: 700; text-align: center; }
    .sla-na { color: var(--dim); text-align: center; }

    /* ── Latency chart ── */
    #latency { background: var(--bg2); }
    .chart-container { margin-top: 8px; }
    .chart-note { font-size: 10px; color: #475569; margin-top: 10px; }

    /* ── Anomalies ── */
    .anomaly {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 10px 12px;
      border-radius: 6px;
      margin-bottom: 8px;
      font-size: 13px;
      line-height: 1.5;
    }
    .anomaly span { font-size: 15px; flex-shrink: 0; }
    .anomaly-ok { background: #052e16; border: 1px solid #16a34a; color: #86efac; }
    .anomaly-warn { background: #431407; border: 1px solid #d97706; color: #fed7aa; }
    .anomaly-crit { background: #3f0f0f; border: 1px solid #dc2626; color: #fca5a5; }

    /* ── Recommendations ── */
    #recommendations ol {
      padding-left: 20px; margin: 0;
    }
    #recommendations li {
      padding: 6px 0;
      border-bottom: 1px solid var(--border);
      font-size: 13px;
      color: #cbd5e1;
      line-height: 1.6;
    }
    #recommendations li:last-child { border-bottom: none; }

    /* ── Comparison ── */
    .comp-note { font-size: 12px; color: var(--muted); font-style: italic; margin-bottom: 12px; }
    .comp-note code { background: var(--bg); padding: 2px 6px; border-radius: 3px; font-size: 11px; }
    .comp-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .comp-table th {
      text-align: left;
      color: var(--dim);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      padding: 6px 10px;
      border-bottom: 2px solid var(--border);
    }
    .comp-table td { padding: 6px 10px; border-bottom: 1px solid var(--border); }
    .comp-table tr:last-child td { border-bottom: none; }
    .delta-worse { color: #fca5a5; }
    .delta-better { color: #86efac; }

    /* ── Footer ── */
    footer {
      background: var(--bg);
      padding: 16px 28px;
      font-size: 11px;
      color: var(--dim);
      display: flex;
      flex-wrap: wrap;
      gap: 24px;
      border-top: 1px solid var(--border);
    }
    .footer-item span { color: var(--muted); font-weight: 600; }

    /* ── Utilities ── */
    .mono { font-family: monospace; font-size: 12px; }

    /* ── Print styles ── */
    @media print {
      body { background: #0f172a !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      section { break-inside: avoid; }
      @page { size: landscape; margin: 8mm; }
    }

    /* ── Responsive ── */
    @media (max-width: 640px) {
      header { padding: 14px 16px; }
      section { padding: 16px; }
      #kpis { grid-template-columns: repeat(2, 1fr); }
      .kpi-value { font-size: 18px; }
      .exec-apdex-score { font-size: 36px; }
    }
  </style>
</head>
<body>

  <header>
    <div class="header-brand">
      ${logoHtml}
      <div>
        <div class="header-title">${esc(orgName)}</div>
        <div class="header-sub">${esc(scenarioName)} &mdash; ${timestamp}</div>
      </div>
    </div>
    <div class="status-badge">${statusLabel}</div>
  </header>

  <main>

    <!-- Executive Summary -->
    <section id="executive">
      <div class="exec-apdex">
        <div class="exec-apdex-score">${apdexDisplay}</div>
        <div class="exec-apdex-label">${esc(apdexLabel)}</div>
        <div class="exec-apdex-desc">APDEX (T=500ms)</div>
      </div>
      <div class="exec-summary-text">
        <strong>${fmtN(reqs.count)}</strong> requests at <strong>${reqs.rate !== undefined ? reqs.rate.toFixed(1) : "N/A"} req/s</strong>
        with <strong>${fmt(avgMs)}</strong> average response time.
        Error rate: <strong style="color:${errColor}">${errorRatePct !== null ? errorRatePct.toFixed(2) + "%" : "N/A"}</strong>.
        Checks: <strong style="color:${checkColor}">${checkRate.toFixed(1)}%</strong> (${pass}/${total}).
        Max VUs: <strong>${fmtN(vus.max)}</strong>.
        ${
          slaPass
            ? '<span style="color:#16a34a;font-weight:700">All SLA targets met.</span>'
            : '<span style="color:#dc2626;font-weight:700">SLA violations detected.</span>'
        }
      </div>
    </section>

    <!-- KPI Cards -->
    <section id="kpis">
      ${buildKpiCards()}
    </section>

    <!-- SLA Compliance -->
    <section id="sla">
      <h2>SLA Compliance</h2>
      ${buildSlaTable()}
    </section>

    <!-- Latency Distribution -->
    <section id="latency">
      <h2>Latency Distribution</h2>
      <div class="chart-container">
        ${buildLatencyChart()}
      </div>
      <div class="chart-note">Dashed red lines indicate SLA thresholds</div>
    </section>

    <!-- Anomalies -->
    <section id="anomalies">
      <h2>Anomaly Detection</h2>
      ${buildAnomalies()}
    </section>

    <!-- Recommendations -->
    <section id="recommendations">
      <h2>Recommendations</h2>
      ${buildRecommendations()}
    </section>

    <!-- Comparison (if --compare provided) -->
    ${buildComparison()}

  </main>

  <footer>
    <div class="footer-item">Generated: <span>${timestamp}</span></div>
    <div class="footer-item">Scenario: <span>${esc(scenarioName)}</span></div>
    <div class="footer-item">Input: <span>${esc(path.basename(inputFile))}</span></div>
    ${compareFile ? `<div class="footer-item">Compared to: <span>${esc(path.basename(compareFile))}</span></div>` : ""}
    <div class="footer-item">Generator: <span>generate-report.js</span></div>
  </footer>

</body>
</html>`;

// ── Write output ─────────────────────────────────────────────────────────────

const defaultName = `html-report-${timestamp.replace(/[:.]/g, "-")}.html`;
const outPath = outputFile || path.join(path.dirname(inputFile), defaultName);
const outDir = path.dirname(outPath);

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

try {
  fs.writeFileSync(outPath, html, "utf-8");
} catch (err) {
  console.error(`[generate-report] Failed to write output: ${err.message}`);
  process.exit(1);
}

console.log(outPath);
process.exit(0);
