#!/usr/bin/env node
/**
 * T-155: Configuration validation CLI
 *
 * Validates k6 Enterprise Framework client/test configuration files against
 * the JSON Schema defined in src/core/config-validator.ts.
 *
 * Usage:
 *   node bin/validate-config.js --file=config.json
 *   node bin/validate-config.js --file=config.yml
 *   node bin/validate-config.js --example
 *   node bin/validate-config.js --example --format=json
 *   node bin/validate-config.js --convert --format=yaml config.json
 *   node bin/validate-config.js --client=my-team
 *   node bin/validate-config.js --validate-structure --client=my-team
 *   node bin/validate-config.js --help
 *
 * Exit codes:
 *   0  — valid
 *   1  — validation errors or missing required arguments
 */

"use strict";

const fs = require("fs");
const path = require("path");

// ── Dependency loading ────────────────────────────────────────────────────────
// We compile TS to JS via ts-node or use the precompiled output.
// For bin/ scripts we use require() with ts-node/register when available,
// otherwise fall back to a lightweight inline implementation.

let validator, detectFormat, jsonToYaml, yamlToJson, generateExampleConfig;

try {
  // Try ts-node (available during development)
  require("ts-node").register({
    project: path.resolve(__dirname, "../tsconfig.json"),
    transpileOnly: true,
  });
  const mod = require("../src/core/config-validator");
  ({ detectFormat, jsonToYaml, yamlToJson, generateExampleConfig } = mod);
  const { ConfigValidator } = mod;
  validator = new ConfigValidator();
} catch {
  // Fallback: inline lightweight validator using only ajv + ajv-formats + js-yaml
  const Ajv = require("ajv");
  const addFormats = require("ajv-formats");
  const jsYaml = require("js-yaml");

  // Inline the schema (duplicated to avoid ts-node dependency at runtime)
  const CONFIG_SCHEMA = require("./validate-config-schema.json");

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const ajvValidate = ajv.compile(CONFIG_SCHEMA);

  detectFormat = (raw) => {
    const t = raw.trimStart();
    return t.startsWith("{") || t.startsWith("[") ? "json" : "yaml";
  };

  jsonToYaml = (jsonStr) => {
    return jsYaml.dump(JSON.parse(jsonStr), { indent: 2, lineWidth: 120, noRefs: true });
  };

  yamlToJson = (yamlStr, pretty = true) => {
    const obj = jsYaml.load(yamlStr, { schema: jsYaml.CORE_SCHEMA });
    return JSON.stringify(obj, null, pretty ? 2 : 0);
  };

  generateExampleConfig = (format = "yaml") => {
    const example = {
      client: "my-team",
      version: "1.0.0",
      description: "Example k6 Enterprise Framework configuration",
      environment: "staging",
      baseUrl: "https://api.example.com",
      endpoints: { api: { baseUrl: "https://api.example.com", timeout: "30s" } },
      auth: { type: "bearer", tokenEnvVar: "APP_API_TOKEN" },
      thresholds: {
        http_req_duration: ["p(95)<500", "p(99)<1000"],
        http_req_failed: ["rate<0.01"],
      },
      scenarios: {
        default: {
          executor: "ramping-vus",
          startVUs: 0,
          stages: [
            { duration: "1m", target: 10 },
            { duration: "3m", target: 10 },
            { duration: "1m", target: 0 },
          ],
        },
      },
      tags: { team: "platform" },
    };
    if (format === "json") return JSON.stringify(example, null, 2);

    // T-173: Annotated YAML with inline comments per field
    return [
      "# k6 Enterprise Framework — Example Configuration",
      "# Validate: node bin/validate-config.js --file=this-file.yml",
      "# Convert:  node bin/validate-config.js --convert --format=json this-file.yml",
      "",
      "# Required: client name — must match clients/<name>/ directory",
      "client: my-team",
      "",
      "# Optional: semver for your client config",
      "version: 1.0.0",
      "",
      "# Optional: human-readable description shown in reports",
      "description: Example k6 Enterprise Framework configuration",
      "",
      "# Required: target environment (maps to env-specific base URLs)",
      "environment: staging",
      "",
      "# Required: base URL of the service under test. Supports ${ENV_VAR} syntax.",
      "baseUrl: https://api.example.com",
      "",
      "# Optional: named endpoint groups for multi-service tests",
      "endpoints:",
      "  api:",
      "    baseUrl: https://api.example.com",
      "    timeout: 30s   # request timeout (ms|s|m|h)",
      "",
      "# Optional: authentication configuration",
      "auth:",
      "  type: bearer             # one of: none, bearer, basic, api-key",
      "  tokenEnvVar: APP_API_TOKEN  # env var containing the token (never hardcode)",
      "",
      "# Optional: k6 threshold expressions. Tests FAIL if any threshold is breached.",
      "thresholds:",
      "  http_req_duration:       # p95 < 500ms, p99 < 1000ms",
      '    - "p(95)<500"',
      '    - "p(99)<1000"',
      "  http_req_failed:         # error rate < 1%",
      '    - "rate<0.01"',
      "",
      "# Required: k6 scenario definitions (at least one named 'default')",
      "scenarios:",
      "  default:",
      "    executor: ramping-vus  # one of: constant-vus, ramping-vus, constant-arrival-rate, ...",
      "    startVUs: 0",
      "    stages:",
      "      - duration: 1m       # ramp up to 10 VUs over 1 minute",
      "        target: 10",
      "      - duration: 3m       # hold at 10 VUs for 3 minutes",
      "        target: 10",
      "      - duration: 1m       # ramp down to 0",
      "        target: 0",
      "",
      "# Optional: tags applied to all k6 metrics (visible in Grafana/Prometheus)",
      "tags:",
      "  team: platform",
    ].join("\n");
  };

  const ENV_VAR_PATTERN = /\$\{([^}]+)\}/g;
  function resolveEnvVars(obj, missing) {
    if (typeof obj === "string") {
      return obj.replace(ENV_VAR_PATTERN, (_, name) => {
        const val = process.env[name];
        if (val === undefined) missing.add(name);
        return val !== undefined ? val : `\${${name}}`;
      });
    }
    if (Array.isArray(obj)) return obj.map((i) => resolveEnvVars(i, missing));
    if (obj !== null && typeof obj === "object") {
      const r = {};
      for (const [k, v] of Object.entries(obj)) r[k] = resolveEnvVars(v, missing);
      return r;
    }
    return obj;
  }

  validator = {
    validateFile(filePath) {
      let raw;
      try {
        raw = fs.readFileSync(filePath, "utf-8");
      } catch (err) {
        return {
          valid: false,
          errors: [{ path: "/", message: `Cannot read file: ${err.message}` }],
        };
      }
      return this.validateString(raw);
    },
    validateString(raw) {
      let parsed;
      const fmt = detectFormat(raw);
      try {
        parsed =
          fmt === "yaml" ? jsYaml.load(raw, { schema: jsYaml.CORE_SCHEMA }) : JSON.parse(raw);
      } catch (err) {
        return { valid: false, errors: [{ path: "/", message: `Parse error: ${err.message}` }] };
      }
      const missing = new Set();
      const resolved = resolveEnvVars(parsed, missing);
      if (missing.size > 0) {
        return {
          valid: false,
          errors: [
            { path: "/", message: `Missing environment variables: ${[...missing].join(", ")}` },
          ],
          missingVars: [...missing],
        };
      }
      const valid = ajvValidate(resolved);
      if (valid) return { valid: true, errors: [] };
      return {
        valid: false,
        errors: (ajvValidate.errors || []).map((e) => ({
          path: e.instancePath || "/",
          message: `"${e.instancePath || "/"}": ${e.message}`,
          actual: e.data,
        })),
      };
    },
  };
}

// ── CLI argument parsing ───────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(name) {
  const prefix = `--${name}=`;
  const match = args.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

function showHelp() {
  require("./_help").printHelp({
    name: "validate-config",
    description: "Validate k6 client/test configuration files against the JSON Schema (T-155)",
    usage:
      "node bin/validate-config.js (--file=<path> | --client=<name> | --example | --convert) [options]",
    flags: [
      {
        flag: "--file=<path>",
        description: "Path to config file (auto-detects JSON/YAML by content)",
      },
      { flag: "--client=<name>", description: "Shorthand: validates clients/<name>/config.json" },
      {
        flag: "--validate-structure",
        description: "Check client directory structure (use with --client)",
      },
      { flag: "--format=<fmt>", description: "Output format: json | yaml (default: yaml)" },
      { flag: "--example", description: "Generate and print a valid example configuration" },
      {
        flag: "--convert",
        description: "Convert a config file between formats (requires a file arg)",
      },
      { flag: "--help, -h", description: "Show this help and exit" },
    ],
    examples: [
      "node bin/validate-config.js --client=my-team",
      "node bin/validate-config.js --validate-structure --client=my-team",
      "node bin/validate-config.js --example --format=yaml > clients/new-team/config.yml",
    ],
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

// ── Structure validator (T-167 criterion 8) ───────────────────────────────────

function validateClientStructure(clientName) {
  const projectRoot = path.resolve(__dirname, "..");
  const clientDir = path.join(projectRoot, "clients", clientName);

  if (!fs.existsSync(clientDir)) {
    console.error(`[validate-config] ✗ Client '${clientName}' not found at: ${clientDir}`);
    console.error(`  Run: node bin/generate.js --product-layer`);
    process.exit(1);
  }

  // Required directories
  const requiredDirs = ["config", "lib/services", "lib/factories", "scenarios"];

  // Required files
  const requiredFiles = [
    { path: "config/default.json", description: "default configuration" },
    { path: "README.md", description: "client README" },
  ];

  // Optional but recommended
  const recommendedDirs = ["data", "scenarios/api"];

  const issues = [];
  const warnings = [];
  const ok = [];

  for (const d of requiredDirs) {
    const full = path.join(clientDir, d);
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
      ok.push(`Dir  ${d}/`);
    } else {
      issues.push(`Missing required directory: ${d}/`);
    }
  }

  for (const f of requiredFiles) {
    const full = path.join(clientDir, f.path);
    if (fs.existsSync(full)) {
      ok.push(`File ${f.path}`);
    } else {
      issues.push(`Missing required file: ${f.path} (${f.description})`);
    }
  }

  for (const d of recommendedDirs) {
    const full = path.join(clientDir, d);
    if (!fs.existsSync(full)) {
      warnings.push(`Recommended directory missing: ${d}/  (run generate.js to create)`);
    }
  }

  // Check for at least one scenario file
  const scenariosDir = path.join(clientDir, "scenarios");
  let scenarioCount = 0;
  if (fs.existsSync(scenariosDir)) {
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith(".ts")) scenarioCount++;
      }
    };
    walk(scenariosDir);
  }
  if (scenarioCount === 0) {
    issues.push("No scenario .ts files found in scenarios/");
  } else {
    ok.push(`Scenarios: ${scenarioCount} .ts file${scenarioCount > 1 ? "s" : ""}`);
  }

  // Check for at least one service file
  const servicesDir = path.join(clientDir, "lib/services");
  let serviceCount = 0;
  if (fs.existsSync(servicesDir)) {
    serviceCount = fs.readdirSync(servicesDir).filter((f) => f.endsWith(".ts")).length;
  }
  if (serviceCount === 0) {
    warnings.push("No service .ts files found in lib/services/");
  } else {
    ok.push(`Services: ${serviceCount} .ts file${serviceCount > 1 ? "s" : ""}`);
  }

  // Print results
  console.log(`\n[validate-config] Structure check: clients/${clientName}/\n`);

  for (const msg of ok) {
    console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
  }
  for (const msg of warnings) {
    console.log(`  \x1b[33m⚠\x1b[0m ${msg}`);
  }
  for (const msg of issues) {
    console.error(`  \x1b[31m✗\x1b[0m ${msg}`);
  }

  console.log("");

  if (issues.length > 0) {
    console.error(`[validate-config] ✗ Structure invalid — ${issues.length} issue(s) found.`);
    console.error(`  Fix with: node bin/generate.js --product-layer`);
    process.exit(1);
  } else if (warnings.length > 0) {
    console.log(
      `[validate-config] ✓ Structure OK — ${warnings.length} warning(s). ${ok.length} checks passed.`
    );
    process.exit(0);
  } else {
    console.log(`[validate-config] ✓ Structure valid — ${ok.length} checks passed. All OK.`);
    process.exit(0);
  }
}

function main() {
  if (hasFlag("help") || args.includes("-h")) {
    showHelp();
    process.exit(0);
  }

  // --validate-structure: check client directory layout (T-167 criterion 8)
  if (hasFlag("validate-structure")) {
    const clientName = getArg("client");
    if (!clientName) {
      console.error("[validate-config] --validate-structure requires --client=<name>.");
      console.error("  Example: node bin/validate-config.js --validate-structure --client=my-team");
      process.exit(1);
    }
    validateClientStructure(clientName);
    return;
  }

  const format = (getArg("format") || "yaml").toLowerCase();
  if (format !== "json" && format !== "yaml") {
    console.error(`[validate-config] Unknown format: ${format}. Use json or yaml.`);
    process.exit(1);
  }

  // --example: generate and print a valid example config
  if (hasFlag("example")) {
    process.stdout.write(generateExampleConfig(format) + "\n");
    process.exit(0);
  }

  // --convert: convert a config file between formats
  if (hasFlag("convert")) {
    const filePath = getArg("file") || args.find((a) => !a.startsWith("--"));
    if (!filePath) {
      console.error(
        "[validate-config] --convert requires a file path. Use --file=<path> or pass as positional argument."
      );
      console.error(
        "  Example: node bin/validate-config.js --convert --format=yaml clients/my-team/config.json"
      );
      process.exit(1);
    }

    let raw;
    try {
      raw = fs.readFileSync(filePath, "utf-8");
    } catch (err) {
      console.error(`[validate-config] Cannot read file '${filePath}': ${err.message}`);
      process.exit(1);
    }

    const srcFormat = detectFormat(raw);
    try {
      if (format === "yaml") {
        const output = srcFormat === "json" ? jsonToYaml(raw) : raw;
        process.stdout.write(output);
      } else {
        const output = srcFormat === "yaml" ? yamlToJson(raw) : raw;
        process.stdout.write(output + "\n");
      }
    } catch (err) {
      console.error(`[validate-config] Conversion failed: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // --file or --client: validate a config file
  let filePath = getArg("file");
  const clientName = getArg("client");

  if (clientName && !filePath) {
    // Resolve clients/<name>/config.json relative to project root
    const projectRoot = path.resolve(__dirname, "..");
    const candidates = [
      path.join(projectRoot, "clients", clientName, "config.json"),
      path.join(projectRoot, "clients", clientName, "config.yml"),
      path.join(projectRoot, "clients", clientName, "config.yaml"),
    ];
    filePath = candidates.find((c) => fs.existsSync(c)) || candidates[0];
  }

  if (!filePath) {
    console.error(
      "[validate-config] No file specified. Use --file=<path>, --client=<name>, --example, or --convert."
    );
    console.error("  Run with --help for usage.");
    process.exit(1);
  }

  const absPath = path.resolve(filePath);
  console.log(`[validate-config] Validating: ${absPath}`);

  const result = validator.validateFile(absPath);

  // Count scenarios and thresholds from the parsed file for success message
  let scenarioCount = 0;
  let thresholdCount = 0;
  try {
    const raw = fs.readFileSync(absPath, "utf-8");
    const parsed =
      detectFormat(raw) === "yaml"
        ? (() => {
            try {
              // T-128: Always use CORE_SCHEMA — rejects !!js/function, !!python/object, etc.
              return require("js-yaml").load(raw, { schema: require("js-yaml").CORE_SCHEMA });
            } catch {
              return {};
            }
          })()
        : (() => {
            try {
              return JSON.parse(raw);
            } catch {
              return {};
            }
          })();
    scenarioCount = parsed.scenarios ? Object.keys(parsed.scenarios).length : 0;
    thresholdCount = parsed.thresholds ? Object.keys(parsed.thresholds).length : 0;
  } catch {
    /* ignore — just for display */
  }

  if (result.valid) {
    const fileExt = path.extname(absPath).slice(1).toUpperCase() || "CONFIG";
    const details = [];
    if (scenarioCount > 0) details.push(`${scenarioCount} scenario${scenarioCount > 1 ? "s" : ""}`);
    if (thresholdCount > 0)
      details.push(`${thresholdCount} threshold${thresholdCount > 1 ? "s" : ""}`);
    const detailStr = details.length > 0 ? ` — ${details.join(", ")}` : "";
    console.log(
      `[validate-config] ✓ Validated: ${path.basename(absPath)} (${fileExt})${detailStr}. All OK.`
    );
    process.exit(0);
  }

  console.error(`[validate-config] ✗ Validation failed — ${result.errors.length} error(s):\n`);

  // T-173: Typo suggestions for common field name mistakes
  const TYPO_SUGGESTIONS = {
    header: "headers",
    Header: "headers",
    baseurl: "baseUrl",
    base_url: "baseUrl",
    threshhold: "thresholds",
    treshold: "thresholds",
    scenaro: "scenarios",
    scneario: "scenarios",
    environemnt: "environment",
    enviroment: "environment",
    cliant: "client",
    versoin: "version",
  };

  for (const err of result.errors) {
    console.error(`  ${err.message}`);
    // Suggest typo fix if field name looks like a known mistake
    const pathParts = (err.path || "").split("/");
    const lastPart = pathParts[pathParts.length - 1];
    if (TYPO_SUGGESTIONS[lastPart]) {
      console.error(`    Did you mean '${TYPO_SUGGESTIONS[lastPart]}'? (common typo)`);
    }
    if (err.expected !== undefined) {
      console.error(`    Expected : ${err.expected}`);
    }
    if (err.actual !== undefined) {
      console.error(`    Actual   : ${JSON.stringify(err.actual)}`);
    }
  }

  // T-173: list ALL missing env vars at once, not just first
  if (result.missingVars && result.missingVars.length > 0) {
    console.error(`\n  Missing environment variables: ${result.missingVars.join(", ")}`);
    console.error("  Set these before running:");
    result.missingVars.forEach((v) => console.error(`    export ${v}=<value>`));
    console.error("  Or add them to your .env file.");
  }

  process.exit(1);
}

main();
