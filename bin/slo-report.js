#!/usr/bin/env node
/**
 * T-040: Monthly SLA/SLO compliance reports
 *
 * Aggregates execution results for a month and generates compliance reports.
 *
 * Usage:
 *   node bin/slo-report.js --client myapp --month 2026-02
 *   node bin/slo-report.js --client myapp --month 2026-02 --format json
 *
 * CR-03 (Phase 07 / 07-08): main(argv, deps) is exposed for dependency
 * injection so the Vitest regression suite can exercise the PDF path with
 * a fake `playwright` and a write-tracking fake `fs`. Per-format branches
 * use EARLY RETURNS — the original "always also write JSON" trailing block
 * is gone. Each format (pdf, json, html) writes the canonical JSON sidecar
 * exactly ONCE.
 *
 * CR-02 (Phase 07 / 07-01): `extractMetric` reads the canonical k6 native
 * shape `metrics.<name>.values.<key>` with fallback to the framework-enriched
 * shape, and the call site uses `actual == null` (loose) so undefined + null
 * both skip cleanly. The CR-03 refactor MUST NOT regress this — semantics
 * of extractMetric, collectExecutionSummaries and generateHtmlReport are
 * preserved exactly. Only flow-control and module-boundary changed.
 */

"use strict";

// ── Argument parsing ──────────────────────────────────────────────────────────

function parseArgs(argv, helpExit) {
  const opts = { client: null, month: null, format: "html" };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--client":
        opts.client = argv[++i];
        break;
      case "--month":
        opts.month = argv[++i];
        break;
      case "--format":
        opts.format = argv[++i];
        break;
      case "--help":
      case "-h":
        require("./_help").printHelp({
          name: "slo-report",
          description: "Monthly SLA/SLO compliance report aggregator (T-040)",
          usage: "node bin/slo-report.js --client <name> --month <YYYY-MM> [options]",
          flags: [
            { flag: "--client <name>", description: "Client (required)" },
            { flag: "--month <YYYY-MM>", description: "Report month (required, e.g. 2026-02)" },
            {
              flag: "--format <fmt>",
              description: "Output: html (default), json, pdf (pdf requires playwright)",
            },
            {
              flag: "--out <path>",
              description: "Write output to file path (default: reports/<client>/slo-compliance/)",
            },
            { flag: "--help, -h", description: "Show this help and exit" },
          ],
          examples: [
            "node bin/slo-report.js --client myapp --month 2026-02",
            "node bin/slo-report.js --client myapp --month 2026-02 --format json --out reports/feb.json",
          ],
        });
        opts._helpRequested = true;
        return opts;
      case "--out":
        opts.out = argv[++i];
        break;
    }
  }
  return opts;
}

// ── Collect execution summaries for the month ─────────────────────────────────

function collectExecutionSummaries(fs, path, reportsDir, month) {
  const summaries = [];

  if (!fs.existsSync(reportsDir)) return summaries;

  const testDirs = fs.readdirSync(reportsDir).filter((d) => {
    const p = path.join(reportsDir, d);
    return fs.statSync(p).isDirectory() && d !== "audit" && d !== "slo-compliance";
  });

  for (const testDir of testDirs) {
    const testPath = path.join(reportsDir, testDir);
    const execDirs = fs.readdirSync(testPath).filter((d) => {
      return d.startsWith(month) && fs.statSync(path.join(testPath, d)).isDirectory();
    });

    for (const execDir of execDirs) {
      const summaryFile = path.join(testPath, execDir, "summary.json");
      if (fs.existsSync(summaryFile)) {
        try {
          summaries.push(JSON.parse(fs.readFileSync(summaryFile, "utf-8")));
        } catch {
          /* skip corrupted */
        }
      }
    }
  }

  return summaries;
}

// ── Evaluate compliance ───────────────────────────────────────────────────────

// CR-02: read from the canonical k6 native shape (metrics.<name>.values.<key>)
// with a fallback to the framework-enriched shape (values folded onto the
// metric object). Return null for both null and undefined so the call site's
// `actual == null` comparison skips cleanly in either case.
function extractMetric(summary, metricName) {
  const metrics = summary.metrics || summary.summary?.metrics || {};
  const dur = metrics.http_req_duration?.values ?? metrics.http_req_duration ?? {};
  const failed = metrics.http_req_failed?.values ?? metrics.http_req_failed ?? {};
  const map = {
    http_req_duration_p95: () => dur["p(95)"],
    http_req_duration_p99: () => dur["p(99)"],
    http_req_duration_avg: () => dur.avg,
    error_rate: () => failed.rate ?? failed.value,
  };
  const fn = map[metricName];
  const v = fn ? fn() : undefined;
  return v === undefined ? null : v;
}

function evaluateCompliance(sloConfig, summaries) {
  const serviceCompliance = [];

  for (const serviceDef of sloConfig.services) {
    const serviceSummaries = summaries.filter(
      (s) => s.testName === serviceDef.serviceName || s.tags?.service === serviceDef.serviceName
    );

    const metricCompliance = [];
    for (const metricDef of serviceDef.metrics) {
      let passing = 0;
      const violations = [];

      for (const s of serviceSummaries) {
        const actual = extractMetric(s, metricDef.name);
        // CR-02: use loose equality so undefined (key missing from k6 summary)
        // and null (extractMetric explicit miss) both skip cleanly. Strict
        // equality fell through to `undefined <= target` (always false) and
        // every check appeared violated.
        if (actual == null) continue;

        if (actual <= metricDef.target) {
          passing++;
        } else {
          violations.push({
            timestamp: s.startTime || s.endTime || "unknown",
            actualValue: actual,
            reportLink: s.reportLink || "",
          });
        }
      }

      const total = serviceSummaries.length;
      const pct = total > 0 ? Math.round((passing / total) * 10000) / 100 : 0;

      metricCompliance.push({
        metric: metricDef.name,
        target: metricDef.target,
        passingExecutions: passing,
        totalExecutions: total,
        compliancePercent: pct,
        violations,
      });
    }

    serviceCompliance.push({
      serviceName: serviceDef.serviceName,
      metrics: metricCompliance,
      trend: "estable",
    });
  }

  const overallTotal = serviceCompliance.reduce(
    (sum, s) => sum + s.metrics.reduce((ms, m) => ms + m.totalExecutions, 0),
    0
  );
  const overallPassing = serviceCompliance.reduce(
    (sum, s) => sum + s.metrics.reduce((ms, m) => ms + m.passingExecutions, 0),
    0
  );
  const overallPct =
    overallTotal > 0 ? Math.round((overallPassing / overallTotal) * 10000) / 100 : 0;

  return { serviceCompliance, overallTotal, overallPassing, overallPct };
}

// ── HTML generator ────────────────────────────────────────────────────────────

function generateHtmlReport(opts, summaries, serviceCompliance, overallPct, overallPassing, overallTotal) {
  const insufficientData = summaries.length < 5;
  const warningBanner = insufficientData
    ? `<div class="warning">Datos insuficientes: solo ${summaries.length} ejecuciones. Se recomiendan al menos 5 para analisis estadistico.</div>`
    : "";

  const serviceRows = serviceCompliance
    .map((s) => {
      return s.metrics
        .map((m) => {
          const statusIcon =
            m.compliancePercent >= 99 ? "🟢" : m.compliancePercent >= 95 ? "🟡" : "🔴";
          return `<tr>
        <td>${s.serviceName}</td>
        <td>${m.metric}</td>
        <td>${m.target}</td>
        <td>${m.compliancePercent}%</td>
        <td>${statusIcon}</td>
        <td>${m.violations.length}</td>
      </tr>`;
        })
        .join("\n");
    })
    .join("\n");

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>SLO Compliance — ${opts.client} — ${opts.month}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
  h1 { border-bottom: 2px solid #333; padding-bottom: 0.5rem; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
  th { background: #f5f5f5; }
  .warning { background: #fff3cd; border: 1px solid #ffc107; padding: 1rem; margin: 1rem 0; border-radius: 4px; }
  .summary { font-size: 1.2em; margin: 1rem 0; }
</style>
</head><body>
<h1>SLO Compliance Report</h1>
<p>Client: <strong>${opts.client}</strong> | Month: <strong>${opts.month}</strong></p>
<p>Generated: ${new Date().toISOString()}</p>
${warningBanner}
<div class="summary">Overall compliance: <strong>${overallPct}%</strong> (${overallPassing}/${overallTotal} checks passing)</div>
<table>
  <thead><tr><th>Servicio</th><th>Metrica</th><th>Objetivo</th><th>Cumplimiento</th><th>Estado</th><th>Violaciones</th></tr></thead>
  <tbody>${serviceRows}</tbody>
</table>
<p><em>${summaries.length} ejecuciones analizadas.</em></p>
</body></html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CR-03 (07-08): main(argv, deps) — DI seam + per-format early returns.
//
// `deps` defaults to the real `{ fs, path, console, exit, playwrightFactory }`.
// The Vitest regression suite passes a fake deps object so the PDF code path
// can be exercised end-to-end without launching real chromium and without
// landing files on disk. See test/bin/slo-report.test.ts (CR-03 describe block).
// ─────────────────────────────────────────────────────────────────────────────

async function main(argv = process.argv.slice(2), deps = {}) {
  // Default deps fallbacks (kept lazy: production CLI uses real modules,
  // tests inject fakes).
  if (!deps.fs) deps.fs = require("fs");
  if (!deps.path) deps.path = require("path");
  if (!deps.console) deps.console = console;
  if (!deps.exit) deps.exit = (code) => process.exit(code);
  if (!deps.playwrightFactory) {
    deps.playwrightFactory = () => {
      try {
        return require("playwright");
      } catch {
        return null;
      }
    };
  }

  const { fs, path, console: log } = deps;

  // ── Parse args ──
  const opts = parseArgs(argv, deps.exit);
  if (opts._helpRequested) {
    return deps.exit(0);
  }

  if (!opts.client || !opts.month) {
    log.error("Error: --client and --month are required.");
    return deps.exit(1);
  }

  if (!/^\d{4}-\d{2}$/.test(opts.month)) {
    log.error("Error: --month must be in YYYY-MM format.");
    return deps.exit(1);
  }

  // ── Resolve paths ──
  const ROOT_DIR = path.resolve(__dirname, "..");
  const clientDir = path.join(ROOT_DIR, "clients", opts.client);
  const reportsDir = path.join(ROOT_DIR, "reports", opts.client);
  const sloConfigPath = path.join(clientDir, "config", "slos.json");
  const outputDir = path.join(reportsDir, "slo-compliance");

  if (!fs.existsSync(clientDir)) {
    log.error(`Client '${opts.client}' not found.`);
    return deps.exit(1);
  }

  if (!fs.existsSync(sloConfigPath)) {
    log.error(`No SLO config found for client '${opts.client}' (expected config/slos.json).`);
    return deps.exit(1);
  }

  // ── Load SLO definitions ──
  const sloConfig = JSON.parse(fs.readFileSync(sloConfigPath, "utf-8"));

  // ── Collect summaries ──
  const summaries = collectExecutionSummaries(fs, path, reportsDir, opts.month);

  if (summaries.length === 0) {
    log.log(`No execution data found for ${opts.client} in ${opts.month}.`);
    log.log(
      "SLO report requires execution summaries in reports/{client}/{test}/{date}/summary.json"
    );
    return deps.exit(0);
  }

  // ── Evaluate ──
  const { serviceCompliance, overallTotal, overallPassing, overallPct } = evaluateCompliance(
    sloConfig,
    summaries
  );

  const report = {
    client: opts.client,
    month: opts.month,
    generatedAt: new Date().toISOString(),
    services: serviceCompliance,
    overallCompliancePercent: overallPct,
  };

  // ── Ensure output dir ──
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // ── PDF format: early-return after PDF + JSON sidecar ──
  if (opts.format === "pdf") {
    const playwright = deps.playwrightFactory();
    if (!playwright) {
      log.error(
        "PDF export requires playwright. Install it with:\n  npm install playwright\n" +
          "Falling back to HTML output."
      );
      opts.format = "html";
      // fall through to html branch below (intentional fallback)
    } else {
      const htmlPath = path.join(outputDir, `slo-${opts.month}.html`);
      const pdfPath = opts.out || path.join(outputDir, `slo-${opts.month}.pdf`);
      const jsonPath = path.join(outputDir, `slo-${opts.month}.json`);
      const htmlContent = generateHtmlReport(
        opts,
        summaries,
        serviceCompliance,
        overallPct,
        overallPassing,
        overallTotal
      );
      // Intermediate HTML for playwright to render.
      fs.writeFileSync(htmlPath, htmlContent);

      try {
        const browser = await playwright.chromium.launch();
        const page = await browser.newPage();
        await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle" });
        await page.pdf({ path: pdfPath, format: "A4", printBackground: true });
        await browser.close();
        log.log(`SLO compliance report (PDF): ${pdfPath}`);
      } catch (err) {
        log.error(`PDF generation failed: ${err.message}`);
        return deps.exit(1);
      }

      // Canonical JSON sidecar — written exactly ONCE for the pdf branch.
      fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
      log.log(`SLO compliance data (JSON): ${jsonPath}`);
      log.log(`\nOverall compliance: ${overallPct}%`);
      return deps.exit(0);
    }
  }

  // ── JSON format: early-return; the primary output IS the canonical sidecar ──
  if (opts.format === "json") {
    const outPath = opts.out || path.join(outputDir, `slo-${opts.month}.json`);
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    log.log(`SLO compliance report (JSON): ${outPath}`);
    log.log(`\nOverall compliance: ${overallPct}%`);
    return deps.exit(0);
  }

  // ── HTML format (default and pdf-fallback): HTML primary + JSON sidecar ──
  {
    const html = generateHtmlReport(
      opts,
      summaries,
      serviceCompliance,
      overallPct,
      overallPassing,
      overallTotal
    );
    const outPath = opts.out || path.join(outputDir, `slo-${opts.month}.html`);
    fs.writeFileSync(outPath, html);
    log.log(`SLO compliance report (HTML): ${outPath}`);

    const jsonPath = path.join(outputDir, `slo-${opts.month}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    log.log(`SLO compliance data (JSON): ${jsonPath}`);
    log.log(`\nOverall compliance: ${overallPct}%`);
    return deps.exit(0);
  }
}

// ── CLI bootstrap ─────────────────────────────────────────────────────────────

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main };
