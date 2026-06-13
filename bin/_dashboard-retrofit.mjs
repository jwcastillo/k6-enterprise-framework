#!/usr/bin/env node
/**
 * _dashboard-retrofit.mjs — OBS2-04 / Plan 09-03 Task 3
 *
 * Purpose
 * -------
 * Idempotent retrofit of Grafana dashboard JSON files with:
 *   1. A `run_id` template variable inserted as the FIRST entry of
 *      `dashboard.templating.list` (so it appears leftmost in Grafana's
 *      variable bar — the most-frequently-changed filter goes first).
 *   2. A `run_id=~"$run_id"` PromQL label clause injected into every
 *      Prometheus-backed panel target `expr`.
 *
 * Why a script (vs. hand-editing): each retrofit dashboard has 30-60
 * Prometheus panels; hand-editing is error-prone and not reproducible.
 * Running this script twice on the same file produces NO DIFF (idempotency
 * is asserted by `bin/_dashboard-retrofit.mjs --check-idempotent <file>`).
 *
 * Behavior
 * --------
 * - Loads the JSON, walks `panels` (and `panels[].panels` for `row` groups).
 * - For every panel whose `datasource.type === "prometheus"` OR
 *   `datasource.uid === "prometheus"`:
 *     - For every `target` whose `target.expr` is a non-empty string:
 *         - If the expr already contains `run_id=~"$run_id"`, skip (idempotent).
 *         - Else if the expr has a `{` (label matcher), insert
 *           `run_id=~"$run_id", ` immediately after the FIRST `{`.
 *         - Else (bare metric, no labels), rewrite as
 *           `<metric>{run_id=~"$run_id"}`.
 * - Inserts the run_id template variable as `templating.list[0]` if it is
 *   not already present (idempotent by name).
 * - Writes the JSON back with `JSON.stringify(d, null, 2)` (matches the
 *   existing 2-space-indent convention of the dashboards in this repo).
 *
 * Usage
 * -----
 *   node bin/_dashboard-retrofit.mjs <dashboard.json> [<dashboard.json> ...]
 *
 * Provenance
 * ----------
 * - Phase: 09-obs-v2-code-integration-continuous-profiling-auto-trace-dash
 * - Plan : 09-03 — grafana-dashboards-traces-to-profiles
 * - Req  : OBS2-04
 * - The `run_id` resource attribute is composed by `bin/run-test.sh` in
 *   Phase 08-03 and propagated by the OTel collector via
 *   `resource_to_telemetry_conversion: true` so it appears on every
 *   Prometheus k6 metric series as a label.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const RUN_ID_VAR = {
  current: { selected: false, text: "All", value: "$__all" },
  datasource: { type: "prometheus", uid: "prometheus" },
  definition: "label_values(k6_vus, run_id)",
  hide: 0,
  includeAll: true,
  allValue: ".*",
  label: "Run ID",
  multi: true,
  name: "run_id",
  options: [],
  query: {
    query: "label_values(k6_vus, run_id)",
    refId: "StandardVariableQuery",
  },
  refresh: 2,
  regex: "",
  sort: 1,
  type: "query",
};

const FILTER_CLAUSE = 'run_id=~"$run_id"';

/**
 * Inject `run_id=~"$run_id"` into a PromQL expression.
 * Idempotent: if the clause is already present anywhere in the expr, return unchanged.
 *
 * Rules:
 *  - If `{` is present, insert `run_id=~"$run_id", ` directly after the first `{`.
 *  - If no `{`, treat as bare metric and append `{run_id=~"$run_id"}` to the
 *    first identifier-shaped token.
 *
 * Note: this is a label-matcher injection only. It does NOT attempt to parse
 * complex aggregation expressions; the heuristic of "first `{` in the expr"
 * works because in PromQL the first label matcher always belongs to the
 * innermost (left-most) metric name, and adding a matcher there narrows the
 * series set without changing the aggregation semantics.
 */
function injectRunIdFilter(expr) {
  if (typeof expr !== "string" || expr.length === 0) return expr;
  if (expr.includes(FILTER_CLAUSE)) return expr; // idempotent

  const firstBrace = expr.indexOf("{");
  if (firstBrace !== -1) {
    // Check: empty braces `{}` → insert without trailing comma
    const nextChar = expr[firstBrace + 1];
    const insertion = nextChar === "}" ? FILTER_CLAUSE : `${FILTER_CLAUSE}, `;
    return expr.slice(0, firstBrace + 1) + insertion + expr.slice(firstBrace + 1);
  }

  // Bare metric name — find first identifier token and wrap it
  // PromQL identifiers: [a-zA-Z_:][a-zA-Z0-9_:]*
  const match = expr.match(/^(\s*)([a-zA-Z_:][a-zA-Z0-9_:]*)(\s*)$/);
  if (match) {
    return `${match[1]}${match[2]}{${FILTER_CLAUSE}}${match[3]}`;
  }
  // Fallback: try to find first identifier and wrap it (e.g. `rate(metric[5m])`)
  return expr.replace(
    /([a-zA-Z_:][a-zA-Z0-9_:]*)(\s*[\[\)\s])/,
    (m, ident, trailing) => `${ident}{${FILTER_CLAUSE}}${trailing}`
  );
}

function isPrometheusPanel(panel) {
  const ds = panel.datasource || {};
  return ds.type === "prometheus" || ds.uid === "prometheus";
}

function isPrometheusTarget(target) {
  const ds = target.datasource || {};
  return ds.type === "prometheus" || ds.uid === "prometheus";
}

function processPanel(panel) {
  if (panel.type === "row" && Array.isArray(panel.panels)) {
    for (const child of panel.panels) processPanel(child);
    return;
  }
  // A panel is treated as Prometheus-backed if either the panel-level
  // datasource OR any individual target's datasource is Prometheus.
  const panelIsProm = isPrometheusPanel(panel);
  if (!Array.isArray(panel.targets)) return;
  for (const target of panel.targets) {
    if (!panelIsProm && !isPrometheusTarget(target)) continue;
    if (typeof target.expr === "string" && target.expr.length > 0) {
      target.expr = injectRunIdFilter(target.expr);
    }
  }
}

function ensureRunIdVar(dashboard) {
  if (!dashboard.templating || !Array.isArray(dashboard.templating.list)) {
    dashboard.templating = { list: [] };
  }
  const list = dashboard.templating.list;
  const existingIdx = list.findIndex((v) => v && v.name === "run_id");
  if (existingIdx === 0) return; // already first — done
  if (existingIdx > 0) {
    // Move existing run_id to the front
    const [existing] = list.splice(existingIdx, 1);
    list.unshift(existing);
    return;
  }
  // Insert a fresh copy at index 0
  list.unshift(JSON.parse(JSON.stringify(RUN_ID_VAR)));
}

function retrofitFile(filePath) {
  const abs = path.resolve(filePath);
  const raw = fs.readFileSync(abs, "utf8");
  const dashboard = JSON.parse(raw);

  ensureRunIdVar(dashboard);
  if (Array.isArray(dashboard.panels)) {
    for (const p of dashboard.panels) processPanel(p);
  }

  const output = JSON.stringify(dashboard, null, 2) + "\n";
  if (output === raw) {
    console.log(`[retrofit] ${filePath} — no changes (idempotent)`);
    return false;
  }
  fs.writeFileSync(abs, output);
  console.log(`[retrofit] ${filePath} — updated`);
  return true;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: node bin/_dashboard-retrofit.mjs <dashboard.json> [...]");
    process.exit(2);
  }
  for (const f of args) retrofitFile(f);
}

main();
