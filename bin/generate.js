#!/usr/bin/env node
/**
 * T-059: Interactive generator (bin/generate.js)
 *
 * Guides the user step-by-step to create framework artifacts:
 *   - client   : full client structure with config, scenarios, lib, README
 *   - test     : k6 scenario file from template
 *   - service  : service object class in lib/services/
 *   - factory  : data factory class in lib/factories/
 *
 * Usage: node bin/generate.js
 *
 * Note: Uses Node.js readline (no external deps) for interactive prompts.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const ROOT_DIR = path.resolve(__dirname, "..");
const CLIENTS_DIR = path.join(ROOT_DIR, "clients");
const TEMPLATES_DIR = path.join(ROOT_DIR, "shared", "templates", "generators");

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  require("./_help").printHelp({
    name: "generate",
    description:
      "Interactive generator for framework artifacts: client, test, service, factory (T-059)",
    usage: "node bin/generate.js",
    flags: [{ flag: "--help, -h", description: "Show this help and exit" }],
    examples: [
      "node bin/generate.js",
      "# When prompted: choose 1) client / 2) test / 3) service / 4) factory",
    ],
  });
  process.exit(0);
}

// ── Readline helpers ──────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question, defaultVal) {
  return new Promise((resolve) => {
    const prompt = defaultVal ? `${question} [${defaultVal}]: ` : `${question}: `;
    rl.question(prompt, (answer) => resolve(answer.trim() || defaultVal || ""));
  });
}

function askChoice(question, choices) {
  return new Promise((resolve) => {
    console.log(`\n${question}`);
    choices.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
    rl.question("Choice [1]: ", (answer) => {
      const idx = parseInt(answer.trim(), 10) - 1;
      resolve(choices[Math.max(0, Math.min(idx, choices.length - 1))] ?? choices[0]);
    });
  });
}

// ── Validation ────────────────────────────────────────────────────────────────

const NAME_RE = /^[a-zA-Z0-9_-]+$/;

function validateName(name, label) {
  if (!name) return `${label} name is required.`;
  if (!NAME_RE.test(name))
    return `${label} name can only contain letters, numbers, hyphens and underscores.`;
  return null;
}

function toPascalCase(str) {
  return str
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

// ── Template engine ───────────────────────────────────────────────────────────

function applyTemplate(content, vars) {
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v),
    content
  );
}

function readTemplate(filename) {
  return fs.readFileSync(path.join(TEMPLATES_DIR, filename), "utf-8");
}

// ── Generators ────────────────────────────────────────────────────────────────

async function generateClient() {
  console.log("\n── Generate Client ──────────────────────────────────");

  const name = await ask("Client name (e.g. my-team)");
  const nameErr = validateName(name, "Client");
  if (nameErr) {
    console.error("Error:", nameErr);
    return;
  }

  const clientDir = path.join(CLIENTS_DIR, name);
  if (fs.existsSync(clientDir)) {
    const overwrite = await ask(`Client '${name}' already exists. Overwrite? (y/N)`, "N");
    if (overwrite.toLowerCase() !== "y") {
      console.log("Aborted.");
      return;
    }
  }

  const description = await ask("Description", `${name} load tests`);
  const serviceName = await ask("Default service name (e.g. users)", "api");

  // Create structure
  const dirs = [
    `config`,
    `data`,
    `lib/services`,
    `lib/factories`,
    `scenarios/api`,
    `scenarios/integration`,
    `scenarios/mixed`,
  ];
  for (const d of dirs) fs.mkdirSync(path.join(clientDir, d), { recursive: true });

  const vars = {
    CLIENT_NAME: name,
    CLIENT_DESCRIPTION: description,
    SERVICE_NAME: serviceName,
    SERVICE_CLASS_NAME: toPascalCase(serviceName),
  };

  // Config files
  const defaultCfg = applyTemplate(readTemplate("client-default.json"), vars);
  fs.writeFileSync(path.join(clientDir, "config/default.json"), defaultCfg);

  const stagingCfg = JSON.stringify({ ...JSON.parse(defaultCfg), environment: "staging" }, null, 2);
  fs.writeFileSync(path.join(clientDir, "config/staging.json"), stagingCfg);

  const prodCfg = JSON.stringify({ ...JSON.parse(defaultCfg), environment: "production" }, null, 2);
  fs.writeFileSync(path.join(clientDir, "config/production.json"), prodCfg);

  // Example scenario
  const scenario = applyTemplate(readTemplate("scenario-api.ts"), {
    ...vars,
    SCENARIO_NAME: `smoke-${serviceName}`,
  });
  fs.writeFileSync(path.join(clientDir, `scenarios/api/smoke-${serviceName}.ts`), scenario);

  // Service and factory
  const serviceVars = { ...vars, FACTORY_CLASS_NAME: toPascalCase(name) };
  fs.writeFileSync(
    path.join(clientDir, `lib/services/${serviceName}.service.ts`),
    applyTemplate(readTemplate("service.ts"), vars)
  );
  fs.writeFileSync(
    path.join(clientDir, `lib/factories/${name}.factory.ts`),
    applyTemplate(readTemplate("factory.ts"), serviceVars)
  );

  // README
  fs.writeFileSync(
    path.join(clientDir, "README.md"),
    applyTemplate(readTemplate("client-readme.md"), vars)
  );

  console.log(`\n✓ Client '${name}' created at clients/${name}/`);
  console.log(`\nNext steps:`);
  console.log(`  1. Edit clients/${name}/config/default.json (set BASE_URL)`);
  console.log(`  2. npm run build`);
  console.log(`  3. ./bin/run-test.sh --client=${name} --scenario=api/smoke-${serviceName}`);
}

async function generateTest() {
  console.log("\n── Generate Test ────────────────────────────────────");

  const clients = fs
    .readdirSync(CLIENTS_DIR)
    .filter((d) => fs.statSync(path.join(CLIENTS_DIR, d)).isDirectory() && !d.startsWith("_"));
  if (clients.length === 0) {
    console.error("No clients found. Run 'generate client' first.");
    return;
  }

  const clientName = await askChoice("Select client:", clients);
  const testName = await ask("Scenario name (e.g. smoke-orders)");
  const nameErr = validateName(testName, "Scenario");
  if (nameErr) {
    console.error("Error:", nameErr);
    return;
  }

  const testType = await askChoice("Test type:", ["api", "integration", "mixed"]);
  const serviceName = await ask("Service name", "api");

  const outDir = path.join(CLIENTS_DIR, clientName, "scenarios", testType);
  fs.mkdirSync(outDir, { recursive: true });

  const outFile = path.join(outDir, `${testName}.ts`);
  if (fs.existsSync(outFile)) {
    const ow = await ask(`${testName}.ts already exists. Overwrite? (y/N)`, "N");
    if (ow.toLowerCase() !== "y") {
      console.log("Aborted.");
      return;
    }
  }

  const vars = {
    CLIENT_NAME: clientName,
    SERVICE_NAME: serviceName,
    SCENARIO_NAME: testName,
    SERVICE_CLASS_NAME: toPascalCase(serviceName),
  };
  const templateFile = testType === "api" ? "scenario-api.ts" : "scenario-api.ts";
  fs.writeFileSync(outFile, applyTemplate(readTemplate(templateFile), vars));

  console.log(`\n✓ Scenario created: clients/${clientName}/scenarios/${testType}/${testName}.ts`);
  console.log(`  Run: ./bin/run-test.sh --client=${clientName} --scenario=${testType}/${testName}`);
}

async function generateService() {
  console.log("\n── Generate Service ─────────────────────────────────");

  const clients = fs
    .readdirSync(CLIENTS_DIR)
    .filter((d) => fs.statSync(path.join(CLIENTS_DIR, d)).isDirectory() && !d.startsWith("_"));
  const clientName = await askChoice("Select client:", clients);
  const serviceName = await ask("Service name (e.g. payments)");
  const nameErr = validateName(serviceName, "Service");
  if (nameErr) {
    console.error("Error:", nameErr);
    return;
  }

  const outDir = path.join(CLIENTS_DIR, clientName, "lib", "services");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${serviceName}.service.ts`);

  const vars = {
    CLIENT_NAME: clientName,
    SERVICE_NAME: serviceName,
    SERVICE_CLASS_NAME: toPascalCase(serviceName),
  };
  fs.writeFileSync(outFile, applyTemplate(readTemplate("service.ts"), vars));

  console.log(`\n✓ Service created: clients/${clientName}/lib/services/${serviceName}.service.ts`);
}

async function generateFactory() {
  console.log("\n── Generate Data Factory ────────────────────────────");

  const clients = fs
    .readdirSync(CLIENTS_DIR)
    .filter((d) => fs.statSync(path.join(CLIENTS_DIR, d)).isDirectory() && !d.startsWith("_"));
  const clientName = await askChoice("Select client:", clients);
  const factoryName = await ask("Factory name (e.g. order)");
  const nameErr = validateName(factoryName, "Factory");
  if (nameErr) {
    console.error("Error:", nameErr);
    return;
  }

  const outDir = path.join(CLIENTS_DIR, clientName, "lib", "factories");
  fs.mkdirSync(outDir, { recursive: true });

  const vars = {
    CLIENT_NAME: clientName,
    SERVICE_NAME: factoryName,
    FACTORY_CLASS_NAME: toPascalCase(factoryName),
  };
  fs.writeFileSync(
    path.join(outDir, `${factoryName}.factory.ts`),
    applyTemplate(readTemplate("factory.ts"), vars)
  );

  console.log(`\n✓ Factory created: clients/${clientName}/lib/factories/${factoryName}.factory.ts`);
}

// ── Product Layer wizard (T-167) ──────────────────────────────────────────────

const CLIENT_NAME_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

async function askValidated(label, defaultVal, validate) {
  while (true) {
    const prompt = defaultVal ? `${label} [${defaultVal}]: ` : `${label}: `;
    const raw = await new Promise((resolve) => rl.question(prompt, (ans) => resolve(ans.trim())));
    const value = raw || defaultVal || "";
    const err = validate ? validate(value) : null;
    if (err) {
      console.error(`  \x1b[31m✗ ${err}\x1b[0m`);
    } else {
      return value;
    }
  }
}

async function generateProductLayer() {
  console.log("\n╔═════════════════════════════════════════════════════╗");
  console.log("║   k6 Enterprise — Product Layer Setup Wizard        ║");
  console.log("║   (creates a full client + product structure)       ║");
  console.log("╚═════════════════════════════════════════════════════╝");
  console.log("\nAnswer a few questions to scaffold your test suite.\n");

  // Step 1 — Client / team name
  const clientName = await askValidated("Client name (lowercase, no spaces)", "my-team", (v) => {
    if (!v) return "Client name is required.";
    if (!CLIENT_NAME_RE.test(v))
      return "Use lowercase letters, numbers, and hyphens only. Must not start or end with a hyphen.";
    return null;
  });

  // Step 2 — Description
  const description = await askValidated(
    "Short description",
    `${clientName} performance tests`,
    (v) => (!v ? "Description is required." : null)
  );

  // Step 3 — Base URL
  const baseUrl = await askValidated(
    "Base URL (can use env var like ${BASE_URL})",
    "https://api.example.com",
    (v) => (!v ? "Base URL is required." : null)
  );

  // Step 4 — Services (comma-separated)
  const servicesRaw = await askValidated(
    "Services to scaffold (comma-separated, e.g. users,orders,payments)",
    "api",
    (v) => {
      if (!v) return "At least one service is required.";
      const parts = v.split(",").map((s) => s.trim());
      for (const p of parts) {
        if (!/^[a-zA-Z0-9_-]+$/.test(p))
          return `Invalid service name: '${p}'. Use letters, numbers, hyphens, underscores.`;
      }
      return null;
    }
  );
  const services = servicesRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Step 5 — Default load profile
  const profiles = [
    "smoke    — minimal load, sanity check (1-2 VUs, 1 min)",
    "load     — realistic steady-state (10-50 VUs, 5 min)",
    "stress   — above-normal load (100+ VUs, 10 min)",
    "soak     — extended duration (20 VUs, 2+ hours)",
    "spike    — sudden burst (0→500 VUs instantly)",
  ];
  const profileChoice = await askChoice("Default load profile:", profiles);
  const defaultProfile = profileChoice.split(" ")[0];

  // Step 6 — Test types
  const testTypeChoices = ["api", "integration", "mixed", "browser"];
  console.log("\nTest types to scaffold (space-separated numbers, e.g. 1 2):");
  testTypeChoices.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
  const testTypesRaw = await new Promise((resolve) =>
    rl.question("Types [1 2]: ", (ans) => resolve(ans.trim() || "1 2"))
  );
  const selectedTestTypes = testTypesRaw
    .split(/\s+/)
    .map((n) => parseInt(n, 10) - 1)
    .filter((i) => i >= 0 && i < testTypeChoices.length)
    .map((i) => testTypeChoices[i]);
  const testTypes = selectedTestTypes.length > 0 ? selectedTestTypes : ["api"];

  // Step 7 — Team tag
  const teamTag = await askValidated("Team tag (for k6 metrics labeling)", clientName, (v) =>
    !v ? "Team tag is required." : null
  );

  // ── Scaffold ──────────────────────────────────────────────────────────────

  console.log(`\n\x1b[36mScaffolding product layer for '${clientName}'...\x1b[0m`);

  const clientDir = path.join(CLIENTS_DIR, clientName);
  if (fs.existsSync(clientDir)) {
    const ow = await askValidated(
      `Client '${clientName}' already exists. Overwrite? (y/N)`,
      "N",
      () => null
    );
    if (ow.toLowerCase() !== "y") {
      console.log("Aborted.");
      return;
    }
  }

  // Base dirs
  const baseDirs = ["config", "data", "lib/services", "lib/factories"];
  for (const tt of testTypes) baseDirs.push(`scenarios/${tt}`);
  for (const d of baseDirs) fs.mkdirSync(path.join(clientDir, d), { recursive: true });

  const createdFiles = [];

  // Config files
  const cfgBase = {
    client: clientName,
    version: "1.0.0",
    description,
    environment: "default",
    baseUrl,
    auth: { type: "none" },
    thresholds: {
      http_req_duration: ["p(95)<500", "p(99)<1000"],
      http_req_failed: ["rate<0.01"],
    },
    scenarios: {},
    tags: { team: teamTag },
  };

  // Add a scenario block per service × test type
  for (const svc of services) {
    for (const tt of testTypes) {
      const scenarioKey = `${svc}-${tt}-${defaultProfile}`;
      cfgBase.scenarios[scenarioKey] = {
        executor: "ramping-vus",
        startVUs: 0,
        stages: [
          { duration: "30s", target: 5 },
          { duration: "2m", target: 10 },
          { duration: "30s", target: 0 },
        ],
        tags: { service: svc, testType: tt },
      };
    }
  }

  const cfgPath = path.join(clientDir, "config/default.json");
  fs.writeFileSync(cfgPath, JSON.stringify(cfgBase, null, 2));
  createdFiles.push(`clients/${clientName}/config/default.json`);

  // Staging/prod variants
  for (const env of ["staging", "production"]) {
    const envCfg = { ...cfgBase, environment: env, baseUrl: `\${BASE_URL_${env.toUpperCase()}}` };
    const envPath = path.join(clientDir, `config/${env}.json`);
    fs.writeFileSync(envPath, JSON.stringify(envCfg, null, 2));
    createdFiles.push(`clients/${clientName}/config/${env}.json`);
  }

  // Services
  for (const svc of services) {
    const svcClass = toPascalCase(svc);
    const svcContent = `/**
 * ${svcClass}Service — ${clientName}
 * Auto-generated by generate.js product-layer wizard
 */

import http from "k6/http";
import { check } from "k6";
import { RefinedParams } from "../../../../src/core/types";

export class ${svcClass}Service {
  private readonly baseUrl: string;
  private readonly params: RefinedParams;

  constructor(baseUrl: string, params: RefinedParams = {}) {
    this.baseUrl = baseUrl;
    this.params = params;
  }

  list(endpoint = "/${svc}"): boolean {
    const res = http.get(\`\${this.baseUrl}\${endpoint}\`, this.params);
    return check(res, {
      "${svc} list: status 200": (r) => r.status === 200,
    });
  }

  create(payload: Record<string, unknown>, endpoint = "/${svc}"): boolean {
    const res = http.post(\`\${this.baseUrl}\${endpoint}\`, JSON.stringify(payload), {
      ...this.params,
      headers: { "Content-Type": "application/json", ...(this.params as Record<string, unknown>).headers as Record<string,string> },
    });
    return check(res, {
      "${svc} create: status 201": (r) => r.status === 201,
    });
  }
}
`;
    const svcPath = path.join(clientDir, `lib/services/${svc}.service.ts`);
    fs.writeFileSync(svcPath, svcContent);
    createdFiles.push(`clients/${clientName}/lib/services/${svc}.service.ts`);
  }

  // Factories
  for (const svc of services) {
    const factClass = toPascalCase(svc);
    const factContent = `/**
 * ${factClass}Factory — ${clientName}
 * Auto-generated by generate.js product-layer wizard
 */

export class ${factClass}Factory {
  static build(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: Math.floor(Math.random() * 100000),
      name: \`test-${svc}-\${Date.now()}\`,
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  static buildMany(count: number, overrides: Record<string, unknown> = {}): Record<string, unknown>[] {
    return Array.from({ length: count }, () => ${factClass}Factory.build(overrides));
  }
}
`;
    const factPath = path.join(clientDir, `lib/factories/${svc}.factory.ts`);
    fs.writeFileSync(factPath, factContent);
    createdFiles.push(`clients/${clientName}/lib/factories/${svc}.factory.ts`);
  }

  // Scenario files
  for (const tt of testTypes) {
    for (const svc of services) {
      const scenName = `${defaultProfile}-${svc}`;
      const svcClass = toPascalCase(svc);
      const scenContent = `/**
 * ${scenName} — ${tt} — ${clientName}
 * Auto-generated by generate.js product-layer wizard
 * Profile: ${defaultProfile}
 */

import { sleep } from "k6";
import { ${svcClass}Service } from "../../lib/services/${svc}.service";
import { ${svcClass}Factory } from "../../lib/factories/${svc}.factory";

export const options = {
  scenarios: {
    "${scenName}": {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 5 },
        { duration: "2m", target: 10 },
        { duration: "30s", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<500", "p(99)<1000"],
    http_req_failed: ["rate<0.01"],
  },
  tags: { team: "${teamTag}", service: "${svc}", testType: "${tt}" },
};

const BASE_URL = __ENV.BASE_URL || "${baseUrl}";

export default function () {
  const svc = new ${svcClass}Service(BASE_URL);
  svc.list();
  sleep(1);
}
`;
      const scenPath = path.join(clientDir, `scenarios/${tt}/${scenName}.ts`);
      fs.writeFileSync(scenPath, scenContent);
      createdFiles.push(`clients/${clientName}/scenarios/${tt}/${scenName}.ts`);
    }
  }

  // README
  const readmeContent = `# ${clientName}

${description}

## Structure

\`\`\`
clients/${clientName}/
├── config/           # Environment configs (default, staging, production)
├── data/             # Test data fixtures
├── lib/
│   ├── services/     # Service client classes
│   └── factories/    # Data factory classes
└── scenarios/        # k6 test scenarios
${testTypes.map((t) => `    └── ${t}/`).join("\n")}
\`\`\`

## Services

${services.map((s) => `- **${toPascalCase(s)}Service** (\`lib/services/${s}.service.ts\`)`).join("\n")}

## Quick Start

\`\`\`bash
# Validate configuration
node bin/validate-config.js --client=${clientName}

# Build TypeScript
npm run build

# Run smoke test (first service, ${testTypes[0]} scenarios)
./bin/run-test.sh --client=${clientName} --scenario=${testTypes[0]}/${defaultProfile}-${services[0]} --profile=${defaultProfile}
\`\`\`

## Load Profiles

| Profile | VUs | Duration | Purpose |
|---------|-----|----------|---------|
| smoke   | 1-2 | 1 min    | Sanity check |
| load    | 10-50 | 5 min  | Realistic load |
| stress  | 100+ | 10 min  | Peak capacity |
| soak    | 20  | 2+ hours | Stability |
| spike   | 0→500 | 1 min  | Traffic burst |

## Tags

Team: \`${teamTag}\`
`;
  const readmePath = path.join(clientDir, "README.md");
  fs.writeFileSync(readmePath, readmeContent);
  createdFiles.push(`clients/${clientName}/README.md`);

  // ── Success output ────────────────────────────────────────────────────────
  console.log(`\n\x1b[32m✓ Created!\x1b[0m`);
  console.log(`\nFiles:`);
  for (const f of createdFiles) {
    console.log(`  \x1b[2m+\x1b[0m ${f}`);
  }
  console.log(`\nNext:`);
  console.log(
    `  1. Edit \x1b[36mclients/${clientName}/config/default.json\x1b[0m (review BASE_URL and thresholds)`
  );
  console.log(`  2. \x1b[36mnpm run build\x1b[0m`);
  console.log(`  3. \x1b[36mnode bin/validate-config.js --client=${clientName}\x1b[0m`);
  console.log(
    `  4. \x1b[36m./bin/run-test.sh --client=${clientName} --scenario=${testTypes[0]}/${defaultProfile}-${services[0]} --profile=${defaultProfile}\x1b[0m`
  );
  console.log(`\nRun \x1b[36m./bin/run-test.sh --help\x1b[0m for all options.`);
}

// ── Main menu ─────────────────────────────────────────────────────────────────

async function main() {
  // T-167: --product-layer flag bypasses the main menu
  if (process.argv.includes("--product-layer")) {
    await generateProductLayer();
    console.log("");
    rl.close();
    return;
  }

  console.log("\n╔═══════════════════════════════════════╗");
  console.log("║   k6 Enterprise Framework Generator   ║");
  console.log("╚═══════════════════════════════════════╝");

  const artifactType = await askChoice("What do you want to generate?", [
    "Client       — full client structure with config, scenarios, lib",
    "Test         — k6 scenario file from template",
    "Service      — service object class in lib/services/",
    "Factory      — data factory class in lib/factories/",
    "ProductLayer — guided multi-service product layer wizard",
  ]);

  if (artifactType.startsWith("Client")) await generateClient();
  else if (artifactType.startsWith("Test")) await generateTest();
  else if (artifactType.startsWith("Service")) await generateService();
  else if (artifactType.startsWith("Factory")) await generateFactory();
  else if (artifactType.startsWith("ProductLayer")) await generateProductLayer();

  console.log("");
  rl.close();
}

main().catch((err) => {
  console.error("Error:", err.message);
  rl.close();
  process.exit(1);
});
