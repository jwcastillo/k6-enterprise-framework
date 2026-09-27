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

// Shared shell parser (bin/_shell-guard.js, also used by bin/agent-bash-guard.js).
// If it is missing, checkBash fails closed for lines that mention k6 or the runners.
let shellGuard = null;
try {
  shellGuard = require(path.join(ROOT, "bin", "_shell-guard.js"));
} catch {
  shellGuard = null;
}
const MENTIONS_GUARDED = /k6|run-test|run-distributed|run-regression|quick\.sh|find-capacity|--unsafe|K6_ALLOW_PROD_LOAD/i;

/** @returns {string|null} reason to deny, or null */
function checkBash(command, env = process.env, guard = shellGuard, cwd = undefined) {
  const cmd = String(command || "");
  if (!guard) {
    return MENTIONS_GUARDED.test(cmd) ? "bin/_shell-guard.js is missing, so this command cannot be checked. Restore it before running tests." : null;
  }
  const a = guard.analyze(cmd, { cwd });
  // Fail closed on anything unparseable: escapes such as $'\x..' hide guarded words from a text match.
  if (a.error) return `Blocked: could not parse command (${a.error}); write it in a simpler form.`;
  if (a.indirect) return `Blocked: ${a.indirect} — ${guard.INDIRECTION_HINT}.`;
  // `k6 run` / `k6 cloud` straight from the shell skips target-guard, gating and reports.
  if (a.k6Load) {
    return "Run k6 through the runner: ./bin/run-test.sh --client=<c> --scenario=<bucket/name> [--profile=...]. It applies target-guard, scenario gates and report generation that a bare `k6 run` skips.";
  }
  if ((a.unsafeFlag || a.prodLoad.literalTrue) && env.K6_AGENT_ALLOW_UNSAFE !== "1") {
    return "`--unsafe` / K6_ALLOW_PROD_LOAD=true need a human decision. Ask the user; to allow it for this session they must start Claude Code with K6_AGENT_ALLOW_UNSAFE=1 exported in their own shell.";
  }
  return null;
}

/** true when git says the path is ignored; null when git can't tell. */
function isGitIgnored(file, cwd = ROOT) {
  const res = spawnSync("git", ["check-ignore", "-q", file], { cwd, encoding: "utf8" });
  if (res.status === 0) return true;
  if (res.status === 1) return false;
  return null;
}

// Recorded traffic and browser state: HAR (+ .har.json / .har.gz), replay files,
// Playwright traces and storage/auth state. They carry cookies, tokens and PII.
const SENSITIVE_WRITE = [
  /\.har(\.json|\.gz)?$/i,
  /(^|\/)replay-[^/]*\.json$/i,
  /(^|\/)([^/]*\.)?trace\.zip$/i,
  /(^|\/)storage-?state[^/]*\.json$/i,
  /(^|\/)[^/]*auth[^/]*state[^/]*\.json$/i,
];

function checkWrite(filePath, ignored = isGitIgnored) {
  const f = String(filePath || "");
  if (!SENSITIVE_WRITE.some((re) => re.test(f))) return null;
  // Only gitignored dirs may hold it; when git can't answer, refuse rather than guess.
  const state = ignored(f);
  if (state === true) return null;
  const why = state === false ? "a git-tracked path" : "a path that cannot be verified as gitignored (git check-ignore gave no answer)";
  return `Refusing to write recorded traffic or browser state to ${why} (${path.basename(f)}). HAR, replay, trace and storage/auth state files carry cookies, tokens and PII — write them under data/ or reports/ (gitignored).`;
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
  if (mode === "bash") reason = checkBash(tool.command, process.env, shellGuard, input.cwd);
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
