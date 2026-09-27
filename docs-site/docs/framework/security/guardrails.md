---
title: "AI Guardrails"
sidebar_position: 6
---
# AI Guardrails

The enforcement boundary for runs is in the runners: a heavy, unsafe or production run
needs a human approval created with `bin/approve-run.sh` (exit `109` without one), and k6
is never resolved through the caller's `PATH`. See
[Run Approval and Trusted k6](./run-approval.md). The layers below are defense in depth.

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
  [--client=<name>|--config=<client config json>] [--env=<env>] [--k6-env=KEY=VAL ...] \
  [--format=text|json] [--strict] [--no-build]
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
In `--no-build`, a scenario whose options come from another module
(`export { options } from "..."` or `export const options = sharedOptions;`) gets a `warn`
on `thresholds` instead of a `fail`: the text alone cannot see them.

### Resolved options

When `k6 inspect` succeeds, the gate reads the options object k6 resolved (imports,
re-exports and helper functions included) and checks it instead of the source text:

- `thresholds`: at least one threshold metric;
- `system-tags`: `url` is not in `systemTags` (warn when unset);
- `load-ceiling`: per scenario, the peak VUs (`vus`, `startVUs`, `maxVUs`,
  `preAllocatedVUs`, VU stage targets) against `maxVUs` and the peak rate (`rate`,
  `startRate`, arrival-rate stage targets) against `maxRate`; warn, or fail with `--strict`.

`k6 inspect` cannot read your shell environment. When init code opens a path from `__ENV`
(a data file, a CSV directory), pass it with the repeatable `--k6-env=KEY=VAL`; each one
reaches `k6 inspect` as `-e KEY=VAL`:

```bash
node bin/validate-generated.js --kind=scenario scenarios/api/orders.ts --strict \
  --k6-env=DATA_DIR=data --k6-env=BASE_URL=https://api.staging.example.com
```

### Standalone repos

In a repo exported with `bin/export-client.sh --with-claude` the gate lives in `bin/` and
detects the layout on its own (a `framework/src` directory): profiles and schemas come from
`framework/shared`, and `--env=<env>` reads `config/<env>.json` (then `config/default.json`)
without `--client`.

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

Limitations: some SkillSpector inspections have a wall-clock budget (0.25 s per artifact), so a
heavily loaded runner can report an `AE1` "incomplete analysis" finding that a re-run does not.
Baselines match on rule id, file and finding text, so an edit that changes a baselined line's
text surfaces it again for review.

## Claude Code hooks

`.claude/settings.json` wires `.claude/hooks/guardrails.js`:

| Hook | Matcher | Blocks |
| --- | --- | --- |
| PreToolUse | `Bash` | `k6 run` / `k6 cloud` called directly — use `./bin/run-test.sh`, which applies target-guard, scenario gates and reports |
| PreToolUse | `Bash` | `--unsafe` or `K6_ALLOW_PROD_LOAD=true`, unless the human started Claude Code with `K6_AGENT_ALLOW_UNSAFE=1` exported in their own shell |
| PreToolUse | `Bash` | running `bin/approve-run.sh` or `bin/_run-approval.js` in any form (directly, through `bash`/`sh`/`source`, `node`, a pseudo-terminal wrapper such as `script`, `expect` or `unbuffer`, `find -exec` or interpreter code). No opt-in unlocks it: approvals are human-only. Reading the files (`cat`, `grep`, `git`) is allowed. The agent-team guard (`bin/agent-bash-guard.js`) denies the same in every profile |
| PreToolUse | `Bash` | indirection that could produce either of the above: a command name from a variable or substitution, variables in the arguments of `k6` or the runners, a variable holding a guarded value (`V=--unsafe`), `export "$V=..."`, `xargs` driving the runner, a shell reading its script from a pipe, `source` on the same line as a run |
| PreToolUse | `Write\|Edit\|MultiEdit` | recorded traffic and browser state — `*.har`, `*.har.json`, `*.har.gz`, `replay-*.json`, Playwright traces (`trace.zip`, `*.trace.zip`) and storage/auth state (`storage-state*.json`, `storageState*.json`, `*auth*state*.json`) — written to a path git does not ignore, or where `git check-ignore` cannot answer (use `data/` or `reports/`) |
| PostToolUse | `Write\|Edit\|MultiEdit` | nothing — runs `validate-generated.js --kind=scenario --no-build` on `scenarios/**` and `clients/*/scenarios/**` and reports failures back to the agent |

The Bash hook parses the command with `bin/_shell-guard.js` (no dependencies, so it works
before `pnpm install`) and decides on the words bash would run: quotes are removed, and
`sh|bash|zsh -c`, `eval`, `env -S`, `$(...)`, backticks and heredocs fed to a shell are
parsed as commands too. So `bash -c "..."` or a split `k6" "run` is caught, while a commit
message or `echo` that only quotes `k6 run` passes. A denied indirection says
"indirection not allowed; write the command literally".

It also follows what a command hands off to:

- Package scripts: `pnpm <script>`, `pnpm run`, `npm run`/`npm test`, `yarn <script>`
  are resolved from the nearest `package.json` (pre/post hooks included) and parsed.
  A script that cannot be resolved, or a workspace-wide run (`-r`, `--filter`), is denied.
- Script files: `bash|sh|zsh file`, `source`/`.` and `./file.sh` are read (up to 256 KiB,
  16 files per command) and parsed; a missing or unparseable file is denied. The runners
  and the repo's own `bin/` tooling are checked by their arguments, not re-read.
- `corepack`, `bun run`/`bun <script>` and `bunx` are resolved like pnpm/npx. For
  `make`, `just` and `task` the task file is read and the call is denied when the file
  mentions k6, the runners or the unsafe/prod-load switches, or cannot be read.
- `cd`/`pushd`/`env -C` with a literal target add that directory to the ones scripts are
  resolved from (the previous one stays, in case the `cd` runs in a subshell or fails);
  a target that cannot be known (a variable, `-`, `~user`, a glob) makes any later script
  resolution a denial.
- Write-then-run: a line that writes a file (`>`, `tee`, `cp`, `mv`, `sed -i`, `dd of=`,
  heredoc into a file, ...) and runs that file, a script next to it, or a
  `package.json`/Makefile it rewrote is denied, because the hook reads files before the
  line runs. `openssl -out`, `sponge`, `split`/`csplit` (their output prefix) and
  `exec N>file` count as writers. Writers whose target is unknown (`curl -o`,
  `git checkout`, `awk`, `node -e`, a variable target, ...) count as writing anything,
  except against the runners and the repo's `bin/` tooling (never content-read), which
  are only tainted by a write to their own path: `git pull && ./bin/run-test.sh …` is
  fine.
- An environment assignment (`VAR=… cmd`, `env VAR=…`, `export VAR=…`) earlier on the
  line than k6, a runner, a package script or a script file is denied: `PATH=…`,
  `NODE_OPTIONS=…` or `npm_config_script_shell=…` would change what runs. Inert names are
  allowed: `NODE_ENV`, `CI`, `DEBUG`, `TZ`, `LANG`, `LC_*`, `FORCE_COLOR`, `NO_COLOR`,
  `TERM`, `COLUMNS` and `K6_*`, except `K6_ALLOW_PROD_LOAD` and the `K6_*` that pick a
  binary, image, extension, report CLI or secret source or skip checks
  (`K6_BINARY*`, `K6_SKIP_*`, ...). Assignments before other commands are fine.
- k6, a runner name or the unsafe/prod-load switches inside the **arguments** of another
  program are denied: `docker run … k6`, `kubectl run|exec … -- k6`, `ssh host k6 …`,
  `vim -c '!k6 …'`, `awk 'BEGIN{system("k6 …")}'`, `python3 -c`, `perl -e`, `node -e` and
  the like. Data tools are exempt (echo, printf, grep, rg, sed, git, gh, cat, ls, jq,
  shellcheck, ...), so commit messages and search patterns that mention k6 still pass.
- `watch`, `find -exec`, git config that runs programs (`-c core.pager=…`, `alias.*`,
  `--exec-path=`), variables such as `BASH_ENV`/`GIT_PAGER`, command names with glob or
  brace characters and `helm --post-renderer` count as indirection.

Hooks fail closed on a detected violation (exit `2`, the reason goes back to the agent),
on **any** command they cannot parse ("could not parse command; write it in a simpler
form" — escapes such as `$'\x..'` can hide a guarded word from a text match, so there is
no text-based fallback), and when `bin/_shell-guard.js` is missing. Array assignments,
function definitions and `case … esac` parse. Hooks fail open on their own internal
errors, so a broken hook never wedges a session.

The hook is best-effort defense in depth, not a sandbox. Interpreters and remote or
container launchers are only caught when the k6/runner token appears literally in their
arguments; renamed binaries, encoded or computed payloads inside interpreter code, and
files fetched in one tool call and run in another are not seen, and a determined agent
with shell access can find other paths. The enforcement boundary is the runner's own
approval check (added in a separate change): the hook exists to catch mistakes and
obvious bypasses early, with a clear message.

## For client repos

- Add `allowedHosts`, `maxVUs` and `maxRate` to the client config; the gate and
  `bin/target-guard.js` both read `allowedHosts`.
- Run the gate on anything an agent produced before merging:
  `node bin/validate-generated.js --kind=scenario clients/<client>/scenarios/api/x.ts --client=<client>`.
- Reports: `--kind=report --data=<summary.json> --deny-terms=<client>,<brand>` keeps names
  out of anything meant to be shared outside the team.
- A client-shipped skill (`clients/<client>/skill/`) can be scanned with
  `bin/scan-skills.sh clients/<client>/skill`.
