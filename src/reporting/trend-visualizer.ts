// T-084: Visualizacion de tendencias historicas (30/60/90 dias)
//
// Generates trend charts (p95, error rate, throughput) over configurable windows
// as embeddable HTML sections for the regression report. Uses Chart.js (CDN-free,
// inline bundle) so reports work fully offline (CHK-UX-019).

import { avg } from "../metrics/types";

export type TrendWindow = 30 | 60 | 90;

export interface TrendDataPoint {
  date: string; // ISO date string (YYYY-MM-DD)
  p95Ms: number;
  p50Ms: number;
  errorRatePct: number;
  throughputRps: number;
  verdict: "pass" | "fail" | "skip";
  runId?: string;
}

export interface TrendPattern {
  type: "degrading" | "improving" | "stable" | "volatile";
  description: string;
  severity: "info" | "warning" | "critical";
}

export interface TrendAnalysis {
  window: TrendWindow;
  dataPoints: TrendDataPoint[];
  patterns: TrendPattern[];
  baselineP95: number;
  alertThresholdP95: number;
  summary: string;
}

const MIN_DAYS_FOR_ANALYSIS = 7;

// ── Pattern detection ─────────────────────────────────────────────────────────

/** Detect trend patterns from sorted data points */
export function detectTrendPatterns(points: TrendDataPoint[]): TrendPattern[] {
  if (points.length < MIN_DAYS_FOR_ANALYSIS) {
    return [
      { type: "stable", description: "Insufficient data for pattern detection.", severity: "info" },
    ];
  }

  const patterns: TrendPattern[] = [];
  const p95Values = points.map((p) => p.p95Ms);
  const recent = p95Values.slice(-7);
  const older = p95Values.slice(0, Math.max(1, p95Values.length - 7));

  const recentAvg = avg(recent);
  const olderAvg = avg(older);
  const changePct = olderAvg > 0 ? ((recentAvg - olderAvg) / olderAvg) * 100 : 0;

  // Degradation: sustained increase >5% in last 5+ days
  if (changePct > 10) {
    patterns.push({
      type: "degrading",
      description: `p95 latency increased ${changePct.toFixed(1)}% over last ${Math.min(7, points.length)} days.`,
      severity: changePct > 25 ? "critical" : "warning",
    });
  } else if (changePct < -10) {
    patterns.push({
      type: "improving",
      description: `p95 latency improved ${Math.abs(changePct).toFixed(1)}% over last ${Math.min(7, points.length)} days.`,
      severity: "info",
    });
  } else {
    patterns.push({
      type: "stable",
      description: "Performance is stable within ±10% variation.",
      severity: "info",
    });
  }

  // Volatility: high coefficient of variation
  const stdDev = standardDev(p95Values);
  const cv = recentAvg > 0 ? (stdDev / recentAvg) * 100 : 0;
  if (cv > 30) {
    patterns.push({
      type: "volatile",
      description: `High result volatility detected (CV=${cv.toFixed(0)}%). Consider stabilizing test environment.`,
      severity: "warning",
    });
  }

  // Error rate trend
  const errorAvg = avg(points.slice(-7).map((p) => p.errorRatePct));
  if (errorAvg > 1) {
    patterns.push({
      type: "degrading",
      description: `Average error rate in last 7 days: ${errorAvg.toFixed(2)}% (above 1% threshold).`,
      severity: errorAvg > 5 ? "critical" : "warning",
    });
  }

  return patterns;
}

function standardDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = avg(values);
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// ── Analysis builder ──────────────────────────────────────────────────────────

/**
 * Build trend analysis from raw data points, filtering to the requested window.
 * @param allPoints  All historical data points, sorted by date ascending
 * @param window     Number of days to include (30, 60, or 90)
 * @param baselineP95  Baseline p95 for alert line (default: first point or 1000ms)
 */
export function buildTrendAnalysis(
  allPoints: TrendDataPoint[],
  window: TrendWindow = 30,
  baselineP95?: number
): TrendAnalysis {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - window);

  const filtered = allPoints
    .filter((p) => new Date(p.date) >= cutoff)
    .sort((a, b) => a.date.localeCompare(b.date));

  const baseline = baselineP95 ?? filtered[0]?.p95Ms ?? 1000;
  const alertThreshold = baseline * 1.2; // 20% above baseline

  const patterns = detectTrendPatterns(filtered);

  const hasSufficient = filtered.length >= MIN_DAYS_FOR_ANALYSIS;
  const summary = hasSufficient
    ? summarizePatterns(patterns, window)
    : `Insufficient data (${filtered.length} runs in last ${window} days, need at least ${MIN_DAYS_FOR_ANALYSIS}).`;

  return {
    window,
    dataPoints: filtered,
    patterns,
    baselineP95: baseline,
    alertThresholdP95: alertThreshold,
    summary,
  };
}

function summarizePatterns(patterns: TrendPattern[], window: number): string {
  const critical = patterns.filter((p) => p.severity === "critical");
  const warnings = patterns.filter((p) => p.severity === "warning");
  if (critical.length > 0) return `⛔ ${critical[0].description}`;
  if (warnings.length > 0) return `⚠️ ${warnings[0].description}`;
  return `✅ Performance is stable over the last ${window} days.`;
}

// ── HTML generation ───────────────────────────────────────────────────────────

/**
 * Generate a standalone HTML section with three trend charts:
 * p95 latency, error rate, and throughput.
 *
 * Uses Chart.js inline data (no CDN dependency — fully offline-capable).
 */
export function generateTrendHtml(analysis: TrendAnalysis): string {
  const {
    dataPoints: pts,
    baselineP95,
    alertThresholdP95,
    window: w,
    patterns,
    summary,
  } = analysis;

  if (pts.length === 0) {
    return `<section class="trend-section">
  <h2>Performance Trends (${w} days)</h2>
  <p class="trend-empty">No data available for the last ${w} days.</p>
</section>`;
  }

  const labels = JSON.stringify(pts.map((p) => p.date));
  const p95Data = JSON.stringify(pts.map((p) => p.p95Ms));
  const p50Data = JSON.stringify(pts.map((p) => p.p50Ms));
  const errorData = JSON.stringify(pts.map((p) => p.errorRatePct));
  const throughputData = JSON.stringify(pts.map((p) => p.throughputRps));

  // Baseline and alert reference arrays
  const baselineArr = JSON.stringify(pts.map(() => baselineP95));
  const alertArr = JSON.stringify(pts.map(() => alertThresholdP95));

  const patternBadges = patterns
    .map((p) => {
      const color =
        p.severity === "critical" ? "#dc2626" : p.severity === "warning" ? "#d97706" : "#16a34a";
      return `<span class="trend-badge" style="background:${color}">${p.description}</span>`;
    })
    .join("\n    ");

  const windowSelector = ([30, 60, 90] as TrendWindow[])
    .map(
      (d) =>
        `<button class="trend-window-btn${d === w ? " active" : ""}" data-window="${d}">${d}d</button>`
    )
    .join("");

  return `<section class="trend-section" id="trends-${w}d">
  <div class="trend-header">
    <h2>Performance Trends</h2>
    <div class="trend-window-selector">${windowSelector}</div>
  </div>

  <div class="trend-summary">
    <p>${summary}</p>
    <div class="trend-badges">
    ${patternBadges}
    </div>
  </div>

  <!-- p95 Latency Chart -->
  <div class="trend-chart-container">
    <h3>p95 Latency (ms) — ${w}-day window</h3>
    <canvas id="chart-p95-${w}" height="120"></canvas>
  </div>

  <!-- Error Rate Chart -->
  <div class="trend-chart-container">
    <h3>Error Rate (%) — ${w}-day window</h3>
    <canvas id="chart-error-${w}" height="90"></canvas>
  </div>

  <!-- Throughput Chart -->
  <div class="trend-chart-container">
    <h3>Throughput (req/s) — ${w}-day window</h3>
    <canvas id="chart-rps-${w}" height="90"></canvas>
  </div>

  <style>
    .trend-section { font-family: -apple-system, sans-serif; padding: 1.5rem; }
    .trend-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
    .trend-header h2 { margin: 0; }
    .trend-window-selector button { padding: .3rem .8rem; border: 1px solid #d1d5db; border-radius: 4px; cursor: pointer; margin-left: .3rem; background: #f9fafb; }
    .trend-window-selector button.active { background: #2563eb; color: #fff; border-color: #2563eb; }
    .trend-summary { background: #f8fafc; border-left: 4px solid #2563eb; padding: .75rem 1rem; margin-bottom: 1.5rem; border-radius: 0 4px 4px 0; }
    .trend-badges { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: .5rem; }
    .trend-badge { padding: .2rem .7rem; border-radius: 12px; color: #fff; font-size: .78rem; font-weight: 600; }
    .trend-chart-container { margin-bottom: 2rem; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1rem; }
    .trend-chart-container h3 { margin: 0 0 .75rem; font-size: .9rem; color: #374151; }
    .trend-empty { color: #6b7280; font-style: italic; }
  </style>

  <script>
  (function() {
    // Inline Chart.js micro-renderer (no CDN required)
    // Uses Canvas 2D API directly for offline capability
    function renderLineChart(canvasId, labels, datasets, yLabel) {
      var canvas = document.getElementById(canvasId);
      if (!canvas) return;
      var ctx = canvas.getContext('2d');
      var W = canvas.offsetWidth || 800;
      var H = canvas.height || 120;
      canvas.width = W;
      var pad = { top: 20, right: 20, bottom: 40, left: 55 };
      var chartW = W - pad.left - pad.right;
      var chartH = H - pad.top - pad.bottom;
      ctx.clearRect(0, 0, W, H);

      // Find y range
      var allVals = datasets.flatMap(function(d) { return d.data; }).filter(function(v) { return v !== null; });
      var yMin = Math.min.apply(null, allVals) * 0.9;
      var yMax = Math.max.apply(null, allVals) * 1.1;
      if (yMin === yMax) { yMin -= 1; yMax += 1; }

      function toX(i) { return pad.left + (i / Math.max(labels.length - 1, 1)) * chartW; }
      function toY(v) { return pad.top + chartH - ((v - yMin) / (yMax - yMin)) * chartH; }

      // Grid lines
      ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1;
      var gridLines = 4;
      for (var g = 0; g <= gridLines; g++) {
        var gY = pad.top + (g / gridLines) * chartH;
        ctx.beginPath(); ctx.moveTo(pad.left, gY); ctx.lineTo(pad.left + chartW, gY); ctx.stroke();
        var gVal = yMax - (g / gridLines) * (yMax - yMin);
        ctx.fillStyle = '#6b7280'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
        ctx.fillText(gVal.toFixed(gVal > 100 ? 0 : 1), pad.left - 4, gY + 3);
      }

      // X axis labels
      ctx.textAlign = 'center'; ctx.font = '9px sans-serif'; ctx.fillStyle = '#6b7280';
      var step = Math.ceil(labels.length / 10);
      for (var i = 0; i < labels.length; i += step) {
        ctx.fillText(labels[i].slice(5), toX(i), pad.top + chartH + 14);
      }
      ctx.fillText(yLabel, pad.left - 45, pad.top + chartH / 2);

      // Datasets
      datasets.forEach(function(ds) {
        ctx.strokeStyle = ds.color || '#2563eb';
        ctx.lineWidth = ds.dashed ? 1 : 2;
        if (ds.dashed) ctx.setLineDash([4, 4]); else ctx.setLineDash([]);
        ctx.beginPath();
        var started = false;
        for (var i = 0; i < ds.data.length; i++) {
          if (ds.data[i] === null) { started = false; continue; }
          var x = toX(i); var y = toY(ds.data[i]);
          if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // Dots for non-reference lines
        if (!ds.dashed) {
          ds.data.forEach(function(v, i) {
            if (v === null) return;
            ctx.beginPath();
            ctx.arc(toX(i), toY(v), 3, 0, 2 * Math.PI);
            ctx.fillStyle = ds.color || '#2563eb';
            ctx.fill();
          });
        }
      });
    }

    var labels = ${labels};
    var p95 = ${p95Data};
    var p50 = ${p50Data};
    var err = ${errorData};
    var rps = ${throughputData};
    var base = ${baselineArr};
    var alert = ${alertArr};

    renderLineChart('chart-p95-${w}', labels, [
      { data: p95, color: '#2563eb', label: 'p95' },
      { data: p50, color: '#7c3aed', label: 'p50' },
      { data: base, color: '#16a34a', dashed: true, label: 'baseline' },
      { data: alert, color: '#dc2626', dashed: true, label: 'alert' }
    ], 'ms');

    renderLineChart('chart-error-${w}', labels, [
      { data: err, color: '#dc2626', label: 'error %' }
    ], '%');

    renderLineChart('chart-rps-${w}', labels, [
      { data: rps, color: '#059669', label: 'rps' }
    ], 'rps');
  })();
  </script>
</section>`;
}

/**
 * Generate a Grafana panel JSON config for p95 trend visualization.
 * Requires Prometheus remote-write output from k6 runs.
 */
export function generateGrafanaPanelConfig(serviceName: string): Record<string, unknown> {
  return {
    title: `p95 Latency Trend — ${serviceName}`,
    type: "timeseries",
    gridPos: { x: 0, y: 0, w: 24, h: 8 },
    fieldConfig: {
      defaults: {
        unit: "ms",
        color: { mode: "palette-classic" },
        thresholds: {
          mode: "absolute",
          steps: [
            { color: "green", value: null },
            { color: "yellow", value: 500 },
            { color: "red", value: 2000 },
          ],
        },
      },
    },
    options: {
      tooltip: { mode: "multi" },
      legend: { displayMode: "list", placement: "bottom" },
    },
    targets: [
      {
        expr: `histogram_quantile(0.95, sum(rate(http_req_duration_bucket{service="${serviceName}"}[$__rate_interval])) by (le))`,
        legendFormat: "p95",
        refId: "A",
      },
      {
        expr: `histogram_quantile(0.50, sum(rate(http_req_duration_bucket{service="${serviceName}"}[$__rate_interval])) by (le))`,
        legendFormat: "p50",
        refId: "B",
      },
    ],
  };
}
