#!/usr/bin/env node
/**
 * bin/validate-generated.js — deterministic gate for AI-produced artifacts.
 *
 * Runs BEFORE a human accepts anything an agent wrote. No LLM involved: every
 * check is a parser, a schema or a regex, so the same input always gets the
 * same verdict.
 *
 * Usage:
 *   node bin/validate-generated.js --kind=scenario|testplan|flow|patch|report <path...>
 *        [--client=<name>|--config=<client config json>] [--format=text|json] [--strict]
 *
 * Exit codes: 0 pass, 1 fail, 2 usage error.
 *
 * Check statuses: pass | warn | fail | skip. Only `fail` fails the verdict;
 * --strict promotes the load-ceiling warning to a failure.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { findSecrets, findPII } = require("./_secret-patterns");
const { resolveConfigPath } = require("./target-guard");

const ROOT = path.resolve(__dirname, "..");
const KINDS = ["scenario", "testplan", "flow", "patch", "report"];
const BUCKETS = ["api", "flow", "domain", "chaos", "perf"];
const GATE_RE = /export const gate = "(quarantined|experimental|unsafe)"/;
const DEFAULT_MAX_VUS = 500;
const DEFAULT_MAX_RATE = 1000;
// Remote modules a k6 scenario may import (k6 jslib only).
const MODULE_HOSTS = ["jslib.k6.io"];
// Imports that only exist under Node, or that pull the AI layer into a k6 bundle.
const NODE_ONLY_RE =
  /^(@node\/|node:|fs$|fs\/|path$|child_process$|os$|net$|crypto$|http$|https$|ioredis$|@anthropic-ai\/|openai$)|(^|\/)src\/(ai|node)(\/|$)|^@ai\//;

// ── helpers ─────────────────────────────────────────────────────────────────

function check(id, status, message, extra = {}) {
  return { id, status, message, ...extra };
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function loadConfig(opts) {
  let configPath = opts.config;
  if (!configPath && opts.client) configPath = resolveConfigPath(ROOT, opts.client, opts.env || "default");
  if (!configPath) return { config: null };
  if (!fs.existsSync(configPath)) throw new UsageError(`config not found: ${configPath}`);
  try {
    return { config: JSON.parse(fs.readFileSync(configPath, "utf8")), configPath };
  } catch (err) {
    throw new UsageError(`config is not valid JSON: ${configPath} (${err.message})`);
  }
}

function allowedHostsOf(config) {
  return config && Array.isArray(config.allowedHosts)
    ? config.allowedHosts.map((h) => String(h).toLowerCase())
    : null;
}

/** Every http(s) URL that starts a string literal, with its line. */
function literalUrls(text) {
  const out = [];
  const re = /["'`](https?:\/\/[^"'`\s]+)/g;
  let m;
  while ((m = re.exec(text))) out.push({ url: m[1], line: lineOf(text, m.index) });
  return out;
}

function hostChecks(urls, allowed, file, idPrefix = "hosts") {
  const checks = [];
  const bad = [];
  for (const { url, line } of urls) {
    const host = hostOf(url.replace(/\$\{[^}]*\}/g, "x"));
    if (!host) continue;
    if (allowed && !allowed.includes(host)) bad.push({ host, line });
  }
  if (bad.length) {
    for (const b of bad)
      checks.push(check(idPrefix, "fail", `host '${b.host}' is not in allowedHosts`, { file, line: b.line }));
  } else if (!allowed && urls.length) {
    checks.push(
      check(idPrefix, "warn", `hard-coded URL(s) found and no allowedHosts in the client config to check them against`, {
        file,
        line: urls[0].line,
      })
    );
  } else {
    checks.push(check(idPrefix, "pass", urls.length ? "all hosts allowlisted" : "no hard-coded hosts", { file }));
  }
  return checks;
}

function secretChecks(text, file) {
  const hits = findSecrets(text);
  if (!hits.length) return [check("secrets", "pass", "no literal credentials", { file })];
  return hits.map((h) => check("secrets", "fail", `possible secret (${h.id})`, { file, line: h.line }));
}

function piiChecks(text, file) {
  const hits = findPII(text);
  if (!hits.length) return [check("pii", "pass", "no PII patterns", { file })];
  return hits.map((h) => check("pii", "fail", `PII pattern (${h.id})`, { file, line: h.line }));
}

let ajvInstance = null;
function compileSchema(schemaPath) {
  if (!ajvInstance) {
    const Ajv = require("ajv");
    const addFormats = require("ajv-formats");
    ajvInstance = new Ajv({ allErrors: true, strict: false });
    addFormats(ajvInstance);
  }
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  // Schemas carry $id; compiling the same one twice would throw.
  return (schema.$id && ajvInstance.getSchema(schema.$id)) || ajvInstance.compile(schema);
}

function schemaChecks(data, schemaPath, file) {
  const validate = compileSchema(schemaPath);
  if (validate(data)) return [check("schema", "pass", `valid against ${path.basename(schemaPath)}`, { file })];
  return (validate.errors || []).map((e) =>
    check("schema", "fail", `${e.instancePath || "/"} ${e.message}`, { file })
  );
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

class UsageError extends Error {}

// ── scenario ────────────────────────────────────────────────────────────────

/** outKey the repo webpack config would give this file, or a scratch key. */
function bundleKey(abs) {
  const rel = path.relative(ROOT, abs).split(path.sep).join("/");
  const m = /^clients\/([^/]+)\/scenarios\/(.+)\.ts$/.exec(rel);
  if (m) return `${m[1].replace(/^_/, "")}/${m[2]}`;
  return `_validate/${path.basename(abs, ".ts")}`;
}

/**
 * Compile through the repo webpack config, one entry only. Same loader, aliases
 * and externals as `pnpm build`, so an unresolved import or a syntax error fails
 * here exactly as it would in the runner.
 */
function buildScenario(abs) {
  let webpack;
  try {
    webpack = require("webpack");
  } catch {
    return { status: "skip", message: "webpack not installed — run pnpm install" };
  }
  const base = require(path.join(ROOT, "webpack.config.js"));
  const key = bundleKey(abs);
  const cfg = { ...base, entry: { [key]: abs }, stats: "errors-only", infrastructureLogging: { level: "error" } };
  return new Promise((resolve) => {
    webpack(cfg, (err, stats) => {
      if (err) return resolve({ status: "fail", message: `webpack: ${err.message}` });
      if (stats.hasErrors()) {
        const first = stats.toJson({ all: false, errors: true }).errors[0];
        const msg = String((first && (first.message || first)) || "unknown error").split("\n").slice(0, 3).join(" ");
        return resolve({ status: "fail", message: `webpack: ${msg}` });
      }
      resolve({ status: "pass", message: "compiles with the repo webpack config", bundle: path.join(ROOT, "dist", `${key}.js`) });
    });
  });
}

/** Syntax-only check for --no-build (the hook path): ts.transpileModule. */
function transpileScenario(text, file) {
  let ts;
  try {
    ts = require("typescript");
  } catch {
    return check("compile", "skip", "typescript not installed", { file });
  }
  const out = ts.transpileModule(text, { reportDiagnostics: true, fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2020 } });
  const diag = (out.diagnostics || []).find((d) => d.category === ts.DiagnosticCategory.Error);
  if (!diag) return check("compile", "pass", "transpiles (syntax only, --no-build)", { file });
  const line = diag.file && diag.start != null ? diag.file.getLineAndCharacterOfPosition(diag.start).line + 1 : undefined;
  return check("compile", "fail", ts.flattenDiagnosticMessageText(diag.messageText, " "), { file, line });
}

function k6Inspect(bundle, file) {
  const probe = spawnSync("k6", ["version"], { encoding: "utf8" });
  if (probe.error) return check("k6-inspect", "warn", "k6 not installed — inspect skipped", { file });
  const res = spawnSync("k6", ["inspect", bundle], { encoding: "utf8", cwd: path.dirname(bundle), timeout: 30000 });
  if (res.status === 0) return check("k6-inspect", "pass", "k6 inspect ok", { file });
  const msg = (res.stderr || res.stdout || "").split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 300);
  return check("k6-inspect", "fail", `k6 inspect failed: ${msg}`, { file });
}

function loadCeilingChecks(text, config, strict, file) {
  const maxVUs = (config && config.maxVUs) || DEFAULT_MAX_VUS;
  const maxRate = (config && config.maxRate) || DEFAULT_MAX_RATE;
  const arrival = /arrival-rate/.test(text);
  const over = [];
  const re = /\b(vus|maxVUs|preAllocatedVUs|target|rate)\s*:\s*(\d+)/g;
  let m;
  while ((m = re.exec(text))) {
    const n = Number(m[2]);
    const isRate = m[1] === "rate" || (m[1] === "target" && arrival);
    const ceiling = isRate ? maxRate : maxVUs;
    if (n > ceiling) over.push({ key: m[1], n, ceiling, line: lineOf(text, m.index) });
  }
  if (!over.length) return [check("load-ceiling", "pass", `within ceiling (maxVUs=${maxVUs}, maxRate=${maxRate})`, { file })];
  return over.map((o) =>
    check("load-ceiling", strict ? "fail" : "warn", `${o.key}: ${o.n} exceeds ceiling ${o.ceiling}`, { file, line: o.line })
  );
}

async function validateScenario(file, ctx) {
  const checks = [];
  const abs = path.resolve(file);
  const text = fs.readFileSync(abs, "utf8");
  const rel = abs.split(path.sep).join("/");

  const bucketMatch = /\/scenarios\/([^/]+)\//.exec(rel);
  const bucket = bucketMatch ? bucketMatch[1] : null;
  checks.push(
    bucket && BUCKETS.includes(bucket)
      ? check("bucket", "pass", `bucket '${bucket}'`, { file })
      : check("bucket", "fail", `scenario must live under scenarios/{${BUCKETS.join("|")}}/`, { file })
  );

  if (bucket === "perf" || bucket === "chaos") {
    checks.push(
      GATE_RE.test(text)
        ? check("gate-marker", "pass", `gate marker present`, { file })
        : check("gate-marker", "fail", `${bucket}/ scenarios must declare export const gate = "unsafe"|"experimental"|"quarantined"`, { file })
    );
  }

  const importRe = /(?:\bimport\s[^'"]*?from\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;
  const nodeImports = [];
  const moduleUrls = new Set();
  let m;
  while ((m = importRe.exec(text))) {
    const spec = m[1];
    if (/^https?:\/\//.test(spec)) {
      moduleUrls.add(spec);
      if (!MODULE_HOSTS.includes(hostOf(spec))) {
        checks.push(check("imports", "fail", `remote module from non-jslib host '${hostOf(spec)}'`, { file, line: lineOf(text, m.index) }));
      }
    } else if (NODE_ONLY_RE.test(spec)) {
      nodeImports.push({ spec, line: lineOf(text, m.index) });
    }
  }
  if (nodeImports.length) {
    for (const n of nodeImports) checks.push(check("imports", "fail", `Node-only import '${n.spec}' cannot run in k6`, { file, line: n.line }));
  } else {
    checks.push(check("imports", "pass", "no Node-only imports", { file }));
  }

  const urls = literalUrls(text).filter((u) => !moduleUrls.has(u.url));
  checks.push(...hostChecks(urls, allowedHostsOf(ctx.config), file));
  checks.push(...secretChecks(text, file));

  checks.push(
    /\bthresholds\s*:/.test(text)
      ? check("thresholds", "pass", "thresholds declared", { file })
      : check("thresholds", "fail", "options must declare thresholds", { file })
  );

  const sys = /\bsystemTags\s*:\s*\[([^\]]*)\]/.exec(text);
  if (!sys) checks.push(check("system-tags", "warn", "systemTags not set — k6 default includes 'url' (high cardinality)", { file }));
  else if (/["']url["']/.test(sys[1]))
    checks.push(check("system-tags", "fail", "systemTags must not include 'url' (metric cardinality)", { file, line: lineOf(text, sys.index) }));
  else checks.push(check("system-tags", "pass", "systemTags excludes 'url'", { file }));

  const abort = /\babortOnFail\s*:\s*true/.exec(text);
  if (abort) checks.push(check("abort-on-fail", "warn", "abortOnFail: true — confirm this is intended", { file, line: lineOf(text, abort.index) }));

  checks.push(...loadCeilingChecks(text, ctx.config, ctx.strict, file));

  if (ctx.noBuild) {
    checks.push(transpileScenario(text, file));
  } else {
    const built = await buildScenario(abs);
    checks.push(check("compile", built.status, built.message, { file }));
    if (built.status === "pass") checks.push(k6Inspect(built.bundle, file));
  }
  return checks;
}

// ── testplan ────────────────────────────────────────────────────────────────

function validateTestPlan(file, ctx) {
  let plan;
  try {
    plan = readJson(file);
  } catch (err) {
    return [check("json", "fail", `not valid JSON: ${err.message}`, { file })];
  }
  const checks = schemaChecks(plan, path.join(ROOT, "shared/schemas/test-plan.schema.json"), file);

  const urls = [];
  if (typeof plan.baseUrl === "string") urls.push({ url: plan.baseUrl });
  if (plan.authConfig && typeof plan.authConfig.tokenUrl === "string" && /^https?:/.test(plan.authConfig.tokenUrl))
    urls.push({ url: plan.authConfig.tokenUrl });
  for (const e of plan.endpoints || []) if (e && /^https?:/.test(String(e.url))) urls.push({ url: e.url });
  checks.push(...hostChecks(urls, allowedHostsOf(ctx.config), file));
  checks.push(...secretChecks(JSON.stringify(plan, null, 1), file));

  const profiles = [...(Array.isArray(plan.testTypes) ? plan.testTypes : []), ...(plan.profile ? [plan.profile] : [])];
  const missing = profiles.filter((p) => !fs.existsSync(path.join(ROOT, "shared/profiles", `${p}.json`)));
  checks.push(
    missing.length
      ? check("profiles", "fail", `unknown profile(s): ${missing.join(", ")} (see shared/profiles/)`, { file })
      : check("profiles", "pass", "all profiles exist in shared/profiles", { file })
  );
  return checks;
}

// ── flow ────────────────────────────────────────────────────────────────────

function validateFlow(target, ctx) {
  const checks = [];
  const dir = fs.statSync(target).isDirectory() ? target : path.dirname(target);
  const flowJson = fs.statSync(target).isDirectory() ? path.join(dir, "flow.json") : target;
  if (!fs.existsSync(flowJson)) return [check("flow-json", "fail", "flow.json not found", { file: target })];

  let flow;
  try {
    flow = readJson(flowJson);
  } catch (err) {
    return [check("json", "fail", `not valid JSON: ${err.message}`, { file: flowJson })];
  }

  // The schema ships with bin/discover-flow.js; load it lazily so the gate works before that lands.
  const schemaPath = ctx.schema || path.join(ROOT, "shared/schemas/discovery-flow.schema.json");
  if (fs.existsSync(schemaPath)) checks.push(...schemaChecks(flow, schemaPath, flowJson));
  else checks.push(check("schema", "skip", `schema not found (${path.relative(ROOT, schemaPath)}) — schema validation skipped`, { file: flowJson }));

  const g = flow.guardrails;
  const hasStop = g && ((Array.isArray(g.stopAt) && g.stopAt.length > 0) || (typeof g.denyText === "string" && g.denyText.length > 0));
  checks.push(
    g && Number(g.maxSteps) > 0 && hasStop
      ? check("guardrails", "pass", `guardrails: maxSteps=${g.maxSteps}`, { file: flowJson })
      : check("guardrails", "fail", "guardrails block needs maxSteps > 0 and a non-empty stopAt or denyText", { file: flowJson })
  );

  const hosts = allowedHostsOf(ctx.config);
  if (hosts && Array.isArray(flow.hostsSeen)) {
    const bad = flow.hostsSeen.map((h) => String(h).toLowerCase()).filter((h) => !hosts.includes(h));
    checks.push(
      bad.length
        ? check("hosts", "fail", `hosts outside allowedHosts: ${bad.join(", ")}`, { file: flowJson })
        : check("hosts", "pass", "all hosts allowlisted", { file: flowJson })
    );
  }

  for (const name of ["flow.json", "flow.md", "flow-plan.md"]) {
    const f = path.join(dir, name);
    if (fs.existsSync(f)) checks.push(...piiChecks(fs.readFileSync(f, "utf8"), f), ...secretChecks(fs.readFileSync(f, "utf8"), f));
  }
  return checks;
}

// ── patch ───────────────────────────────────────────────────────────────────

const PATCH_ALLOWED_RE = /^(scenarios\/|clients\/[^/]+\/(lib|scenarios)\/)/;
const GUARD_RE = /export const gate|\bthresholds\b|\bcheck\(|\bguard\w*\(|\bcheckTarget\(|\bassert\w*\(/;

/** Parse the unified diff(s) of a .diff/.patch or the ```diff blocks of a .md proposal. */
function parseDiff(text, isMarkdown) {
  let body = text;
  if (isMarkdown) {
    const blocks = [...text.matchAll(/```(?:diff|patch)\n([\s\S]*?)```/g)].map((b) => b[1]);
    body = blocks.join("\n");
  }
  const files = new Set();
  const added = [];
  const removed = [];
  for (const line of body.split("\n")) {
    const f = /^(?:\+\+\+|---) (?:[ab]\/)?(\S+)/.exec(line);
    if (f) {
      if (f[1] !== "/dev/null") files.add(f[1]);
      continue;
    }
    if (line.startsWith("+")) added.push(line.slice(1));
    else if (line.startsWith("-")) removed.push(line.slice(1));
  }
  return { files: [...files], added, removed, hasDiff: body.trim().length > 0 };
}

function validatePatch(file, ctx) {
  const checks = [];
  const ext = path.extname(file).toLowerCase();
  if (![".md", ".diff", ".patch"].includes(ext)) {
    return [check("proposal-only", "fail", "a patch must be a proposal (.md, .diff or .patch), never an applied source file", { file })];
  }
  const text = fs.readFileSync(file, "utf8");
  const { files, added, removed, hasDiff } = parseDiff(text, ext === ".md");
  checks.push(check("proposal-only", "pass", hasDiff ? `proposal touching ${files.length} file(s)` : "prose-only proposal", { file }));

  const outside = files.filter((f) => !PATCH_ALLOWED_RE.test(f));
  checks.push(
    outside.length
      ? check("paths", "fail", `touches files outside scenarios/ and clients/*/{lib,scenarios}/: ${outside.join(", ")}`, { file })
      : check("paths", "pass", "only scenario/lib paths", { file })
  );

  const addedSet = new Set(added.map((l) => l.trim()));
  const dropped = removed.filter((l) => GUARD_RE.test(l) && !addedSet.has(l.trim()));
  checks.push(
    dropped.length
      ? check("guards", "fail", `removes a gate marker, threshold or guard call: ${dropped[0].trim().slice(0, 80)}`, { file })
      : check("guards", "pass", "no gate markers, thresholds or guard calls removed", { file })
  );

  const oldHosts = new Set(literalUrls(removed.join("\n")).map((u) => hostOf(u.url)));
  const allowed = allowedHostsOf(ctx.config);
  const newHosts = [
    ...new Set(
      literalUrls(added.join("\n"))
        .map((u) => hostOf(u.url))
        .filter((h) => h && !oldHosts.has(h) && !MODULE_HOSTS.includes(h) && !(allowed && allowed.includes(h)))
    ),
  ];
  checks.push(
    newHosts.length
      ? check("hosts", "fail", `introduces new host(s): ${newHosts.join(", ")}`, { file })
      : check("hosts", "pass", "no new hosts", { file })
  );
  checks.push(...secretChecks(added.join("\n") || text, file));
  return checks;
}

// ── report ──────────────────────────────────────────────────────────────────

/** All numbers a JSON document contains, as strings in a few canonical forms. */
function jsonNumbers(value, out = new Set()) {
  if (typeof value === "number" && Number.isFinite(value)) {
    out.add(String(value));
    for (const d of [0, 1, 2]) out.add(value.toFixed(d));
    if (Math.abs(value) <= 1) for (const d of [0, 1, 2]) out.add((value * 100).toFixed(d)); // ratios shown as %
  } else if (typeof value === "string") {
    for (const m of value.match(/-?\d+(?:\.\d+)?/g) || []) jsonNumbers(Number(m), out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) jsonNumbers(v, out);
  }
  return out;
}

// Numbers a report may carry without data backing: list ordinals, headings,
// and small integers used in prose ("top 3", "2 endpoints").
function isStructural(line, raw) {
  if (/^\s*(#{1,6}\s|\d+[.)]\s)/.test(line) && line.trimStart().startsWith(raw)) return true;
  return /^\d$/.test(raw);
}

function validateReport(file, ctx) {
  const checks = [];
  const text = fs.readFileSync(file, "utf8");
  const dataFile = ctx.data || file.replace(/\.md$/i, ".json");
  if (!fs.existsSync(dataFile)) {
    checks.push(check("numbers", "fail", `no deterministic JSON to check numbers against (pass --data=<file> or ship ${path.basename(dataFile)})`, { file }));
  } else {
    const known = jsonNumbers(readJson(dataFile));
    const unbacked = [];
    text.split("\n").forEach((line, i) => {
      // Dates, times and versions are not measurements.
      const scrubbed = line
        .replace(/\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+Z?)?/g, " ")
        .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ")
        .replace(/\bv?\d+\.\d+\.\d+\b/g, " ")
        .replace(/`[^`]*`/g, " ");
      for (const m of scrubbed.matchAll(/(?<![\w.])-?\d[\d,]*(?:\.\d+)?/g)) {
        const raw = m[0];
        const n = raw.replace(/,/g, "");
        if (isStructural(line, raw)) continue;
        const variants = [n, String(Number(n)), Number(n).toFixed(0), Number(n).toFixed(1), Number(n).toFixed(2)];
        if (!variants.some((v) => known.has(v))) unbacked.push({ raw, line: i + 1 });
      }
    });
    if (unbacked.length) {
      for (const u of unbacked.slice(0, 20)) checks.push(check("numbers", "fail", `number '${u.raw}' is not in ${path.basename(dataFile)}`, { file, line: u.line }));
    } else {
      checks.push(check("numbers", "pass", `every number is backed by ${path.basename(dataFile)}`, { file }));
    }
  }

  checks.push(...piiChecks(text, file));
  checks.push(...secretChecks(text, file));

  const terms = (ctx.denyTerms || []).filter(Boolean);
  if (terms.length) {
    const hits = [];
    text.split("\n").forEach((line, i) => {
      for (const t of terms) if (line.toLowerCase().includes(t.toLowerCase())) hits.push({ t, line: i + 1 });
    });
    // Never echo the term itself: the deny list is often itself confidential.
    if (hits.length) for (const h of hits) checks.push(check("deny-terms", "fail", `denied term #${terms.indexOf(h.t) + 1} present`, { file, line: h.line }));
    else checks.push(check("deny-terms", "pass", `none of ${terms.length} denied term(s) present`, { file }));
  }
  return checks;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const VALIDATORS = { scenario: validateScenario, testplan: validateTestPlan, flow: validateFlow, patch: validatePatch, report: validateReport };

async function validate(kind, target, ctx) {
  if (!fs.existsSync(target)) return { kind, path: target, verdict: "fail", checks: [check("exists", "fail", "path not found", { file: target })] };
  let checks;
  try {
    checks = await VALIDATORS[kind](target, ctx);
  } catch (err) {
    checks = [check("internal", "fail", `validator error: ${err.message}`, { file: target })];
  }
  const verdict = checks.some((c) => c.status === "fail") ? "fail" : "pass";
  return { kind, path: target, verdict, checks };
}

function parseArgs(argv) {
  const opts = { paths: [], format: "text", strict: false, noBuild: false, denyTerms: [] };
  for (const a of argv) {
    const [k, v] = a.includes("=") ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : [a, undefined];
    switch (k) {
      case "--kind": opts.kind = v; break;
      case "--client": opts.client = v; break;
      case "--config": opts.config = v; break;
      case "--env": opts.env = v; break;
      case "--format": opts.format = v; break;
      case "--strict": opts.strict = true; break;
      case "--no-build": opts.noBuild = true; break;
      case "--schema": opts.schema = v; break;
      case "--data": opts.data = v; break;
      case "--deny-terms": opts.denyTerms = String(v || "").split(",").map((s) => s.trim()); break;
      default:
        if (a.startsWith("--")) throw new UsageError(`unknown flag: ${k}`);
        opts.paths.push(a);
    }
  }
  if (!KINDS.includes(opts.kind)) throw new UsageError(`--kind must be one of ${KINDS.join("|")}`);
  if (!["text", "json"].includes(opts.format)) throw new UsageError("--format must be text or json");
  if (!opts.paths.length) throw new UsageError("at least one <path> is required");
  return opts;
}

function renderText(results) {
  const icon = { pass: "ok  ", warn: "WARN", fail: "FAIL", skip: "skip" };
  const lines = [];
  for (const r of results) {
    lines.push(`${r.verdict === "pass" ? "PASS" : "FAIL"} ${r.kind} ${r.path}`);
    for (const c of r.checks) {
      const where = (c.file && c.file !== r.path ? ` ${path.basename(c.file)}` : "") + (c.line ? `:${c.line}` : "");
      lines.push(`  [${icon[c.status] || c.status}] ${c.id}${where} — ${c.message}`);
    }
  }
  return lines.join("\n");
}

async function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    require("./_help").printHelp({
      name: "validate-generated",
      description: "Deterministic gate for AI-produced artifacts (no LLM). Exit 0 pass, 1 fail, 2 usage.",
      usage:
        "node bin/validate-generated.js --kind=scenario|testplan|flow|patch|report <path...> [--client=<name>|--config=<json>] [--format=text|json] [--strict]",
      flags: [
        { flag: "--kind=<kind>", description: "scenario | testplan | flow | patch | report (required)" },
        { flag: "--client=<name>", description: "Read allowedHosts / maxVUs / maxRate from clients/<name>/config/<env>.json" },
        { flag: "--config=<file>", description: "Client config JSON to read allowedHosts / maxVUs / maxRate from" },
        { flag: "--env=<env>", description: "Config environment used with --client (default: default)" },
        { flag: "--format=text|json", description: "Output format (default: text)" },
        { flag: "--strict", description: "Fail (instead of warn) when load exceeds maxVUs / maxRate" },
        { flag: "--no-build", description: "scenario: syntax-only transpile, skip webpack + k6 inspect (used by hooks)" },
        { flag: "--schema=<file>", description: "flow: override shared/schemas/discovery-flow.schema.json" },
        { flag: "--data=<file>", description: "report: deterministic JSON the numbers must come from (default: <report>.json)" },
        { flag: "--deny-terms=a,b", description: "report: terms that must not appear (brand/client names)" },
      ],
      examples: [
        "node bin/validate-generated.js --kind=scenario clients/acme/scenarios/api/login.ts --client=acme",
        "node bin/validate-generated.js --kind=testplan plan.json --config=clients/acme/config/staging.json --format=json",
        "node bin/validate-generated.js --kind=flow reports/discovery/checkout/",
        "node bin/validate-generated.js --kind=report analysis.md --data=summary.json --deny-terms=acme",
      ],
    });
    return 0;
  }

  let opts;
  let config;
  try {
    opts = parseArgs(argv);
    ({ config } = loadConfig(opts));
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`validate-generated: ${err.message}\n(run with --help for usage)\n`);
      return 2;
    }
    throw err;
  }

  const ctx = { ...opts, config };
  const results = [];
  for (const p of opts.paths) results.push(await validate(opts.kind, p, ctx));

  if (opts.format === "json") {
    process.stdout.write(JSON.stringify(results.length === 1 ? results[0] : results, null, 2) + "\n");
  } else {
    process.stdout.write(renderText(results) + "\n");
  }
  return results.every((r) => r.verdict === "pass") ? 0 : 1;
}

module.exports = { validate, parseDiff, jsonNumbers };

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`validate-generated: ${err.stack || err.message}\n`);
      process.exit(2);
    }
  );
}
