#!/usr/bin/env node
// bin/import-collection.js — import a Postman (v2.1) collection, a Bruno collection folder or a file of curl
// commands into a client: one service class, one api/ scenario per independent request and one flow/ scenario
// with every request in order (values extracted from a response feed the next requests).
//
// Node only. Parsing and code generation live in bin/import/collection.js. The generated scenarios go through the
// generation gate (bin/validate-generated.js) before anyone runs them; a smoke must pass before any load.
//
// Exit codes: 0 imported (gate passed), 1 gate failed, 2 usage / parse error.
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { read, render, slug } = require("./import/collection");

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const arg = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? null;
const flag = (n) => args.includes(`--${n}`);

if (flag("help") || args.includes("-h")) {
  require("./_help").printHelp({
    name: "import-collection",
    description: "Import a Postman v2.1 collection, a Bruno folder or curl commands into a client (service + api/ + flow/ scenarios)",
    usage: "node bin/import-collection.js --from=<file|dir> --client=<name> [options]",
    flags: [
      { flag: "--from=<path>", description: "Postman collection (.json), Bruno collection folder, or a file with curl commands (# comment = request name)" },
      { flag: "--client=<name>", description: "Existing client under clients/ (create it with bin/create-client.sh)" },
      { flag: "--name=<name>", description: "Name for the service and scenarios (default: collection name)" },
      { flag: "--env-prefix=<P_>", description: "Prefix of the env vars that carry variables and secrets (default: <CLIENT>_)" },
      { flag: "--bruno-env=<name>", description: "Bruno environment to read variables from (environments/<name>.bru)" },
      { flag: "--dry-run", description: "Print the parsed collection and the files it would write; write nothing" },
      { flag: "--force", description: "Overwrite files this importer generated before" },
      { flag: "--no-validate", description: "Skip the generation gate (not recommended)" },
      { flag: "--help, -h", description: "Show this help and exit" },
    ],
    examples: [
      "node bin/import-collection.js --from=collections/shop.postman_collection.json --client=shop",
      "node bin/import-collection.js --from=collections/shop-bruno --bruno-env=staging --client=shop --dry-run",
      "node bin/import-collection.js --from=collections/shop.curl.sh --client=shop --name=checkout",
    ],
  });
  process.exit(0);
}

function fail(msg, code = 2) {
  console.error(`import-collection: ${msg}`);
  process.exit(code);
}

const from = arg("from");
const client = arg("client");
if (!from || !client) fail("--from y --client son obligatorios (ver --help)");
if (!/^[A-Za-z0-9_-]+$/.test(client)) fail(`nombre de cliente inválido: ${client}`);
const clientDir = path.join(ROOT, "clients", client);
if (!fs.existsSync(path.join(clientDir, "scenarios"))) fail(`no existe clients/${client}/scenarios (crea el cliente con bin/create-client.sh)`);

let ir;
try {
  ir = read(path.resolve(from), { brunoEnv: arg("bruno-env") });
} catch (e) {
  fail(e.message);
}
const name = arg("name") || ir.name;
const envPrefix = arg("env-prefix") ?? `${client.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}_`;
const out = render(ir, { client, name, envPrefix, source: from });

const summary = {
  collection: ir.name, name: slug(name), requests: ir.requests.map((r) => `${r.method} ${r.path}`),
  files: Object.keys(out.files).map((f) => `clients/${client}/${f}`), secrets_to_export: out.secrets,
  flow_only: out.skipped, warnings: ir.warnings,
};
if (flag("dry-run")) {
  console.log(JSON.stringify({ ...summary, parsed: { ...ir, secrets: [...ir.secrets] } }, null, 2));
  process.exit(0);
}

for (const [rel, code] of Object.entries(out.files)) {
  const target = path.join(clientDir, rel);
  if (!fs.existsSync(target)) continue;
  // --force solo regenera lo que generó este importador; un archivo escrito a mano nunca se pisa
  if (!fs.readFileSync(target, "utf8").includes("Generado por bin/import-collection.js"))
    fail(`${path.relative(ROOT, target)} ya existe y no lo generó este importador: no lo piso (usa otro --name)`);
  if (!flag("force")) fail(`${path.relative(ROOT, target)} ya existe (usa --force para regenerarlo)`);
}
for (const [rel, code] of Object.entries(out.files)) {
  fs.mkdirSync(path.dirname(path.join(clientDir, rel)), { recursive: true });
  fs.writeFileSync(path.join(clientDir, rel), code);
}
console.log(JSON.stringify(summary, null, 2));

if (flag("no-validate")) process.exit(0);
const scenarios = Object.keys(out.files).filter((f) => f.startsWith("scenarios/")).map((f) => path.join("clients", client, f));
const gate = spawnSync(process.execPath, [path.join(__dirname, "validate-generated.js"), "--kind=scenario", ...scenarios, `--client=${client}`],
  { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
process.stdout.write(gate.stdout || "");
process.stderr.write(gate.stderr || "");
if (gate.status !== 0) fail("el gate de generación rechazó los escenarios (arriba el detalle)", 1);
console.log(`\nSiguiente paso: smoke del flow →  ./bin/run-test.sh --client=${client} --scenario=flow/${slug(name)} --profile=smoke`);
if (out.secrets.length) console.log(`Exporta antes: ${out.secrets.join(", ")}`);
