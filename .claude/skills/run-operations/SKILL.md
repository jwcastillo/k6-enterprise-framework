---
name: run-operations
description: Operate k6 test runs in this framework through the run-test.sh runner — choosing a load profile, the smoke-before-load order, safety gates (quarantined / experimental / unsafe), the target guard, exit codes 0 / 1 / 99 / 107 / 108, capacity search, and how to stop or abort a run. Use when asked to "run the smoke test for <scenario>", "execute a load/stress/soak run", "why did run-test.sh exit 99/107/108", or "stop the running test". Not for writing scenarios (k6-scenario-authoring), cluster runs (k6-distributed-runs), or interpreting results (results-analysis).
---

# Run operations

`<repo>` below means the repository root; run every command from there.

Every run goes through the runner script. Never call `k6 run` directly: the runner
does config validation, build, target guard, gating, artifact generation and the
exit-code mapping that the rest of the team relies on.

## Command shape

| Layout | Command |
|--------|---------|
| Monorepo | `<repo>/bin/run-test.sh --client=<name> --scenario=<bucket>/<path> --profile=<profile> [--env=<env>]` |
| Standalone export | `<repo>/bin/run-test.sh --scenario=<bucket>/<path> --profile=<profile> [--env=<env>]` (no `--client`) |

Detect the layout: a `framework` directory at the repo root means standalone.

Useful monorepo flags (the runner's `--help` has the full list):

- `--dry-run` — print the execution plan, run nothing. Use it first when unsure.
- `--list-profiles` — profile table.
- `--run-label=<text>` / `--story=<id>` — label the run in artifacts.
- `--gate-baseline=<summary.json>` — regression gate against a baseline (fails as 99).
- `--prometheus`, `--tempo`, `--loki`, `--observability` — outputs (see observability-setup).
- `--skip-build` — reuse the existing bundle; only after a successful build of the same code.
- `--quarantined`, `--experimental`, `--unsafe` — unlock a gated scenario (see below).

## Profiles (shared/profiles)

| Profile | Shape | Use |
|---------|-------|-----|
| `smoke` | 1-2 VUs, ~1 min | Always first. Proves the script and target work. |
| `quick` | 5 VUs, ~3 min | CI feedback. |
| `load` | ~20 VUs sustained | Expected traffic. |
| `rampup`, `capacity`, `stress`, `spike`, `breakpoint` | rising VUs | Limits; need explicit human approval. |
| `soak` | ~20 VUs, 4 h+ | Endurance; need explicit human approval. |
| `throughput-low/medium/high/ramp` | arrival-rate (open model) | Fixed RPS targets. |

## Mandatory order

1. `--dry-run` if the scenario or flags are new.
2. `--profile=smoke`. It must exit `0` before anything heavier.
3. Heavier profile only after the human confirms target, environment, profile and time
   window in the current conversation. Confirmation does not carry over between runs.

## Safety gates

A scenario that declares `export const gate = "quarantined" | "experimental" | "unsafe"`
is refused with exit `108` unless the matching flag is passed.

- `--quarantined` / `--experimental`: allowed after telling the human why.
- `--unsafe`: stop and ask the human every time. State what makes it unsafe.
- The standalone runner does not enforce gates. Check the scenario source for
  `export const gate` yourself and apply the same rule.

## Target guard

The monorepo runner calls the target guard (target-guard.js) before k6 starts. It
refuses credentials embedded in a base URL, hosts outside `allowedHosts` in the client
config, and non-smoke profiles against an environment whose name starts with `prod`.
The override `K6_ALLOW_PROD_LOAD=true` is set only by the human, never by an agent.
The standalone runner has no target guard: confirm the target host with the human.

## Exit codes

| Code | Meaning | Next step |
|------|---------|-----------|
| 0 | Thresholds met | Hand artifacts to results-analysis. |
| 1 | Framework/test error or critical regression | Read the k6 log; do not retry blindly. |
| 99 | Thresholds failed (SLO not met) or regression gate failed | A valid result, not a crash. Analyze; never "fix" it by loosening thresholds. |
| 107 | Build/script error, missing file, or target guard refusal | Fix the script or config; re-run smoke. |
| 108 | Scenario is gated and the flag was not passed | Ask the human (see gates). |

## Artifacts

Written to `reports/<client>/<scenario_with_underscores>/` (standalone:
`reports/<scenario>/`), each named `<type>-YYYYMMDD-HHMMSS.<ext>`: `summary` (json),
`html-report` (html), `k6-execution` (log), `comparison` (md), `metrics` (csv),
`analysis` (md), `message` (md), `junit` (xml), and `triage` (txt) when triage ran.
Record the exact paths in your hand-off.

## Stop / abort

- Local run: interrupt the runner process once (Ctrl+C). k6 stops gracefully and still
  writes the summary. A second interrupt aborts without a summary.
- Cluster run: see k6-distributed-runs.
- After an abort, report the run as aborted. Partial numbers are not results.

## Capacity search

`<repo>/bin/find-capacity.js --client=<c> --scenario=<s> --start-rps=<n> --max-rps=<n>
--step-duration=<s>` (run with `node`) searches the highest sustainable arrival rate.
It refuses non-local targets unless the human passes `--i-own-this-target`. Exit 0 =
rate found, 1 = nothing passed, 2 = usage error or aborted search. It fires many runs:
same approval rule as stress.
