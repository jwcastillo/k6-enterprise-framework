---
title: "AI Guardrails"
sidebar_position: 6
---
# AI Guardrails

Three layers keep what an AI agent produces inside the spec and the security rules:

1. **Generation gate** — `bin/validate-generated.js` checks every AI-produced artifact
   deterministically (no LLM) before a human accepts it.
2. **SkillSpector** — NVIDIA's scanner checks the agent skills and the MCP server for
   prompt injection, exfiltration, privilege and supply-chain patterns, locally and in CI.
3. **Claude Code hooks** — `.claude/settings.json` stops an agent from bypassing the runner,
   unlocking unsafe load, or committing recorded traffic, and runs the gate on every
   scenario it edits.

None of them is a sandbox: they catch the common, costly mistakes. A human still reviews.

## Generation gate

```bash
node bin/validate-generated.js --kind=scenario|testplan|flow|patch|report <path...> \
  [--client=<name>|--config=<client config json>] [--format=text|json] [--strict]
```

Exit codes: `0` pass, `1` fail, `2` usage error. `--format=json` prints
`{kind, path, verdict: "pass"|"fail", checks: [{id, status, message, file?, line?}]}`
(an array when several paths are given). Check status is `pass`, `warn`, `fail` or `skip`;
only `fail` fails the verdict.

| Kind | Input | Checks |
| --- | --- | --- |
| `scenario` | k6 `.ts` | bucket is `api`, `flow`, `domain`, `chaos` or `perf`; `perf/` and `chaos/` declare `export const gate = "unsafe"\|"experimental"\|"quarantined"`; no Node-only imports (`@node/*`, `fs`, `path`, `child_process`, `src/ai`, ...); remote modules only from `jslib.k6.io`; every hard-coded host is in `allowedHosts`; no literal credentials; `thresholds` declared; `systemTags` excludes `url` (warn when unset); `abortOnFail: true` warns; VUs / rate above `maxVUs` / `maxRate` warn (fail with `--strict`); compiles through the repo webpack config; `k6 inspect` of the bundle succeeds (skipped with a warning when k6 is not installed) |
| `testplan` | Planner JSON | valid against `shared/schemas/test-plan.schema.json`; hosts allowlisted; every `testTypes` entry and `profile` exists in `shared/profiles/` |
| `flow` | discovery output dir or `flow.json` | valid against `shared/schemas/discovery-flow.schema.json` (skipped with a message when absent); `guardrails.maxSteps > 0` and a non-empty `stopAt` or `denyText`; `hostsSeen` allowlisted; no PII (emails, JWTs, Authorization / Cookie values, long digit runs) or secrets in `flow.json`, `flow.md`, `flow-plan.md` |
| `patch` | self-healing proposal `.md` / `.diff` / `.patch` | a proposal, never an applied source file; touches only `scenarios/` and `clients/*/{lib,scenarios}/`; removes no gate marker, threshold or guard call; adds no new host; no secrets in added lines |
| `report` | AI markdown report | every number appears in the deterministic JSON (`--data=<file>`, default `<report>.json`); no PII or secrets; none of `--deny-terms=a,b` (the terms are never echoed) |

Client config fields read by the gate:

```json
{
  "allowedHosts": ["api.staging.example.com"],
  "maxVUs": 200,
  "maxRate": 500
}
```

Defaults without a config: no host allowlist (hard-coded URLs warn), `maxVUs` 500,
`maxRate` 1000.

`--no-build` replaces webpack + `k6 inspect` with a syntax-only transpile (about half a
second instead of several). The PostToolUse hook uses it; run the full gate before accepting.

## SkillSpector

[SkillSpector](https://github.com/NVIDIA/skillspector) scans `.claude/skills/*` and
`mcp-server/src`.

```bash
uv tool install git+https://github.com/NVIDIA/skillspector.git
bin/scan-skills.sh                 # static, every skill + the MCP server
bin/scan-skills.sh --semantic      # + LLM analysis through the local claude CLI session
bin/scan-skills.sh .claude/skills/my-skill
```

Each skill is scanned on its own against `security/baselines/<skill>.yaml`. The script exits
`1` when a target has a finding that is not in its baseline. SARIF lands in
`reports/skillspector/` with repo-relative paths.

Process for a new finding:

1. Read it in context. **True positive**: fix the skill (for skills vendored from an upstream
   repo — see `skills-lock.json` — open the fix upstream instead of editing the lock-hashed copy).
2. **False positive**: first try rewording so the pattern no longer matches, when that costs
   nothing in meaning (pin a version, use a setup action instead of `sudo apt`, ...).
3. Only then add it to the baseline with a reason, and a row in
   `security/skillspector-triage.md`.

Regenerate a baseline with
`skillspector baseline .claude/skills/<skill> --no-llm -o security/baselines/<skill>.yaml`
and replace the generic reason with the triage reason for each entry.

CI (`.github/workflows/skillspector.yml`) runs the static scan on pull requests touching
`.claude/**`, `mcp-server/**` or `security/**`, uploads SARIF to code scanning and fails on
findings outside the baselines.

A score of 0 with no findings may still be reported as `CAUTION` rather than `SAFE`:
SkillSpector fails closed when coverage is partial, for example when a skill references
repo files that are not bundled with it, or when its bounded shell parser gives up on a
JavaScript template literal.

## Claude Code hooks

`.claude/settings.json` wires `.claude/hooks/guardrails.js`:

| Hook | Matcher | Blocks |
| --- | --- | --- |
| PreToolUse | `Bash` | `k6 run` / `k6 cloud` called directly — use `./bin/run-test.sh`, which applies target-guard, scenario gates and reports |
| PreToolUse | `Bash` | `--unsafe` or `K6_ALLOW_PROD_LOAD=true`, unless the human started Claude Code with `K6_AGENT_ALLOW_UNSAFE=1` exported in their own shell |
| PreToolUse | `Write\|Edit\|MultiEdit` | `*.har` and `replay-*.json` written to a path git does not ignore (use `data/` or `reports/`) |
| PostToolUse | `Write\|Edit\|MultiEdit` | nothing — runs `validate-generated.js --kind=scenario --no-build` on `scenarios/**` and `clients/*/scenarios/**` and reports failures back to the agent |

Hooks fail closed on a detected violation (exit `2`, the reason goes back to the agent) and
fail open on their own errors, so a broken hook never wedges a session. They match the
command text, so a message that merely quotes `k6 run` is blocked too — rephrase it.

## For client repos

- Add `allowedHosts`, `maxVUs` and `maxRate` to the client config; the gate and
  `bin/target-guard.js` both read `allowedHosts`.
- Run the gate on anything an agent produced before merging:
  `node bin/validate-generated.js --kind=scenario clients/<client>/scenarios/api/x.ts --client=<client>`.
- Reports: `--kind=report --data=<summary.json> --deny-terms=<client>,<brand>` keeps names
  out of anything meant to be shared outside the team.
- A client-shipped skill (`clients/<client>/skill/`) can be scanned with
  `bin/scan-skills.sh clients/<client>/skill`.
