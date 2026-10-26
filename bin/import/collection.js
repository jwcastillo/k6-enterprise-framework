// bin/import/collection.js — Postman (v2.1), Bruno (.bru) and curl → one intermediate form → framework client code.
//
// Node only. Pure functions (no I/O except the readers), so the CLI and the tests share them.
//
// Intermediate form:
//   { name, base: { var } | { url }, variables: { name: value }, secrets: Set<name>,
//     requests: [{ name, method, path, headers, body, json, expect, extract: [{ var, path }] }], warnings: [] }
// Paths, headers and bodies keep {{var}} placeholders; the generated service resolves them at run time.
//
// Secrets: a variable whose name looks like a credential is never written to disk — the generated code reads it
// from __ENV and the CLI prints the variable to export. Literal credentials in curl (Authorization headers,
// password-like JSON fields) are lifted into such variables first.

"use strict";

const fs = require("fs");
const path = require("path");

const SECRET_RE = /pass(word)?|pwd|secret|token|api[-_]?key|auth|credential|private|cookie|session/i;
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

const slug = (s) => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "request";
const camel = (s) => slug(s).replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()).replace(/^(\d)/, "r$1");
const pascal = (s) => camel(s).replace(/^./, (c) => c.toUpperCase());
const envName = (prefix, v) => prefix + v.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9]+/g, "_").toUpperCase();

/** "{{baseUrl}}/api/x?y=1" or "https://h.com/api/x" → { base, path } */
function splitUrl(raw) {
  const s = String(raw).trim();
  const v = s.match(/^\{\{\s*([\w.-]+)\s*\}\}(.*)$/);
  if (v) return { base: { var: v[1] }, path: v[2] || "/" };
  const u = s.match(/^(https?:\/\/[^/?#]+)(.*)$/i);
  if (u) return { base: { url: u[1] }, path: u[2] || "/" };
  throw new Error(`URL sin esquema ni variable base: ${s}`);
}

function sameBase(a, b) {
  return (a.var && a.var === b.var) || (a.url && a.url === b.url);
}

function finish(ir) {
  // nombres repetidos (ej. "List" en dos carpetas de Postman): se desambiguan con la carpeta
  const seen = {};
  for (const r of ir.requests) seen[slug(r.name)] = (seen[slug(r.name)] || 0) + 1;
  for (const r of ir.requests) {
    if (seen[slug(r.name)] > 1 && r.folder) r.name = `${r.folder} ${r.name}`;
    delete r.folder;
  }
  const bases = ir.requests.map((r) => r.base);
  if (!bases.length) throw new Error("la colección no tiene requests HTTP");
  if (!bases.every((b) => sameBase(b, bases[0])))
    throw new Error(`la colección usa más de un host/base: ${[...new Set(bases.map((b) => b.var || b.url))].join(", ")} (importa uno por cliente)`);
  ir.base = bases[0];
  for (const r of ir.requests) delete r.base;
  for (const k of Object.keys(ir.variables)) if (SECRET_RE.test(k)) ir.secrets.add(k);
  for (const r of ir.requests) {
    if (!METHODS.includes(r.method)) throw new Error(`${r.name}: método ${r.method} no soportado`);
    for (const m of JSON.stringify(r).matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g))
      if (!(m[1] in ir.variables) && !ir.requests.some((x) => x.extract.some((e) => e.var === m[1]))) {
        ir.variables[m[1]] = undefined; // usada pero sin valor: tiene que venir por env
        if (!SECRET_RE.test(m[1])) ir.warnings.push(`variable {{${m[1]}}} sin valor en la colección: se leerá de __ENV`);
        else ir.secrets.add(m[1]);
      }
  }
  // un secreto que la propia colección extrae de una respuesta (ej. token del login) no hace falta exportarlo
  for (const r of ir.requests) for (const e of r.extract) ir.secrets.delete(e.var);
  return ir;
}

// ── Postman v2.1 ─────────────────────────────────────────────────────────────

const PM_STATUS = [/pm\.response\.to\.have\.status\((\d{3})\)/, /pm\.expect\(pm\.response\.code\)\.to\.(?:eql|equal|be)\((\d{3})\)/];
const PM_SET = /pm\.(?:environment|collectionVariables|globals|variables)\.set\(\s*["']([\w.-]+)["']\s*,\s*(?:pm\.response\.json\(\)|jsonData|json|body|data)\.([\w.[\]]+)\s*\)/g;

function postmanItems(items, prefix = []) {
  return items.flatMap((it) => (it.item ? postmanItems(it.item, [...prefix, it.name]) : [{ ...it, folder: prefix }]));
}

function parsePostman(doc, warnings) {
  if (!doc.info || !Array.isArray(doc.item)) throw new Error("no es una colección de Postman v2.x (falta info/item)");
  const ir = { name: doc.info.name || "collection", variables: {}, secrets: new Set(), requests: [], warnings };
  for (const v of doc.variable || []) ir.variables[v.key] = v.value === undefined ? undefined : String(v.value);
  for (const it of postmanItems(doc.item)) {
    const rq = it.request || {};
    const raw = typeof rq.url === "string" ? rq.url : rq.url?.raw;
    const { base, path: p } = splitUrl(raw);
    const headers = {};
    for (const h of rq.header || []) if (!h.disabled) headers[h.key] = String(h.value);
    if (rq.auth?.type === "bearer") {
      const t = (rq.auth.bearer || []).find((x) => x.key === "token");
      if (t) headers.Authorization = `Bearer ${t.value}`;
    } else if (rq.auth && rq.auth.type !== "noauth") warnings.push(`${it.name}: auth ${rq.auth.type} no soportada; agrega el header a mano`);
    let body = null;
    let json = false;
    if (rq.body?.mode === "raw" && rq.body.raw) {
      body = rq.body.raw;
      json = rq.body.options?.raw?.language === "json" || /json/i.test(headers["Content-Type"] || "") || /^\s*[{[]/.test(body);
    } else if (rq.body?.mode && rq.body.mode !== "raw") warnings.push(`${it.name}: body ${rq.body.mode} no soportado (solo raw/JSON)`);
    const exec = (it.event || []).filter((e) => e.listen === "test").flatMap((e) => e.script?.exec || []).join("\n");
    if ((it.event || []).some((e) => e.listen === "prerequest" && (e.script?.exec || []).join("").trim()))
      warnings.push(`${it.name}: el pre-request script no se importa; revísalo a mano`);
    const st = PM_STATUS.map((re) => exec.match(re)).find(Boolean);
    const extract = [...exec.matchAll(PM_SET)].map((m) => ({ var: m[1], path: m[2] }));
    const known = exec.replace(/pm\.test\([^]*?\{|\}\);?|pm\.response\.to\.have\.status\(\d+\);?|var \w+ = pm\.response\.json\(\);?|const \w+ = pm\.response\.json\(\);?|let \w+ = pm\.response\.json\(\);?/g, "").replace(PM_SET, "").replace(/pm\.expect\(pm\.response\.code\)\.to\.(?:eql|equal|be)\(\d{3}\);?/g, "").replace(/[\s;]/g, "");
    if (known.length) warnings.push(`${it.name}: parte del test script no se importa (solo status y variables.set de la respuesta)`);
    ir.requests.push({ name: it.name, folder: it.folder.join(" "), method: (rq.method || "GET").toUpperCase(), base, path: p, headers, body, json, expect: st ? Number(st[1]) : null, extract });
  }
  return finish(ir);
}

// ── Bruno (.bru) ─────────────────────────────────────────────────────────────

/** .bru → { block: string | { key: value } }. Dict blocks are "key: value" lines; body/script blocks stay raw. */
function parseBru(text) {
  const blocks = {};
  const lines = text.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^([\w:.-]+)\s*\{\s*$/);
    if (!h) continue;
    const body = [];
    while (++i < lines.length && lines[i] !== "}") body.push(lines[i]);
    const name = h[1];
    if (/^(body|script|tests|docs)/.test(name)) blocks[name] = body.map((l) => l.replace(/^ {2}/, "")).join("\n").trim();
    else {
      const d = {};
      for (const l of body) {
        const m = l.trim().match(/^(~?)([^:]+):\s?(.*)$/);
        if (m && !m[1]) d[m[2].trim()] = m[3].trim();
      }
      blocks[name] = d;
    }
  }
  return blocks;
}

function parseBruno(dir, warnings, envName_) {
  const files = fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith(".bru") && !f.split(path.sep).includes("environments") && path.basename(f) !== "collection.bru" && path.basename(f) !== "folder.bru");
  const meta = fs.existsSync(path.join(dir, "bruno.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "bruno.json"), "utf8")) : {};
  const ir = { name: meta.name || path.basename(dir), variables: {}, secrets: new Set(), requests: [], warnings };
  const envFile = envName_ ? path.join(dir, "environments", `${envName_}.bru`) : null;
  if (envFile) {
    if (!fs.existsSync(envFile)) throw new Error(`no existe el environment de Bruno ${envFile}`);
    const env = parseBru(fs.readFileSync(envFile, "utf8"));
    Object.assign(ir.variables, env.vars || {});
    for (const k of Object.keys(env["vars:secret"] || {})) ir.secrets.add(k);
    for (const l of String(fs.readFileSync(envFile, "utf8")).match(/vars:secret \[([^\]]*)\]/)?.[1]?.split(",") || [])
      if (l.trim()) ir.secrets.add(l.trim());
  }
  const reqs = files.map((f) => ({ f, b: parseBru(fs.readFileSync(path.join(dir, f), "utf8")) }))
    .filter(({ b }) => (b.meta?.type || "http") === "http")
    .sort((a, b) => Number(a.b.meta?.seq ?? 1e9) - Number(b.b.meta?.seq ?? 1e9) || a.f.localeCompare(b.f));
  for (const { f, b } of reqs) {
    const method = METHODS.find((m) => b[m.toLowerCase()]);
    if (!method) {
      warnings.push(`${f}: sin bloque get/post/put/patch/delete, se omite`);
      continue;
    }
    const spec = b[method.toLowerCase()];
    const { base, path: p } = splitUrl(spec.url);
    const headers = { ...(b.headers || {}) };
    if (b["auth:bearer"]?.token) headers.Authorization = `Bearer ${b["auth:bearer"].token}`;
    else if (spec.auth && !["none", "inherit", "bearer"].includes(spec.auth)) warnings.push(`${f}: auth ${spec.auth} no soportada`);
    const bodyKind = Object.keys(b).find((k) => k.startsWith("body:"));
    const json = bodyKind === "body:json";
    if (bodyKind && !json) warnings.push(`${f}: ${bodyKind} no soportado (solo body:json)`);
    const st = b.assert?.["res.status"]?.match(/^eq\s+(\d{3})$/);
    const extract = Object.entries(b["vars:post-response"] || {}).map(([k, v]) => {
      const m = v.match(/^res\.body\.([\w.[\]]+)$/);
      if (!m) warnings.push(`${f}: vars:post-response ${k} = ${v} no soportado (solo res.body.<ruta>)`);
      return m ? { var: k, path: m[1] } : null;
    }).filter(Boolean);
    if (b["script:pre-request"] || b["script:post-response"] || b.tests) warnings.push(`${f}: scripts/tests de Bruno no se importan; revísalos a mano`);
    ir.requests.push({ name: b.meta?.name || path.basename(f, ".bru"), method, base, path: p, headers,
      body: json ? b["body:json"] : null, json, expect: st ? Number(st[1]) : null, extract });
  }
  return finish(ir);
}

// ── curl ─────────────────────────────────────────────────────────────────────

/** Shell-like split: '...' literal, "..." with \" escapes, backslash-newline continuation. */
function shellSplit(s) {
  const out = [];
  let cur = "";
  let q = null;
  let has = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q === "'") { if (c === "'") q = null; else cur += c; continue; }
    if (q === '"') { if (c === '"') q = null; else if (c === "\\" && /["\\$`]/.test(s[i + 1])) cur += s[++i]; else cur += c; continue; }
    if (c === "'" || c === '"') { q = c; has = true; continue; }
    if (c === "\\" && s[i + 1] === "\n") { i++; continue; }
    if (c === "\\") { cur += s[++i] ?? ""; has = true; continue; }
    if (/\s/.test(c)) { if (cur || has) out.push(cur); cur = ""; has = false; continue; }
    cur += c;
  }
  if (q) throw new Error("comilla sin cerrar en el comando curl");
  if (cur || has) out.push(cur);
  return out;
}

function parseCurl(text, warnings) {
  const ir = { name: "curl", variables: {}, secrets: new Set(), requests: [], warnings };
  const joined = text.replace(/\r/g, "").replace(/\\\n/g, " ");
  let pendingName = null;
  for (const line of joined.split("\n")) {
    const t = line.trim();
    if (t.startsWith("#")) { pendingName = t.replace(/^#+\s*/, "") || null; continue; }
    if (!/^curl\s/.test(t)) continue;
    const a = shellSplit(t).slice(1);
    let method = null;
    let url = null;
    let body = null;
    let json = false;
    const headers = {};
    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      const val = () => a[++i];
      if (x === "-X" || x === "--request") method = val().toUpperCase();
      else if (x === "-H" || x === "--header") { const [k, ...v] = val().split(":"); headers[k.trim()] = v.join(":").trim(); }
      else if (["-d", "--data", "--data-raw", "--data-binary"].includes(x)) body = val();
      else if (x === "--json") { body = val(); json = true; headers["Content-Type"] = headers["Content-Type"] || "application/json"; }
      else if (x === "-u" || x === "--user") { val(); warnings.push(`curl: -u (basic auth) no se importa; usa un header Authorization con {{variable}}`); }
      else if (["-s", "-S", "-k", "-L", "-i", "-v", "--silent", "--compressed", "--insecure", "--location", "--fail", "-f"].includes(x)) continue;
      else if (["-o", "--output", "-w", "--write-out", "-m", "--max-time", "--connect-timeout"].includes(x)) val();
      else if (x.startsWith("-")) warnings.push(`curl: opción ${x} ignorada`);
      else url = x;
    }
    if (!url) throw new Error(`curl sin URL: ${t.slice(0, 80)}`);
    const { base, path: p } = splitUrl(url);
    json = json || /json/i.test(headers["Content-Type"] || "") || (body !== null && /^\s*[{[]/.test(body));
    // credenciales literales → variables de entorno, nunca a disco
    for (const k of Object.keys(headers))
      if (/^(authorization|x-api-key|api-key|cookie)$/i.test(k) && !/\{\{/.test(headers[k])) {
        const [scheme, ...rest] = headers[k].split(" ");
        const v = camel(k);
        ir.secrets.add(v);
        headers[k] = rest.length ? `${scheme} {{${v}}}` : `{{${v}}}`;
      }
    if (json && body) {
      try {
        const obj = JSON.parse(body);
        for (const k of Object.keys(obj)) if (SECRET_RE.test(k) && typeof obj[k] === "string") { ir.secrets.add(k); obj[k] = `{{${k}}}`; }
        body = JSON.stringify(obj, null, 2);
      } catch { warnings.push(`curl: body JSON inválido, se usa tal cual`); }
    }
    ir.requests.push({ name: pendingName || `${method || (body ? "POST" : "GET")} ${p.split("?")[0]}`, method: method || (body ? "POST" : "GET"),
      base, path: p, headers, body, json, expect: null, extract: [] });
    pendingName = null;
  }
  return finish(ir);
}

function read(source, { brunoEnv } = {}) {
  const warnings = [];
  const st = fs.statSync(source);
  if (st.isDirectory()) return parseBruno(source, warnings, brunoEnv);
  const text = fs.readFileSync(source, "utf8");
  if (/^\s*\{/.test(text)) return parsePostman(JSON.parse(text), warnings);
  if (/^\s*(#.*\n\s*)*curl\s/m.test(text)) return parseCurl(text, warnings);
  throw new Error(`no reconozco el formato de ${source}: Postman v2.1 (.json), carpeta de Bruno o archivo con comandos curl`);
}

// ── generación ───────────────────────────────────────────────────────────────

/** Texto con {{var}} → template literal de TypeScript que resuelve con v(). */
function tpl(s, fn = "v") {
  return "`" + String(s).replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")
    .replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, n) => "${" + fn + "(" + JSON.stringify(n) + ")}") + "`";
}

function render(ir, { client, name, envPrefix, source }) {
  const cls = `${pascal(name)}Service`;
  const svcFile = `${slug(name)}.service`;
  const defaults = Object.fromEntries(Object.entries(ir.variables).filter(([k, v]) => v !== undefined && !ir.secrets.has(k)));
  const envs = Object.fromEntries(Object.keys(ir.variables).concat([...ir.secrets]).map((k) => [k, envName(envPrefix, k)]));
  const extracted = new Set(ir.requests.flatMap((r) => r.extract.map((e) => e.var)));
  const methods = ir.requests.map((r) => {
    const m = camel(r.name);
    const opts = Object.keys(r.headers).length
      ? `{ extraHeaders: { ${Object.entries(r.headers).map(([k, val]) => `${JSON.stringify(k)}: ${tpl(val)}`).join(", ")} }, tags: { name: ${JSON.stringify(r.name)} } }`
      : `{ tags: { name: ${JSON.stringify(r.name)} } }`;
    // en JSON, jv() escapa comillas y barras del valor (una contraseña con " no rompe el body)
    const body = r.body == null ? "undefined" : r.json ? `JSON.parse(${tpl(r.body, "jv")})` : tpl(r.body);
    const call = r.method === "GET" ? `this.api.get(${tpl(r.path)}, undefined, ${opts})`
      : r.method === "DELETE" ? `this.api.delete(${tpl(r.path)}, ${opts})`
      : `this.api.${r.method.toLowerCase()}(${tpl(r.path)}, ${body}, ${opts})`;
    return { r, m, code: `  /** ${r.method} ${r.path.replace(/\*\//g, "*\\/")} */\n  ${m}(): SafeResponse {\n    return ${call};\n  }` };
  });
  const baseExpr = ir.base.var ? `v(${JSON.stringify(ir.base.var)})` : JSON.stringify(ir.base.url);
  const header = `/**\n * Generado por bin/import-collection.js desde ${path.basename(source)}. Regenerar en vez de editar a mano.\n */`;
  const service = `${header}

import { RequestHelper, SafeResponse } from "@helpers/request-helper";

/** Valores no secretos de la colección (cada uno se puede sobrescribir por env). */
const DEFAULTS: Record<string, string> = ${JSON.stringify(defaults, null, 2)};
/** Variable de la colección → variable de entorno. Los secretos solo existen en el entorno. */
const ENV: Record<string, string> = ${JSON.stringify(envs, null, 2)};
/** Valores extraídos de respuestas en esta iteración (cada VU tiene el suyo). */
const state: Record<string, string> = {};

export function v(name: string): string {
  const val = state[name] ?? (ENV[name] ? __ENV[ENV[name]] : undefined) ?? DEFAULTS[name];
  if (val === undefined) throw new Error(\`falta la variable \${name}\${ENV[name] ? \` (exporta \${ENV[name]})\` : ""}\`);
  return val;
}

/** v() escapado para ir dentro de un body JSON. */
export function jv(name: string): string {
  return JSON.stringify(v(name)).slice(1, -1);
}

export function remember(name: string, value: unknown): void {
  if (value !== null && value !== undefined) state[name] = String(value);
}

export const BASE_URL = __ENV["API_BASE_URL"] ?? ${baseExpr};

export class ${cls} {
  private api: RequestHelper;

  constructor(baseUrl: string = BASE_URL, scenario = ${JSON.stringify(slug(name))}) {
    this.api = new RequestHelper(baseUrl, { tags: { client: ${JSON.stringify(client)}, scenario } });
  }

${methods.map((x) => x.code).join("\n\n")}
}
`;
  const checkOf = (r) => (r.expect ? `[statusCheck(${r.expect})]` : `[statusRangeCheck(200, 399)]`);
  const checkNames = (rs) => [rs.some((r) => r.expect) && "statusCheck", rs.some((r) => !r.expect) && "statusRangeCheck"].filter(Boolean);
  const imports = ({ k6, checks, svc, up }) => [
    `import { ${k6.join(", ")} } from "k6";`,
    `import { runChecks, ${checks.join(", ")} } from "@core/check-system";`,
    `import { buildOptions } from "@core/config-loader";`,
    `import { ${svc.join(", ")} } from "${up}lib/services/${svcFile}";`,
  ].join("\n");
  const usesExtracted = (r) => [...JSON.stringify([r.path, r.headers, r.body]).matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].some((m) => extracted.has(m[1]));
  const files = { [`lib/services/${svcFile}.ts`]: service };
  const skipped = [];
  for (const x of methods) {
    if (usesExtracted(x.r)) {
      skipped.push(x.r.name); // depende de un valor que otro request extrae: solo va en el flow
      continue;
    }
    files[`scenarios/api/${slug(name)}/${slug(x.r.name)}.ts`] = `${header}

${imports({ k6: ["sleep"], checks: checkNames([x.r]), svc: [cls], up: "../../../" })}

export const options = buildOptions({ checks: ["rate>=0.99"] });

const api = new ${cls}(undefined, ${JSON.stringify(slug(x.r.name))});

export default function (): void {
  runChecks(api.${x.m}(), ${checkOf(x.r)});
  sleep(1);
}
`;
  }
  const steps = methods.map((x) => `  group(${JSON.stringify(x.r.name)}, () => {
    const res = api.${x.m}();
    runChecks(res, ${checkOf(x.r)});${x.r.extract.map((e) => `\n    remember(${JSON.stringify(e.var)}, res.json(${JSON.stringify(e.path)}));`).join("")}
  });
  sleep(1);`).join("\n");
  files[`scenarios/flow/${slug(name)}.ts`] = `${header}

${imports({ k6: ["group", "sleep"], checks: checkNames(ir.requests), svc: extracted.size ? [cls, "remember"] : [cls], up: "../../" })}

export const options = buildOptions({ checks: ["rate>=0.99"] });

const api = new ${cls}(undefined, ${JSON.stringify(slug(name))});

/** Los requests de la colección en orden; los valores extraídos de una respuesta alimentan los siguientes. */
export default function (): void {
${steps}
}
`;
  const secrets = [...ir.secrets].map((k) => envs[k]);
  return { files, secrets, skipped };
}

module.exports = { read, render, parseBru, shellSplit, slug, SECRET_RE };
