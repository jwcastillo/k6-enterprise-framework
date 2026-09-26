---
name: ci-quality-gates
description: Wire this framework into CI pipelines as quality gates — the GitHub Actions and GitLab client templates, exit codes as gate results, thresholds as the pass/fail contract, JUnit export, baseline regression gating (--gate-baseline, compare.sh / k6-compare), nightly regression suites (run-regression.sh), and security scans (secret scan, SkillSpector, generation gate) as pipeline steps. Use when asked to "add a k6 smoke gate to the pipeline", "fail the build on performance regression", "publish k6 results as JUnit", "set up the nightly regression run", or "scan skills in CI". Not for running ad-hoc tests locally (run-operations).
---

# CI quality gates

`<repo>` means the repository root.

## Templates

- GitHub Actions: `<repo>/infrastructure/ci-templates/github-actions-client.yml`
- GitLab CI: `<repo>/infrastructure/ci-templates/gitlab-ci-client.yml`
- A standalone export can generate one: `export-client.sh ... --ci=github|gitlab`
  (see client-export).

Template rules to keep: minimal `permissions` (contents: read), actions pinned to a
full commit SHA, secrets only via the CI secret store, `timeout-minutes` set, no
`pull_request_target` with secrets, no untrusted event fields interpolated into shell.

## Gate semantics

| Runner exit | CI meaning |
|-------------|------------|
| 0 | pass |
| 99 | fail: thresholds / regression gate (a real performance failure) |
| 107 | fail: broken script, config or target guard (a pipeline defect) |
| 108 | fail: gated scenario in CI; CI never passes `--unsafe` |
| 1 | fail: framework error or critical regression |

- PR pipelines: `smoke` or `quick` only, against non-production.
- Thresholds are the contract. A PR that loosens thresholds needs a human reviewer's
  explicit approval, stated in the PR.

## Results in CI

- JUnit: the runner writes `junit-<ts>.xml` next to the summary; the standalone tool is
  `node <repo>/bin/junit.js --summary=<summary.json> [--out=<file>] [--suite=<name>]`
  (exit 0 even when thresholds failed; gating is the runner's exit code).
- Upload the whole run directory under `reports/` as a build artifact.

## Regression gating

- Per run: `--gate-baseline=<baseline summary.json>` (or `K6_GATE_BASELINE`). Failure
  surfaces as exit 99.
- Pairwise: `<repo>/bin/compare.sh <baseline> <current>` — exit 0 ok, 3 regression,
  5 load-model mismatch, 1 error. k6-compare is used when installed; install it only
  from a pinned version.
- Baselines are updated deliberately (after a reviewed, accepted run), never
  automatically by the pipeline that is being gated.
- Nightly/weekly: `<repo>/bin/run-regression.sh --suite=<name> --client=<c> [--env=<env>]`
  with suites defined in the client config; exit 0 none, 1 significant, 99 critical.

## Security steps

- `<repo>/bin/detect-secrets.sh` on source and client directories (exit 1 = findings).
- Generation gate for AI-generated artifacts (see guardrails-gate).
- Skill scanning with SkillSpector on `.claude` content (see security-scanning); publish
  SARIF where the platform supports it.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` before any run step.
