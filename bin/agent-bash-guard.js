#!/usr/bin/env node
// bin/agent-bash-guard.js — PreToolUse hook for the perf agent team (.claude/agents).
//
// Reads the Claude Code hook payload on stdin and decides on the Bash command in
// tool_input.command according to a profile:
//
//   reviewer    allowlist only: validators, scanners, typecheck/lint/test, read-only git.
//               No shell chaining, redirection, substitution or --output.
//   operator    never raw `k6 run|cloud` (use the runner); never set K6_ALLOW_PROD_LOAD;
//               heavy/unsafe/production runs and cluster changes always ask the human.
//   discoverer  every discover-flow.js run asks the human to confirm the scope.
//
// Output: exit 2 + stderr = block (reason goes back to the agent); JSON with
// permissionDecision "ask" on stdout = force a human prompt; exit 0 silent = no opinion.
//
// Usage (agent frontmatter hook): node "$CLAUDE_PROJECT_DIR/bin/agent-bash-guard.js" <profile>

"use strict";

const SHELL_META = /[;&|`<>\n]|\$\(/;
const NO_META_ARGS = "(?: [^;&|`<>\\n$]*)?";

const REVIEWER_ALLOW = [
  "node (?:\\./)?bin/validate-generated\\.js",
  "(?:\\./)?bin/detect-secrets\\.sh",
  "(?:\\./)?bin/scan-skills\\.sh",
  "skillspector (?:scan|--version)",
  "pnpm (?:typecheck|lint|test)",
  "git (?:diff|log|show|status)",
  "ls",
].map((p) => new RegExp(`^${p}${NO_META_ARGS}$`));

const OPERATOR_DENY = [
  [/(?:^|[\s;&|(])x?k6\s+(?:run|cloud)\b/, "run tests through bin/run-test.sh (or run-distributed.sh), never raw k6 run/cloud"],
  [/K6_ALLOW_PROD_LOAD\s*=/, "K6_ALLOW_PROD_LOAD is set by the human only"],
];

const OPERATOR_ASK = [
  [/--unsafe\b/, "unsafe-gated scenario"],
  [/--profile[= ](?!smoke\b|quick\b)\S+/, "profile heavier than smoke/quick"],
  [/--env[= ]prod/i, "production environment"],
  [/find-capacity\.js/, "capacity search fires repeated load"],
  [/run-distributed\.sh(?!.*--(?:help|dry-run)\b)/, "distributed run on the cluster"],
  [/\bhelm\s+(?:install|upgrade|uninstall|rollback)\b/, "cluster change (helm)"],
  [/\bkubectl\s+(?:apply|create|delete|patch|scale|replace|edit)\b/, "cluster change (kubectl)"],
];

/** @returns {{decision: "allow"|"deny"|"ask", reason?: string}} */
function decide(profile, command) {
  const cmd = String(command || "").trim();
  if (profile === "reviewer") {
    if (SHELL_META.test(cmd) || /\s(?:--output|-o)\b/.test(cmd)) {
      return { decision: "deny", reason: "reviewer: no chaining, redirection, substitution or output files" };
    }
    return REVIEWER_ALLOW.some((re) => re.test(cmd))
      ? { decision: "allow" }
      : { decision: "deny", reason: "reviewer: only validators, scanners, typecheck/lint/test and read-only git are allowed" };
  }
  if (profile === "operator") {
    for (const [re, reason] of OPERATOR_DENY) if (re.test(cmd)) return { decision: "deny", reason: `operator: ${reason}` };
    for (const [re, reason] of OPERATOR_ASK) {
      if (re.test(cmd)) return { decision: "ask", reason: `Human confirmation required: ${reason}` };
    }
    return { decision: "allow" };
  }
  if (profile === "discoverer") {
    return /discover-flow\.js(?!.*--help\b)/.test(cmd)
      ? { decision: "ask", reason: "Confirm the discovery scope: URL, environment, allowed/blocked hosts, stop rules" }
      : { decision: "allow" };
  }
  return { decision: "deny", reason: `unknown guard profile '${profile}'` };
}

module.exports = { decide };

if (require.main === module) {
  let input = "";
  process.stdin.on("data", (c) => (input += c));
  process.stdin.on("end", () => {
    let command = "";
    try {
      command = JSON.parse(input || "{}").tool_input?.command ?? "";
    } catch {
      process.stderr.write("agent-bash-guard: unreadable hook payload\n");
      process.exit(2);
    }
    const { decision, reason } = decide(process.argv[2], command);
    if (decision === "deny") {
      process.stderr.write(`${reason}\n`);
      process.exit(2);
    }
    if (decision === "ask") {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: reason },
        })
      );
    }
    process.exit(0);
  });
}
