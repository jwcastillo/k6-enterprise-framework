#!/usr/bin/env node
/**
 * auto-compare.js — T-145: Auto-comparison engine
 *
 * Compares current execution against up to 5 recent baselines.
 * Supports both framework summary format (schemaVersion) and k6 native
 * summary-export format (metrics top-level key).
 *
 * Usage:
 *   node bin/testing/auto-compare.js --client=_reference --test=smoke-users
 *   node bin/testing/auto-compare.js --baseline=reports/X.json --current=reports/Y.json
 *   node bin/testing/auto-compare.js --client=X --test=Y --threshold=10 --max-history=5
 *
 * Exit codes:
 *   0  All metrics within thresholds
 *   1  Critical degradation (> critical threshold) detected
 */

"use strict";

const fs = require("fs");
const path = require("path");

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = {};
process.argv.slice(2).forEach((a) => {
  const m = a.match(/^--([a-z-]+)=?(.*)$/);
  if (m) args[m[1]] = m[2] || true;
});

const REPORTS_DIR = path.resolve(args["reports-dir"] || "reports");
const CLIENT = args["client"] || null;
const TEST = args["test"] || null;
const BASELINE_FILE = args["baseline"] || null;
const CURRENT_FILE = args["current"] || null;
const MAX_HISTORY = parseInt(args["max-history"] || "5", 10);
const THRESHOLD_MIN = parseFloat(args["threshold-min"] || "1"); // %, minimal
const THRESHOLD_SIG = parseFloat(args["threshold-significant"] || "5"); // %, significant
const THRESHOLD_CRI = parseFloat(args["threshold-critical"] || args["threshold"] || "10"); // %, critical
const COMPARE_WITH = args["compare-with"] || process.env["COMPARE_WITH"] || null;
const QUIET = args["quiet"] === true;

// ── Colors ────────────────────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};
const color = (c, s) => (process.stdout.isTTY ? `${C[c]}${s}${C.reset}` : s);

// ── Report parsing ─────────────────────────────────────────────────────────────
/**
 * Parse a report file into a canonical metrics object.
 * Supports:
 *   - Framework summary (schemaVersion + summary.httpDuration)
 *   - k6 native --summary-export (metrics.http_req_duration etc.)
 */
function parseReport(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));

  // Framework summary format
  if (raw.schemaVersion && raw.summary) {
    const s = raw.summary;
    return {
      format: "framework",
      file: filePath,
      generatedAt: raw.generatedAt || s.startTime,
      identity: `${s.client}/${s.testName}/${s.profile}`,
      client: s.client,
      test: s.testName,
      profile: s.profile,
      metrics: {
        p50: s.httpDuration?.med ?? 0,
        p90: s.httpDuration?.p90 ?? 0,
        p95: s.httpDuration?.p95 ?? 0,
        p99: s.httpDuration?.p99 ?? 0,
        avg: s.httpDuration?.avg ?? 0,
        min: s.httpDuration?.min ?? 0,
        max: s.httpDuration?.max ?? 0,
        errorRate:
          s.httpRequestsFailed && s.httpRequests ? s.httpRequestsFailed / s.httpRequests : 0,
        iterations: s.iterations ?? 0,
        httpRequests: s.httpRequests ?? 0,
        checkPassRate: s.checks?.[0]?.passRate ?? 1,
        vus: s.vus ?? 0,
        passed: s.passed ?? true,
      },
    };
  }

  // k6 native summary-export format
  if (raw.metrics) {
    const m = raw.metrics;
    const dur = m["http_req_duration"] || {};
    const fails = m["http_req_failed"] || {};
    const reqs = m["http_reqs"] || {};
    const iters = m["iterations"] || {};
    const chks = m["checks"] || {};
    const vus = m["vus_max"] || m["vus"] || {};

    const totalChecks = (chks.passes || 0) + (chks.fails || 0);
    return {
      format: "k6-native",
      file: filePath,
      generatedAt: new Date().toISOString(),
      identity: path.basename(filePath, ".json"),
      client: null,
      test: path.basename(filePath, ".json"),
      profile: null,
      metrics: {
        p50: dur.med ?? dur["p(50)"] ?? 0,
        p90: dur["p(90)"] ?? 0,
        p95: dur["p(95)"] ?? 0,
        p99: dur["p(99)"] ?? 0,
        avg: dur.avg ?? 0,
        min: dur.min ?? 0,
        max: dur.max ?? 0,
        errorRate: fails.value ?? 0,
        iterations: iters.count ?? 0,
        httpRequests: reqs.count ?? 0,
        checkPassRate: totalChecks > 0 ? (chks.passes || 0) / totalChecks : 1,
        vus: vus.max ?? vus.value ?? 0,
        passed: true,
      },
    };
  }

  throw new Error(`Unrecognized report format in ${filePath}`);
}

// ── Baseline discovery ─────────────────────────────────────────────────────────
function findBaselines(client, test) {
  if (!fs.existsSync(REPORTS_DIR)) return [];

  // COMPARE_WITH: explicit file list (comma-separated)
  if (COMPARE_WITH) {
    return COMPARE_WITH.split(",")
      .map((f) => f.trim())
      .filter(fs.existsSync);
  }

  // Reports are stored in {REPORTS_DIR}/{client}/{scenario_slug}/summary-*.json
  // test is already the scenario_slug (e.g. "api_create-order")
  const scenarioDir = path.join(REPORTS_DIR, client, test);
  const searchDir = fs.existsSync(scenarioDir) ? scenarioDir : REPORTS_DIR;

  const files = fs
    .readdirSync(searchDir)
    .filter((f) => f.startsWith("summary-") && f.endsWith(".json"))
    .map((f) => path.join(searchDir, f))
    .filter((f) => {
      try {
        parseReport(f);
        return true;
      } catch {
        return false;
      }
    })
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  return files.slice(0, MAX_HISTORY);
}

// ── Delta calculation ──────────────────────────────────────────────────────────
const METRIC_LABELS = {
  p50: "p50 response",
  p90: "p90 response",
  p95: "p95 response",
  p99: "p99 response",
  avg: "avg response",
  max: "max response",
  errorRate: "Error rate",
  checkPassRate: "Check pass rate",
  iterations: "Iterations",
  httpRequests: "HTTP requests",
};

// For these metrics, higher is better (degradation = lower value)
const HIGHER_IS_BETTER = new Set(["checkPassRate", "iterations", "httpRequests"]);

function calcDelta(current, baseline, key) {
  const cur = current[key] ?? 0;
  const bas = baseline[key] ?? 0;
  if (bas === 0) return { abs: cur - bas, pct: null };
  const pct = ((cur - bas) / bas) * 100;
  return { abs: cur - bas, pct };
}

function severity(pct, key) {
  if (pct === null) return "unknown";
  const degrading = HIGHER_IS_BETTER.has(key) ? pct < 0 : pct > 0;
  const absPct = Math.abs(pct);
  if (!degrading) return absPct >= THRESHOLD_MIN ? "improvement" : "neutral";
  if (absPct >= THRESHOLD_CRI) return "critical";
  if (absPct >= THRESHOLD_SIG) return "significant";
  if (absPct >= THRESHOLD_MIN) return "minimal";
  return "neutral";
}

// ── Markdown report ────────────────────────────────────────────────────────────
function buildMarkdown(current, baselines, deltas) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const lines = [
    `# Auto-Comparison Report`,
    ``,
    `**Generated:** ${new Date().toISOString()}  `,
    `**Current:** \`${path.basename(current.file)}\`  `,
    `**Baselines compared:** ${baselines.length}`,
    ``,
    `## Metrics vs Latest Baseline`,
    ``,
    `| Metric | Current | Baseline | Change % | Status |`,
    `|--------|---------|----------|----------|--------|`,
  ];

  const latest = deltas[0];
  if (latest) {
    for (const [key, label] of Object.entries(METRIC_LABELS)) {
      const d = latest.deltas[key];
      if (!d) continue;
      const cur = current.metrics[key];
      const bas = latest.baseline.metrics[key];
      const sv = severity(d.pct, key);
      const icon =
        sv === "improvement"
          ? "✅"
          : sv === "critical"
            ? "🔴"
            : sv === "significant"
              ? "🟡"
              : sv === "minimal"
                ? "🟢"
                : "⚪";
      const pctStr = d.pct !== null ? `${d.pct > 0 ? "+" : ""}${d.pct.toFixed(1)}%` : "N/A";
      const unit =
        key === "errorRate" || key === "checkPassRate" ? "" : key.includes("Rate") ? "" : "ms";
      lines.push(
        `| ${label} | ${typeof cur === "number" ? cur.toFixed(1) : cur}${unit} | ${typeof bas === "number" ? bas.toFixed(1) : bas}${unit} | ${pctStr} | ${icon} ${sv} |`
      );
    }
  }

  // Top 3 improvements and degradations
  const allDeltas = Object.entries(latest?.deltas || {})
    .filter(([, d]) => d.pct !== null)
    .map(([key, d]) => ({
      key,
      label: METRIC_LABELS[key] || key,
      pct: d.pct,
      sv: severity(d.pct, key),
    }));

  const improvements = allDeltas
    .filter((d) => d.sv === "improvement")
    .sort((a, b) => {
      const aAbs = Math.abs(a.pct),
        bAbs = Math.abs(b.pct);
      return bAbs - aAbs;
    })
    .slice(0, 3);

  const degradations = allDeltas
    .filter((d) => ["critical", "significant", "minimal"].includes(d.sv))
    .sort((a, b) => {
      return Math.abs(b.pct) - Math.abs(a.pct);
    })
    .slice(0, 3);

  if (improvements.length > 0) {
    lines.push(``, `## Top Improvements`, ``);
    improvements.forEach((d) => lines.push(`- **${d.label}**: ${d.pct.toFixed(1)}% better`));
  }

  if (degradations.length > 0) {
    lines.push(``, `## Top Degradations`, ``);
    degradations.forEach((d) =>
      lines.push(`- **${d.label}**: ${Math.abs(d.pct).toFixed(1)}% worse (${d.sv})`)
    );
  }

  // Baselines section
  lines.push(``, `## Baselines Compared`, ``);
  baselines.forEach((b, i) => {
    lines.push(`${i + 1}. \`${path.basename(b.file)}\` — ${b.generatedAt}`);
  });

  lines.push(
    ``,
    `---`,
    `*Thresholds: minimal=${THRESHOLD_MIN}%, significant=${THRESHOLD_SIG}%, critical=${THRESHOLD_CRI}%*`
  );

  return lines.join("\n");
}

// ── Console output ────────────────────────────────────────────────────────────
function printTable(current, baselines, deltas) {
  if (QUIET) return;

  console.log(`\n${color("bold", "Auto-Comparison Results")}`);
  console.log(`${color("gray", `Current: ${path.basename(current.file)}`)}`);
  console.log(`${color("gray", `Baselines: ${baselines.length} compared`)}\n`);

  const col = [28, 10, 10, 10, 12];
  const header = ["Metric", "Current", "Baseline", "Change %", "Status"];
  console.log(color("bold", header.map((h, i) => h.padEnd(col[i])).join("")));
  console.log("─".repeat(col.reduce((a, b) => a + b, 0)));

  const latest = deltas[0];
  if (!latest) {
    console.log("No baseline available for comparison.");
    return;
  }

  for (const [key, label] of Object.entries(METRIC_LABELS)) {
    const d = latest.deltas[key];
    if (!d) continue;
    const cur = current.metrics[key];
    const bas = latest.baseline.metrics[key];
    const sv = severity(d.pct, key);
    const pctStr = d.pct !== null ? `${d.pct > 0 ? "+" : ""}${d.pct.toFixed(1)}%` : "N/A";
    const unit = ["errorRate", "checkPassRate", "iterations", "httpRequests"].includes(key)
      ? ""
      : "ms";
    const fmt = (v) => (typeof v === "number" ? v.toFixed(1) : String(v)) + unit;

    const statusColor =
      sv === "improvement"
        ? "green"
        : sv === "critical"
          ? "red"
          : sv === "significant"
            ? "yellow"
            : "gray";
    const statusIcon =
      sv === "improvement"
        ? "↑"
        : sv === "critical"
          ? "↓!"
          : sv === "significant"
            ? "↓"
            : sv === "minimal"
              ? "↓"
              : "=";

    console.log(
      label.padEnd(col[0]) +
        fmt(cur).padEnd(col[1]) +
        fmt(bas).padEnd(col[2]) +
        color(statusColor, pctStr.padEnd(col[3])) +
        color(statusColor, `${statusIcon} ${sv}`.padEnd(col[4]))
    );
  }

  // Top 3 of each
  const allDeltas = Object.entries(latest.deltas)
    .filter(([, d]) => d.pct !== null)
    .map(([key, d]) => ({
      key,
      label: METRIC_LABELS[key] || key,
      pct: d.pct,
      sv: severity(d.pct, key),
    }));

  const improvements = allDeltas
    .filter((d) => d.sv === "improvement")
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
    .slice(0, 3);
  const degradations = allDeltas
    .filter((d) => ["critical", "significant", "minimal"].includes(d.sv))
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
    .slice(0, 3);

  if (improvements.length) {
    console.log(`\n${color("green", color("bold", "Top improvements:"))}`);
    improvements.forEach((d) =>
      console.log(`  ${color("green", "↑")} ${d.label}: ${d.pct.toFixed(1)}% better`)
    );
  }
  if (degradations.length) {
    console.log(`\n${color("red", color("bold", "Top degradations:"))}`);
    degradations.forEach((d) =>
      console.log(
        `  ${color("red", "↓")} ${d.label}: ${Math.abs(d.pct).toFixed(1)}% worse (${color("red", d.sv)})`
      )
    );
  }
  console.log();
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  let current, baselines;

  // Mode 1: explicit --baseline / --current files
  if (BASELINE_FILE && CURRENT_FILE) {
    current = parseReport(path.resolve(CURRENT_FILE));
    baselines = [parseReport(path.resolve(BASELINE_FILE))];
  }
  // Mode 2: auto-discover by --client / --test
  else if (CLIENT && TEST) {
    const files = findBaselines(CLIENT, TEST);
    if (files.length === 0) {
      if (!QUIET)
        console.log(
          color("yellow", `No baselines found for ${CLIENT}/${TEST}. Skipping comparison.`)
        );
      process.exit(0);
    }
    // The most recent file is the current run; the rest are baselines
    current = parseReport(files[0]);
    baselines = files.slice(1).map(parseReport);
    if (baselines.length === 0) {
      if (!QUIET)
        console.log(color("yellow", "Only one report found — no baseline to compare against."));
      process.exit(0);
    }
  } else {
    console.error(
      "Usage: auto-compare.js --client=X --test=Y  OR  --baseline=A.json --current=B.json"
    );
    process.exit(1);
  }

  // Calculate deltas for each baseline
  const deltas = baselines.map((baseline) => ({
    baseline,
    deltas: Object.fromEntries(
      Object.keys(METRIC_LABELS).map((key) => [
        key,
        calcDelta(current.metrics, baseline.metrics, key),
      ])
    ),
  }));

  printTable(current, baselines, deltas);

  // Persist markdown report — use --out if provided, otherwise auto-generate name
  let mdFile;
  if (args["out"]) {
    mdFile = path.resolve(args["out"]);
  } else {
    const mdDir = CURRENT_FILE ? path.dirname(path.resolve(CURRENT_FILE)) : path.join(REPORTS_DIR);
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    mdFile = path.join(mdDir, `comparison-${ts}.md`);
  }
  fs.mkdirSync(path.dirname(mdFile), { recursive: true });
  fs.writeFileSync(mdFile, buildMarkdown(current, baselines, deltas));
  if (!QUIET) console.log(color("gray", `Comparison report: ${mdFile}`));

  // JSON output for CI integration
  const jsonOut = {
    generatedAt: new Date().toISOString(),
    current: { file: current.file, identity: current.identity },
    baselines: baselines.map((b) => ({ file: b.file, generatedAt: b.generatedAt })),
    thresholds: { min: THRESHOLD_MIN, significant: THRESHOLD_SIG, critical: THRESHOLD_CRI },
    results: deltas[0]
      ? Object.fromEntries(
          Object.entries(deltas[0].deltas).map(([k, d]) => [
            k,
            { ...d, severity: severity(d.pct, k) },
          ])
        )
      : {},
    // Critical degradation is evaluated against the latest baseline only
    hasCriticalDegradation: deltas[0]
      ? Object.entries(deltas[0].deltas).some(([k, d]) => severity(d.pct, k) === "critical")
      : false,
  };

  const jsonFile = mdFile.replace(".md", ".json");
  fs.writeFileSync(jsonFile, JSON.stringify(jsonOut, null, 2));

  // Exit code: 1 if critical degradation
  if (jsonOut.hasCriticalDegradation) {
    if (!QUIET)
      console.log(
        color(
          "red",
          color("bold", `Critical degradation detected (>${THRESHOLD_CRI}%). Exiting with code 1.`)
        )
      );
    process.exit(1);
  }

  process.exit(0);
}

main();
