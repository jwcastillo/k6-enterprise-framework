// T-092: Reporte de planificacion de capacidad (HTML standalone)
//
// Generates a standalone capacity-report-{timestamp}.html file with:
//   - Executive summary section (non-technical language)
//   - Key indicators table
//   - Load curve charts (latency vs load, error rate vs load)
//   - Growth projection chart with confidence bands
//   - Recommendations table
//
// Offline-capable (no CDN — Chart.js rendered via Canvas API inline).

import { CapacityAnalysis, CapacityProjection, LoadDataPoint } from "./capacity-analyzer";
import * as fs from "fs";
import * as path from "path";

export interface CapacityReportOptions {
  clientName: string;
  serviceName?: string;
  generatedAt?: Date;
  outputDir: string;
}

// ── HTML template ─────────────────────────────────────────────────────────────

export function generateCapacityReportHtml(
  analysis: CapacityAnalysis,
  projection: CapacityProjection,
  dataPoints: LoadDataPoint[],
  options: CapacityReportOptions
): string {
  const now = options.generatedAt ?? new Date();
  const ts = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const service = options.serviceName ?? options.clientName;

  const sortedPts = [...dataPoints].sort((a, b) => a.rps - b.rps);
  const rpsLabels = JSON.stringify(sortedPts.map((p) => `${p.rps.toFixed(0)} rps`));
  const p95Data = JSON.stringify(sortedPts.map((p) => p.p95Ms));
  const errorData = JSON.stringify(sortedPts.map((p) => p.errorRatePct));

  const _maxRps = analysis.breakingPoint?.rps ?? sortedPts[sortedPts.length - 1]?.rps ?? 100;
  const sustainableRps = analysis.maxSustainableLoad?.rps ?? 0;
  const inflectionRps = analysis.inflectionPoint?.rps ?? null;
  const breakingRps = analysis.breakingPoint?.rps ?? null;

  // Growth projection data (12-month forward chart)
  const months = Array.from({ length: 13 }, (_, i) => i);
  const projRps = months.map((m) => {
    return projection.currentRps * Math.pow(1 + projection.growthRatePerMonth, m);
  });
  const projLabels = JSON.stringify(
    months.map((m) => {
      const d = new Date(now);
      d.setMonth(d.getMonth() + m);
      return d.toLocaleDateString("en", { month: "short", year: "2-digit" });
    })
  );
  const projData = JSON.stringify(projRps.map((v) => parseFloat(v.toFixed(1))));
  const inflectionLine =
    inflectionRps !== null ? JSON.stringify(months.map(() => inflectionRps)) : "null";
  const breakingLine =
    breakingRps !== null ? JSON.stringify(months.map(() => breakingRps)) : "null";

  // Executive summary
  const headroom = analysis.currentHeadroomPct;
  const monthsToBreak = projection.breakingPointReachedAt
    ? Math.max(
        0,
        Math.ceil(
          (projection.breakingPointReachedAt.getTime() - now.getTime()) / (30 * 24 * 3600 * 1000)
        )
      )
    : null;

  const execSummary = buildExecSummary(analysis, projection, service, monthsToBreak);

  // Status colors
  const headroomColor =
    headroom === null
      ? "#6b7280"
      : headroom >= 40
        ? "#16a34a"
        : headroom >= 20
          ? "#d97706"
          : "#dc2626";
  const confidenceColor =
    projection.confidenceLevel === "high"
      ? "#16a34a"
      : projection.confidenceLevel === "medium"
        ? "#d97706"
        : "#dc2626";

  const warningRows = [...analysis.warnings, ...projection.warnings]
    .map((w) => `<tr><td>⚠️</td><td>${escHtml(w)}</td></tr>`)
    .join("\n");

  const recommendationRows = projection.recommendations
    .map((r) => `<tr><td>${escHtml(r)}</td></tr>`)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Capacity Planning Report — ${escHtml(service)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; color: #1e293b; }
  .container { max-width: 1100px; margin: 0 auto; padding: 2rem 1.5rem; }
  h1 { font-size: 1.8rem; font-weight: 700; margin-bottom: .25rem; }
  h2 { font-size: 1.25rem; font-weight: 600; margin: 2rem 0 1rem; border-bottom: 2px solid #e2e8f0; padding-bottom: .5rem; }
  h3 { font-size: 1rem; font-weight: 600; margin-bottom: .75rem; color: #374151; }
  .subtitle { color: #64748b; font-size: .9rem; margin-bottom: 2rem; }
  .badge { display: inline-block; padding: .15rem .6rem; border-radius: 12px; font-size: .75rem; font-weight: 600; color: #fff; }

  /* KPI cards */
  .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .kpi-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1.25rem; }
  .kpi-card .kpi-label { font-size: .8rem; color: #64748b; text-transform: uppercase; letter-spacing: .05em; }
  .kpi-card .kpi-value { font-size: 1.6rem; font-weight: 700; margin: .3rem 0; }
  .kpi-card .kpi-unit { font-size: .8rem; color: #94a3b8; }

  /* Executive summary box */
  .exec-summary { background: #fff; border: 1px solid #e2e8f0; border-left: 4px solid #2563eb; border-radius: 0 8px 8px 0; padding: 1.25rem 1.5rem; margin-bottom: 2rem; }
  .exec-summary h2 { border: none; margin: 0 0 .75rem; font-size: 1rem; text-transform: uppercase; letter-spacing: .08em; color: #2563eb; }
  .exec-summary p { color: #374151; line-height: 1.6; }

  /* Charts */
  .chart-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 2rem; }
  @media (max-width: 700px) { .chart-grid { grid-template-columns: 1fr; } }
  .chart-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem; }
  .chart-full { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem; }
  canvas { width: 100% !important; }

  /* Tables */
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0; margin-bottom: 1.5rem; }
  th { background: #f1f5f9; padding: .6rem 1rem; font-size: .8rem; text-align: left; text-transform: uppercase; letter-spacing: .05em; color: #64748b; }
  td { padding: .65rem 1rem; border-top: 1px solid #f1f5f9; font-size: .9rem; }
  tr:last-child td { border-bottom: none; }

  /* Footer */
  .report-footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #e2e8f0; font-size: .75rem; color: #94a3b8; }
</style>
</head>
<body>
<div class="container">
  <h1>Capacity Planning Report</h1>
  <p class="subtitle">Service: <strong>${escHtml(service)}</strong> &nbsp;·&nbsp; Generated: ${now.toLocaleString()} &nbsp;·&nbsp; <span class="badge" style="background:${confidenceColor}">Confidence: ${projection.confidenceLevel}</span></p>

  <!-- Executive Summary -->
  <div class="exec-summary">
    <h2>Executive Summary</h2>
    <p>${escHtml(execSummary)}</p>
  </div>

  <!-- KPI Cards -->
  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-label">Max Sustainable</div>
      <div class="kpi-value">${analysis.maxSustainableLoad?.rps.toFixed(0) ?? "—"}</div>
      <div class="kpi-unit">req/s (p95 &lt; threshold, error &lt; 1%)</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Inflection Point</div>
      <div class="kpi-value">${inflectionRps !== null ? inflectionRps.toFixed(0) : "—"}</div>
      <div class="kpi-unit">req/s (latency slope change &gt;50%)</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Breaking Point</div>
      <div class="kpi-value">${breakingRps !== null ? breakingRps.toFixed(0) : "—"}</div>
      <div class="kpi-unit">req/s (error &gt;5% or latency &gt;3× baseline)</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Headroom</div>
      <div class="kpi-value" style="color:${headroomColor}">${headroom !== null ? headroom + "%" : "—"}</div>
      <div class="kpi-unit">available capacity above current load</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Time to Breaking Point</div>
      <div class="kpi-value">${monthsToBreak !== null ? monthsToBreak : "—"}</div>
      <div class="kpi-unit">months (at ${(projection.growthRatePerMonth * 100).toFixed(0)}%/mo growth)</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Baseline Latency</div>
      <div class="kpi-value">${analysis.baselineLatencyMs}</div>
      <div class="kpi-unit">ms p95 at lowest load</div>
    </div>
  </div>

  <!-- Load Curve Charts -->
  <h2>Load Curve Analysis</h2>
  <div class="chart-grid">
    <div class="chart-card">
      <h3>p95 Latency vs Load</h3>
      <canvas id="chart-latency" height="220"></canvas>
    </div>
    <div class="chart-card">
      <h3>Error Rate vs Load</h3>
      <canvas id="chart-errors" height="220"></canvas>
    </div>
  </div>

  <!-- Growth Projection Chart -->
  <h2>Growth Projection (12 months)</h2>
  <div class="chart-full">
    <h3>Projected Load vs Capacity Limits</h3>
    <canvas id="chart-projection" height="160"></canvas>
  </div>

  <!-- Warnings -->
  ${
    warningRows
      ? `<h2>Warnings</h2>
  <table><thead><tr><th></th><th>Message</th></tr></thead><tbody>${warningRows}</tbody></table>`
      : ""
  }

  <!-- Recommendations -->
  ${
    recommendationRows
      ? `<h2>Recommendations</h2>
  <table><thead><tr><th>Action</th></tr></thead><tbody>${recommendationRows}</tbody></table>`
      : ""
  }

  <div class="report-footer">
    Generated by k6 Enterprise Framework Capacity Analyzer &nbsp;·&nbsp;
    Data points: ${analysis.dataPointCount} &nbsp;·&nbsp;
    Report timestamp: ${ts}
  </div>
</div>

<script>
(function() {
  function drawChart(id, labels, datasets, yLabel, annotations) {
    var canvas = document.getElementById(id);
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var W = canvas.parentElement.clientWidth - 32 || 500;
    var H = parseInt(canvas.getAttribute('height')) || 220;
    canvas.width = W; canvas.height = H;
    var pad = { top: 20, right: 20, bottom: 42, left: 60 };
    var cW = W - pad.left - pad.right;
    var cH = H - pad.top - pad.bottom;

    var allVals = datasets.flatMap(function(d) { return d.data; }).filter(function(v) { return v !== null && !isNaN(v); });
    if (annotations) allVals = allVals.concat(annotations.map(function(a) { return a.value; }));
    var yMin = Math.max(0, Math.min.apply(null, allVals) * 0.9);
    var yMax = Math.max.apply(null, allVals) * 1.15;
    if (yMin === yMax) { yMax = yMin + 1; }

    var n = labels.length;
    function toX(i) { return pad.left + (i / Math.max(n - 1, 1)) * cW; }
    function toY(v) { return pad.top + cH - ((v - yMin) / (yMax - yMin)) * cH; }

    // Background
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = '#f1f5f9'; ctx.lineWidth = 1;
    [0,.25,.5,.75,1].forEach(function(t) {
      var y = pad.top + t * cH;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cW, y); ctx.stroke();
      var v = yMax - t * (yMax - yMin);
      ctx.fillStyle = '#94a3b8'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
      ctx.fillText(v > 100 ? v.toFixed(0) : v.toFixed(1), pad.left - 5, y + 3);
    });

    // Annotation lines (inflection/breaking points)
    if (annotations) annotations.forEach(function(ann) {
      var x = toX(ann.xIdx !== undefined ? ann.xIdx : 0);
      if (ann.xIdx === undefined) {
        // horizontal line
        var y = toY(ann.value);
        ctx.strokeStyle = ann.color || '#dc2626'; ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 3]);
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cW, y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = ann.color || '#dc2626'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText(ann.label || '', pad.left + 3, y - 3);
      } else {
        // vertical line
        ctx.strokeStyle = ann.color || '#d97706'; ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 3]);
        ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + cH); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = ann.color || '#d97706'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(ann.label || '', x, pad.top + 12);
      }
    });

    // X axis labels
    ctx.fillStyle = '#64748b'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
    var step = Math.ceil(n / 8);
    for (var i = 0; i < n; i += step) {
      ctx.fillText(labels[i], toX(i), pad.top + cH + 16);
    }
    // Y axis label
    ctx.save(); ctx.translate(14, pad.top + cH / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#64748b'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(yLabel, 0, 0); ctx.restore();

    // Datasets
    datasets.forEach(function(ds) {
      ctx.strokeStyle = ds.color || '#2563eb'; ctx.lineWidth = ds.dashed ? 1 : 2.5;
      ctx.setLineDash(ds.dashed ? [5, 5] : []);
      ctx.beginPath();
      var started = false;
      ds.data.forEach(function(v, i) {
        if (v === null || isNaN(v)) { started = false; return; }
        var x = toX(i); var y = toY(v);
        if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
      });
      ctx.stroke(); ctx.setLineDash([]);
      if (!ds.dashed) {
        ds.data.forEach(function(v, i) {
          if (v === null || isNaN(v)) return;
          ctx.beginPath(); ctx.arc(toX(i), toY(v), 4, 0, 2 * Math.PI);
          ctx.fillStyle = ds.color || '#2563eb'; ctx.fill();
        });
      }
    });

    // Axes
    ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top); ctx.lineTo(pad.left, pad.top + cH);
    ctx.lineTo(pad.left + cW, pad.top + cH); ctx.stroke();
  }

  var rpsLabels = ${rpsLabels};
  var p95Data = ${p95Data};
  var errorData = ${errorData};
  var projLabels = ${projLabels};
  var projData = ${projData};
  var inflectionRps = ${inflectionRps !== null ? inflectionRps : "null"};
  var breakingRps = ${breakingRps !== null ? breakingRps : "null"};
  var sustainableRps = ${sustainableRps};
  var inflectionLine = ${inflectionLine};
  var breakingLine = ${breakingLine};

  // Find index of inflection/breaking points in sorted data
  var inflIdx = inflectionRps !== null ? rpsLabels.findIndex(function(l) { return parseFloat(l) >= inflectionRps; }) : -1;
  var breakIdx = breakingRps !== null ? rpsLabels.findIndex(function(l) { return parseFloat(l) >= breakingRps; }) : -1;

  var latAnnotations = [];
  if (inflIdx >= 0) latAnnotations.push({ xIdx: inflIdx, color: '#d97706', label: 'Inflection' });
  if (breakIdx >= 0) latAnnotations.push({ xIdx: breakIdx, color: '#dc2626', label: 'Breaking' });

  drawChart('chart-latency', rpsLabels, [
    { data: p95Data, color: '#2563eb', label: 'p95 ms' }
  ], 'ms', latAnnotations);

  drawChart('chart-errors', rpsLabels, [
    { data: errorData, color: '#dc2626', label: 'error %' }
  ], '%', [{ value: 5, color: '#dc2626', label: 'limit 5%' }, { value: 1, color: '#d97706', label: 'warn 1%' }]);

  var projAnnotations = [];
  if (inflectionLine) projAnnotations.push({ value: inflectionRps, color: '#d97706', label: 'Inflection' });
  if (breakingLine) projAnnotations.push({ value: breakingRps, color: '#dc2626', label: 'Breaking' });

  drawChart('chart-projection', projLabels, [
    { data: projData, color: '#2563eb', label: 'projected rps' }
  ], 'rps', projAnnotations);
})();
</script>
</body>
</html>`;
}

function buildExecSummary(
  analysis: CapacityAnalysis,
  projection: CapacityProjection,
  service: string,
  monthsToBreak: number | null
): string {
  const maxRps = analysis.maxSustainableLoad?.rps.toFixed(0) ?? "unknown";
  const breakRps = analysis.breakingPoint?.rps.toFixed(0) ?? "unknown";
  const headroom = analysis.currentHeadroomPct;

  let summary =
    `The service "${service}" can sustain up to ${maxRps} requests/second ` +
    `while keeping response times within acceptable limits and error rates below 1%. `;

  if (analysis.breakingPoint) {
    summary += `The service begins to fail at ${breakRps} requests/second (error rate exceeds 5% or latency exceeds 3× baseline). `;
  }

  if (headroom !== null) {
    if (headroom >= 40) {
      summary += `Current capacity headroom is healthy at ${headroom}%. `;
    } else if (headroom >= 20) {
      summary += `Current capacity headroom is moderate at ${headroom}% — plan for scaling within 6 months. `;
    } else {
      summary += `⚠️ Current capacity headroom is critically low at ${headroom}% — immediate scaling action is recommended. `;
    }
  }

  if (monthsToBreak !== null) {
    if (monthsToBreak <= 3) {
      summary += `At the current growth rate of ${(projection.growthRatePerMonth * 100).toFixed(0)}%/month, the breaking point will be reached in approximately ${monthsToBreak} months — urgent action required.`;
    } else if (monthsToBreak <= 12) {
      summary += `At the current growth rate of ${(projection.growthRatePerMonth * 100).toFixed(0)}%/month, the breaking point will be reached in approximately ${monthsToBreak} months.`;
    } else {
      summary += `At the current growth rate, the service has sufficient capacity for more than a year.`;
    }
  } else if (!analysis.breakingPoint) {
    summary += `No breaking point was detected within the tested load range — further load testing at higher levels is recommended.`;
  }

  return summary;
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── File writer ───────────────────────────────────────────────────────────────

/**
 * Write a capacity report HTML file and return the output path.
 * Output: {outputDir}/capacity-report-{timestamp}.html
 */
export function writeCapacityReport(
  analysis: CapacityAnalysis,
  projection: CapacityProjection,
  dataPoints: LoadDataPoint[],
  options: CapacityReportOptions
): string {
  const now = options.generatedAt ?? new Date();
  const ts = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);

  fs.mkdirSync(options.outputDir, { recursive: true });
  const outputPath = path.join(options.outputDir, `capacity-report-${ts}.html`);

  const html = generateCapacityReportHtml(analysis, projection, dataPoints, options);
  fs.writeFileSync(outputPath, html, "utf-8");
  console.log(`[CapacityReport] Report saved: ${outputPath}`);
  return outputPath;
}
