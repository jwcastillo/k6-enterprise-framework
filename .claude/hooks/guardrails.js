#!/usr/bin/env node
// .claude/hooks/guardrails.js — Claude Code hooks for this repo.
//
//   node .claude/hooks/guardrails.js bash            PreToolUse  Bash
//   node .claude/hooks/guardrails.js write           PreToolUse  Write|Edit|MultiEdit
//   node .claude/hooks/guardrails.js post-scenario   PostToolUse Write|Edit|MultiEdit
//
// Reads the hook payload from stdin. Exit 2 + stderr = blocked (the message goes
// back to the agent); exit 0 = allowed. Detected violations fail closed; any
// internal error (bad JSON, git missing, ...) fails open so a broken hook never
// wedges a session.

"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

/** @returns {string|null} reason to deny, or null */
function checkBash(command, env = process.env) {
  const cmd = String(command || "");
  // `k6 run` / `k6 cloud` straight from the shell skips target-guard, gating and reports.
  if (/(^|[\s;&|(`$])k6\s+(run|cloud)\b/.test(cmd)) {
    return "Run k6 through the runner: ./bin/run-test.sh --client=<c> --scenario=<bucket/name> [--profile=...]. It applies target-guard, scenario gates and report generation that a bare `k6 run` skips.";
  }
  const unsafe = /(^|\s)--unsafe\b/.test(cmd) || /\bK6_ALLOW_PROD_LOAD=["']?true\b/.test(cmd);
  if (unsafe && env.K6_AGENT_ALLOW_UNSAFE !== "1") {
    return "`--unsafe` / K6_ALLOW_PROD_LOAD=true need a human decision. Ask the user; to allow it for this session they must start Claude Code with K6_AGENT_ALLOW_UNSAFE=1 exported in their own shell.";
  }
  return null;
}

/** true when git says the path is ignored; null when git can't tell (fail open). */
function isGitIgnored(file, cwd = ROOT) {
  const res = spawnSync("git", ["check-ignore", "-q", file], { cwd, encoding: "utf8" });
  if (res.status === 0) return true;
  if (res.status === 1) return false;
  return null;
}

function checkWrite(filePath, ignored = isGitIgnored) {
  const f = String(filePath || "");
  if (!/\.har$/i.test(f) && !/(^|\/)replay-[^/]*\.json$/i.test(f)) return null;
  // Recorded traffic carries cookies, tokens and PII: only gitignored dirs may hold it.
  if (ignored(f) === false) {
    return `Refusing to write recorded traffic to a git-tracked path (${path.basename(f)}). HAR / replay files carry cookies, tokens and PII — write them under data/ or reports/ (gitignored).`;
  }
  return null;
}

const SCENARIO_RE = /(^|\/)(clients\/([^/]+)\/)?scenarios\/.+\.ts$/;

function checkScenario(filePath, run = spawnSync) {
  const rel = path.relative(ROOT, path.resolve(ROOT, String(filePath || ""))).split(path.sep).join("/");
  const m = SCENARIO_RE.exec(rel);
  if (!m || rel.startsWith("..") || rel.startsWith("test/")) return null;
  const args = [path.join(ROOT, "bin/validate-generated.js"), "--kind=scenario", "--no-build", "--format=json", rel];
  if (m[3]) args.push(`--client=${m[3]}`);
  const res = run(process.execPath, args, { cwd: ROOT, encoding: "utf8", timeout: 5000 });
  if (res.status !== 1) return null; // 0 = pass; anything else = gate itself broke → fail open
  const out = JSON.parse(res.stdout);
  const fails = out.checks.filter((c) => c.status === "fail");
  return [
    `Generation gate failed for ${rel}:`,
    ...fails.map((c) => `  - ${c.id}${c.line ? `:${c.line}` : ""}: ${c.message}`),
    "Fix these before handing the scenario to a human (node bin/validate-generated.js --kind=scenario <file> for the full check).",
  ].join("\n");
}

function readStdin() {
  try {
    return JSON.parse(require("fs").readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

function main(mode) {
  const input = readStdin();
  const tool = input.tool_input || {};
  let reason = null;
  if (mode === "bash") reason = checkBash(tool.command);
  else if (mode === "write") reason = checkWrite(tool.file_path);
  else if (mode === "post-scenario") reason = checkScenario(tool.file_path);
  if (reason) {
    process.stderr.write(reason + "\n");
    return 2;
  }
  return 0;
}

module.exports = { checkBash, checkWrite, checkScenario };

if (require.main === module) {
  let code = 0;
  try {
    code = main(process.argv[2]);
  } catch {
    code = 0; // fail open on internal errors
  }
  process.exit(code);
}
