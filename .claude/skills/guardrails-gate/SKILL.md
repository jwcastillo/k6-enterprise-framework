---
name: guardrails-gate
description: Run and interpret the framework's generation gate (validate-generated.js with --kind=scenario, testplan, flow, patch or report) and the secret scan before generated or edited artifacts are committed or handed off, and fix the common failures. Use when asked to "validate the generated scenario", "does this test plan pass the gate", "why did validate-generated fail", or before committing any AI-generated scenario, plan, flow, patch or report. Not for skill-file scanning with SkillSpector (security-scanning).
---

# Guardrails gate

`<repo>` means the repository root.

## Availability

```bash
node <repo>/bin/validate-generated.js --help
```

If the validator is missing, the gate is not on this branch yet: say so, run the
checks you can (typecheck, lint, build, secret scan) and mark the artifact
"gate not run". Never report a gate as passed when it did not run.

## Command

```bash
node <repo>/bin/validate-generated.js --kind=<scenario|testplan|flow|patch|report> <path...> \
  [--client=<name> | --config=<json>] [--format=text|json] [--strict]
```

Exit codes: `0` pass, `1` fail, `2` usage error. Use `--format=json` when you need to
parse failures; use `--strict` for anything that will be committed.

## What each kind is for

The validator output is the source of truth; this table is only orientation.

| Kind | Guards |
|------|--------|
| `scenario` | Framework conventions from k6-scenario-authoring: bucket path, goja-safe imports, thresholds present, no hard-coded secrets or hosts, gate marker syntax. |
| `testplan` | Plan completeness: bucket, profile, SLOs as thresholds, data needs, correlation, target scope. |
| `flow` | Discovery outputs: stayed inside allowed hosts, stop rules honoured, no unsanitized secrets in shareable files. |
| `patch` | A diff to framework or client code: forbidden paths, secrets, unsafe commands. |
| `report` | Every number in the report traces to a run artifact; no leftover client identifiers when the report must be neutral. |

## Fixing common failures

| Symptom | Fix |
|---------|-----|
| Node built-in or `@node/*` import in a scenario | Replace with a k6 module or `@helpers` equivalent. |
| Missing thresholds | Add latency percentile, `http_req_failed` rate and `checks` from the plan SLO. |
| Literal URL, token, cookie or password | Move to `__ENV` / client config / secret backend. |
| Wrong bucket or path | Move the file under `scenarios/<api|flow|domain|chaos|perf>/`. |
| Gate marker ignored | Use `export const gate = "unsafe";` with double quotes at top level. |
| Report number not found in artifacts | Remove it or cite the artifact that contains it. Never invent. |

Never edit the validator, its rules, or a baseline to make an artifact pass. Fix the
artifact or escalate to the human.

## Secret scan

```bash
<repo>/bin/detect-secrets.sh <dir...>
```

Exit 0 clean, 1 findings. Run it on every directory you touched.

## Result format for hand-off

```
GATE: PASS|FAIL|NOT RUN
kind=<kind> paths=<paths> exit=<code>
failures: <one line each, from validator output>
```
