#!/usr/bin/env node
// bin/agent-bash-guard.js — PreToolUse hook for the perf agent team (.claude/agents).
//
// Reads the Claude Code hook payload on stdin and decides on the Bash command in
// tool_input.command according to a profile. Commands are parsed into words with
// bin/_shell-guard.js (the parser the repo hook uses), so quoting, `bash -c`, `eval`
// and variables cannot smuggle a command past the lists. Unparseable input is denied.
//
//   reviewer    one command, exact allowlist: `pnpm typecheck`, `pnpm lint`,
//               `pnpm test [paths]` (no flags), validators and scanners with their
//               read-only flags, read-only git, ls. No chaining, redirection, variables.
//   operator    allowlist: runner scripts, run-distributed, helm template/status/list/get,
//               kubectl get/describe/logs/top, read-only git, cat/ls/head/tail of reports/.
//               Heavy/unsafe/production runs and cluster changes ask the human; raw
//               `k6 run|cloud`, K6_ALLOW_PROD_LOAD and indirection are denied; anything
//               else is denied.
//   discoverer  every discover-flow.js run asks the human to confirm the scope.
//
// Output: exit 2 + stderr = block (reason goes back to the agent); JSON with
// permissionDecision "ask" on stdout = force a human prompt; exit 0 silent = no opinion.
// Internal errors fail closed (exit 2).
//
// Usage (agent frontmatter hook): node "$CLAUDE_PROJECT_DIR/bin/agent-bash-guard.js" <profile>

"use strict";

const { analyze, base, INDIRECTION_HINT } = require("./_shell-guard.js");

const allow = () => ({ decision: "allow" });
const deny = (reason) => ({ decision: "deny", reason });
const ask = (reason) => ({ decision: "ask", reason: `Human confirmation required: ${reason}` });
const texts = (words) => words.map((w) => w.text);
const isFlag = (t) => t.startsWith("-");
const scriptIs = (word, rel) => !!word && (word.text === rel || word.text === `./${rel}` || word.text.endsWith(`/${rel}`));

const GIT_READ = new Set(["diff", "log", "show", "status"]);
// Flags that write files or make git run another program.
const GIT_WRITE_FLAGS = /^--(output|ext-diff|exec-path|config-env|textconv)(=|$)|^-[oc]$/;
const gitReadOnly = (args) => GIT_READ.has(args[0]) && !args.some((a) => GIT_WRITE_FLAGS.test(a));

// ── reviewer ────────────────────────────────────────────────────────────────
const VALIDATE_FLAGS = /^--(kind|client|config|env|format|k6-env|schema|data|deny-terms)=|^--(strict|no-build|help)$/;
const SKILLSPECTOR_FLAGS = /^--(recursive|no-llm|fail-on-findings|fail-on-incomplete|help)$|^--(format|baseline)=/;

function reviewerAllows(argv) {
  const [, ...args] = texts(argv);
  const name = base(argv[0]);
  if (name === "pnpm") {
    const [sub, ...rest] = args;
    if (sub === "typecheck" || sub === "lint") return rest.length === 0;
    // pnpm forwards trailing args to the script: path filters only, no -u / --update / --fix.
    if (sub === "test") return rest.every((a) => !isFlag(a));
    return false;
  }
  if (name === "node") {
    return scriptIs(argv[1], "bin/validate-generated.js") && args.slice(1).every((a) => !isFlag(a) || VALIDATE_FLAGS.test(a));
  }
  if (scriptIs(argv[0], "bin/detect-secrets.sh")) return args.every((a) => !isFlag(a));
  // No --semantic (sends content to a provider) and no --sarif-dir (writes files).
  if (scriptIs(argv[0], "bin/scan-skills.sh")) return args.every((a) => !isFlag(a) || a === "--help");
  if (name === "skillspector") {
    if (args[0] === "--version") return args.length === 1;
    return args[0] === "scan" && args.includes("--no-llm") && args.slice(1).every((a) => !isFlag(a) || SKILLSPECTOR_FLAGS.test(a));
  }
  if (name === "git") return gitReadOnly(args);
  return name === "ls";
}

function reviewer(a) {
  if (a.error || a.indirect || a.k6Load) return deny("reviewer: the command could not be verified (parse error, indirection or load)");
  const [r, ...more] = a.commands.filter((c) => c.depth === 0); // package scripts nest their own commands
  if (!r || more.length || r.cmd.piped || r.cmd.redirects.length || r.cmd.heredocs.length || r.assigns.length) {
    return deny("reviewer: one command only — no chaining, pipes, redirection, substitution or env assignments");
  }
  if (r.cmd.words.some((w) => w.dynamic)) {
    return deny("reviewer: no variables, substitutions or wrapper commands");
  }
  return reviewerAllows(r.cmd.words)
    ? allow()
    : deny("reviewer: only `pnpm typecheck|lint|test [path]`, validators, scanners (read-only flags), read-only git and ls are allowed");
}

// ── operator ────────────────────────────────────────────────────────────────
const RUNNERS = ["bin/run-test.sh", "bin/quick.sh", "bin/run-regression.sh", "bin/report.sh", "bin/compare.sh", "bin/run-distributed.sh"];
const READ_ONLY_TOOLS = ["bin/junit.js", "bin/validate-generated.js", "bin/compare-results.js", "bin/trend-analysis.js", "bin/slo-report.js"];
const HELM_READ = new Set(["template", "status", "list", "ls", "get", "history", "lint", "version"]);
const HELM_CHANGE = new Set(["install", "upgrade", "uninstall", "delete", "rollback"]);
const KUBECTL_READ = new Set(["get", "describe", "logs", "top", "version", "explain"]);
const KUBECTL_CHANGE = new Set(["apply", "create", "delete", "patch", "scale", "replace", "edit", "rollout", "label", "annotate", "set", "cordon", "drain"]);
const safeRedirect = (x) => x.op === ">&" || x.op === "<&" || (/^(>|&>)/.test(x.op) && x.target?.text === "/dev/null");
const underReports = (t) => !t.includes("..") && /^(\.\/)?reports(\/|$)/.test(t);

/** Every value given for a flag (`--x=v` or `--x v`), in order. The runners keep the last. */
function flagValues(args, name) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith(`${name}=`)) out.push(args[i].slice(name.length + 1));
    else if (args[i] === name) out.push(args[i + 1] ?? "");
  }
  return out;
}

// Environments treated as non-production; anything else (prod, preprod, live, a new
// name, ...) asks the human.
const NON_PROD_ENV = /^(default|local|dev|development|test|testing|qa|ci|sandbox|staging|stage|uat)$/i;
// helm/kubectl flags that run a local program (post-renderer, kubeconfig exec plugins)
// or reach the raw API.
const CLUSTER_EXEC_FLAGS = /^--(post-renderer|kubeconfig|raw|exec)(-args)?(=|$)/;

function operatorCommand(r) {
  const argv = r.cmd.words; // as typed: wrappers (nohup, env, bash -c ...) are not on the list
  if (!argv.length) return allow();
  const [cmd, ...args] = texts(argv);
  const name = base(argv[0]);
  const script = name === "node" ? argv[1] : argv[0];
  const scriptArgs = name === "node" ? args.slice(1) : args;

  if (RUNNERS.some((p) => scriptIs(script, p))) {
    if (scriptArgs.some((a) => a === "--unsafe" || a.startsWith("--unsafe="))) return ask("unsafe-gated scenario");
    for (const flag of ["--profile", "--env"]) {
      if (new Set(flagValues(scriptArgs, flag)).size > 1) return ask(`${flag} given more than once (the runner uses the last)`);
    }
    const profile = flagValues(scriptArgs, "--profile").pop();
    if (profile !== undefined && !/^(smoke|quick)$/.test(profile)) return ask(`profile heavier than smoke/quick (${profile})`);
    const env = flagValues(scriptArgs, "--env").pop();
    if (env !== undefined && !NON_PROD_ENV.test(env)) return ask(`environment '${env}' is not a known non-production one`);
    if (scriptIs(script, "bin/run-distributed.sh") && !scriptArgs.some((a) => a === "--help" || a === "--dry-run")) {
      return ask("distributed run on the cluster");
    }
    return allow();
  }
  if (name === "node" && scriptIs(script, "bin/find-capacity.js")) {
    return scriptArgs.includes("--help") ? allow() : ask("capacity search fires repeated load");
  }
  if (name === "node" && READ_ONLY_TOOLS.some((p) => scriptIs(script, p))) return allow();
  if (name === "helm" || name === "kubectl") {
    if (args.some((a) => CLUSTER_EXEC_FLAGS.test(a))) return ask(`${name} flag that runs a local program or the raw API`);
    const sub = args.find((a) => !isFlag(a));
    if ((name === "helm" ? HELM_READ : KUBECTL_READ).has(sub)) return allow();
    if ((name === "helm" ? HELM_CHANGE : KUBECTL_CHANGE).has(sub)) return ask(`cluster change (${name})`);
  }
  if (name === "git" && gitReadOnly(args)) return allow();
  if (["cat", "ls", "head", "tail", "wc"].includes(name)) {
    const paths = args.filter((a) => !isFlag(a));
    // Read reports/ only; a bare filter is fine as a later pipeline stage.
    if (paths.every(underReports) && (paths.length || name === "ls" || r.cmd.piped)) return allow();
  }
  return deny(`operator: \`${cmd}\` is not on the operator allowlist (runner scripts, helm/kubectl read commands, read-only git, reading reports/)`);
}

function operator(a) {
  if (a.error) return deny(`operator: cannot parse the command (${a.error}); write it literally`);
  if (a.indirect) return deny(`operator: ${a.indirect} — ${INDIRECTION_HINT}`);
  if (a.k6Load) return deny("operator: run tests through bin/run-test.sh (or run-distributed.sh), never raw k6 run/cloud");
  if (a.prodLoad.any) return deny("operator: K6_ALLOW_PROD_LOAD is set by the human only");
  let verdict = allow();
  for (const r of a.commands) {
    if (r.cmd.words.some((w) => w.dynamic)) return deny(`operator: variables or substitutions — ${INDIRECTION_HINT}`);
    if (r.assigns.length) return deny("operator: no environment assignments; pass options as runner flags");
    if (r.cmd.redirects.some((x) => !safeRedirect(x)) || r.cmd.heredocs.length) return deny("operator: no file redirection");
    const d = operatorCommand(r);
    if (d.decision === "deny") return d;
    if (d.decision === "ask" && verdict.decision === "allow") verdict = d;
  }
  return verdict;
}

/** @returns {{decision: "allow"|"deny"|"ask", reason?: string}} */
function decide(profile, command, cwd = undefined) {
  const cmd = String(command || "").trim();
  if (profile === "reviewer") return reviewer(analyze(cmd, { cwd }));
  if (profile === "operator") return operator(analyze(cmd, { cwd }));
  if (profile === "discoverer") {
    return /discover-flow\.js(?!.*--help\b)/.test(cmd)
      ? { decision: "ask", reason: "Confirm the discovery scope: URL, environment, allowed/blocked hosts, stop rules" }
      : allow();
  }
  return deny(`unknown guard profile '${profile}'`);
}

module.exports = { decide };

if (require.main === module) {
  let input = "";
  process.stdin.on("data", (c) => (input += c));
  process.stdin.on("end", () => {
    let result;
    try {
      const payload = JSON.parse(input || "{}");
      result = decide(process.argv[2], payload.tool_input?.command ?? "", payload.cwd);
    } catch (e) {
      result = deny(`agent-bash-guard: ${e instanceof SyntaxError ? "unreadable hook payload" : `internal error (${e.message})`}; failing closed`);
    }
    if (result.decision === "deny") {
      process.stderr.write(`${result.reason}\n`);
      process.exit(2);
    }
    if (result.decision === "ask") {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: result.reason },
        })
      );
    }
    process.exit(0);
  });
}
