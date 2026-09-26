#!/usr/bin/env node
// bin/discover-flow.js — AI-driven flow discovery: explore a web app with Playwright toward a
// natural-language goal, record a HAR, and hand off to k6 test authoring.
//
// Node only (never inside the k6 runtime). Logic lives in bin/discovery/*.js.
//
// Exit codes: 0 goal or --stop-at reached (or dry run complete), 3 stopped by a guardrail
// (allowlist, budget, low confidence, loop, max steps, decider stop), 1 error.

"use strict";

const fs = require("fs");
const path = require("path");
const { parseArgs } = require("util");
const { spawnSync } = require("child_process");

const HELP = {
  name: "discover-flow",
  description: "Explore a web app toward a goal with an AI decider, record a HAR and plan the k6 script",
  usage: 'node bin/discover-flow.js --url=<start> --goal="<natural language>" [options]',
  flags: [
    { flag: "--url=<url>", description: "Start URL (its host is always allowed)" },
    { flag: '--goal="<text>"', description: "What the flow should accomplish, in natural language" },
    { flag: "--decider=claude|jev", description: "claude (ANTHROPIC_API_KEY, DISCOVERY_MODEL) or jev (TYPESAFE_API_KEY). Default claude" },
    { flag: "--data=<file.json>", description: "Named test values the agent may type, e.g. {\"email\":\"...\"}. Only keys reach the model" },
    { flag: "--max-steps=<n>", description: "Maximum actions (default 30)" },
    { flag: "--allow-hosts=a.com,b.com", description: "Extra hosts navigation may reach; leaving them stops the run" },
    { flag: "--block-hosts=x.com,*.y.com", description: "Hosts whose requests are aborted (context-level route)" },
    { flag: "--stop-at=<regex>", description: "Repeatable. When the URL matches, record and stop without acting" },
    { flag: "--deny-text=<regex>", description: "Elements whose name/text matches are never offered (default: pay|buy|purchase|checkout|delete|...)" },
    { flag: "--min-confidence=<0-1>", description: "Below this the run stops for a human (default 0.5)" },
    { flag: "--max-tokens=<n>", description: "Decider token budget; the run stops when spent (default 200000)" },
    { flag: "--user-agent=<ua>", description: "Browser user agent" },
    { flag: "--storage-state=<file>", description: "Playwright storage state (logged-in session) to start from" },
    { flag: "--no-headless", description: "Show the browser (headless by default)" },
    { flag: "--out=<dir>", description: "Output directory (default reports/discovery/<datetime>)" },
    { flag: "--dry-run", description: "Load the page and plan steps without clicking or typing" },
    { flag: "--trace", description: "Also record a Playwright trace (trace.zip)" },
    { flag: "--k6", description: "Convert flow.har with har-to-k6 if it is installed" },
    { flag: "--help, -h", description: "Show this help" },
  ],
  examples: [
    'node bin/discover-flow.js --url=https://staging.example.com --goal="search for a product and open its detail page" --stop-at=/checkout',
    'node bin/discover-flow.js --url=https://staging.example.com/signup --goal="complete the signup form" --data=data/discovery.json --decider=jev --k6',
    'node bin/discover-flow.js --url=http://localhost:3000 --goal="open the reports page" --dry-run',
  ],
};

const OPTIONS = {
  url: { type: "string" },
  goal: { type: "string" },
  decider: { type: "string", default: "claude" },
  data: { type: "string" },
  "max-steps": { type: "string", default: "30" },
  "allow-hosts": { type: "string", default: "" },
  "block-hosts": { type: "string", default: "" },
  "stop-at": { type: "string", multiple: true, default: [] },
  "deny-text": { type: "string" },
  "min-confidence": { type: "string", default: "0.5" },
  "max-tokens": { type: "string", default: "200000" },
  "user-agent": { type: "string" },
  "storage-state": { type: "string" },
  headless: { type: "boolean", default: true },
  out: { type: "string" },
  "dry-run": { type: "boolean", default: false },
  trace: { type: "boolean", default: false },
  k6: { type: "boolean", default: false },
  help: { type: "boolean", short: "h", default: false },
};

const list = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);
const positiveInt = (name, s) => {
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive integer`);
  return n;
};

/** Parse argv into runDiscovery options. Throws on invalid input. */
function parseCli(argv) {
  const { values: v } = parseArgs({ args: argv, options: OPTIONS, allowNegative: true, strict: true });
  if (v.help) return { help: true };
  if (!v.url || !v.goal) throw new Error("--url and --goal are required (see --help)");
  const start = new URL(v.url);
  if (!/^https?:$/.test(start.protocol)) throw new Error("--url must be http(s)");
  const minConfidence = Number(v["min-confidence"]);
  if (!(minConfidence >= 0 && minConfidence <= 1)) throw new Error("--min-confidence must be between 0 and 1");

  let data = {};
  if (v.data) {
    data = JSON.parse(fs.readFileSync(v.data, "utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("--data must be a JSON object of named values");
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return {
    url: start.href,
    goal: v.goal,
    decider: v.decider,
    data,
    maxSteps: positiveInt("max-steps", v["max-steps"]),
    allowHosts: list(v["allow-hosts"]),
    blockHosts: list(v["block-hosts"]),
    stopAt: v["stop-at"].map((s) => new RegExp(s)),
    denyText: v["deny-text"] ? new RegExp(v["deny-text"], "i") : undefined,
    minConfidence,
    maxTokens: positiveInt("max-tokens", v["max-tokens"]),
    userAgent: v["user-agent"],
    storageState: v["storage-state"],
    headless: v.headless,
    out: v.out || path.join("reports", "discovery", stamp),
    dryRun: v["dry-run"],
    trace: v.trace,
    k6: v.k6,
  };
}

function handoff(files, convert) {
  const dir = path.dirname(files.har);
  if (convert) {
    const script = path.join(dir, "flow-k6.js");
    const run = spawnSync("npx", ["--no-install", "har-to-k6", files.har, "-o", script], { stdio: "inherit" });
    if (run.status === 0) console.log(`[discover] k6 script: ${script}`);
    else {
      console.log("[discover] har-to-k6 is not installed (it is not a dependency of this framework).");
      console.log("[discover]   install it with `npm i -g har-to-k6`, or run `npx -y har-to-k6 flow.har -o flow-k6.js`");
    }
  }
  console.log(`
[discover] Next steps
  1. Read ${files.plan} — endpoint sequence and correlation candidates.
  2. Grafana k6 Studio: File > Import HAR (${files.har}) > Generator > enable Autocorrelation.
  3. Or convert with har-to-k6 (--k6) and replace recorded tokens with the extractions in flow-plan.md.
[discover] WARNING: flow.har contains raw traffic (bodies, cookies, typed values). Files are 0600; do not commit them.`);
}

async function main(argv) {
  let opts;
  try {
    opts = parseCli(argv);
  } catch (error) {
    console.error(`[discover] ${error.message}`);
    return 1;
  }
  if (opts.help) {
    require("./_help").printHelp(HELP);
    return 0;
  }
  try {
    const { createDecider } = require("./discovery/deciders");
    const { runDiscovery } = require("./discovery/explore");
    let chromium;
    try {
      ({ chromium } = require("playwright"));
    } catch {
      throw new Error("playwright is not installed: npm i -D playwright && npx playwright install chromium");
    }
    const decider = createDecider(opts.decider);
    console.log(`[discover] ${opts.dryRun ? "DRY RUN — " : ""}goal: ${opts.goal}`);
    console.log(`[discover] decider: ${decider.name} (${decider.model}); only redacted page state and --data keys are sent`);
    const { files, exitCode } = await runDiscovery(opts, { decider, chromium });
    console.log(`[discover] wrote ${files.har}, ${files.json}, ${files.md}, ${files.plan}${files.trace ? `, ${files.trace}` : ""}`);
    handoff(files, opts.k6);
    return exitCode;
  } catch (error) {
    console.error(`[discover] Failed: ${error.message}`);
    return 1;
  }
}

module.exports = { parseCli, main };

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
