---
name: security-scanning
description: Scan this repository's Claude skills and agents with NVIDIA SkillSpector (pinned v2.12.0) and run the repo's secret scan — install via uv from the official repository, static (--no-llm) vs semantic scans and providers, exit codes, baselines and fingerprints, SARIF for CI, how to read CAUTION vs SAFE, and scan-skills.sh when present. Use when asked to "scan the skills with SkillSpector", "is this new skill safe", "why is the skill CAUTION", "add skill scanning to CI", or "check the repo for hard-coded secrets". Not for validating generated scenarios or reports (guardrails-gate).
---

# Security scanning

`<repo>` means the repository root.

## SkillSpector install (pinned)

```bash
uv tool install "git+https://github.com/NVIDIA/skillspector.git@v2.12.0"
skillspector --version   # expect v2.12.0
```

Install only with the human's approval. Upgrade by changing the tag deliberately.

## Scans

```bash
# One skill (directory containing SKILL.md), static analysis only
skillspector scan <repo>/.claude/skills/<name> --no-llm

# Every skill directory
skillspector scan <repo>/.claude/skills --recursive --no-llm

# Agent definitions
skillspector scan <repo>/.claude/agents --recursive --no-llm
```

If `<repo>/bin/scan-skills.sh` exists, prefer it (see its `--help`); it wraps these
calls with the repo's settings.

- `--no-llm`: static rules only; no data leaves the machine. Default for this repo.
- Semantic scan (no `--no-llm`) sends skill content to the configured provider
  (`SKILLSPECTOR_PROVIDER`, e.g. anthropic with `ANTHROPIC_API_KEY`). Only with the
  human's approval, and never on files containing client data.

## Reading results

| Output | Meaning |
|--------|---------|
| Recommendation SAFE, 0 findings, status complete | Pass. |
| CAUTION with 0 findings, status partial | Unresolved references: path-like tokens (a directory, a slash, a file name with extension) not bundled with the skill. Write repo paths as `<repo>/...` placeholders or plain prose. |
| Findings listed | Real issue until proven otherwise: fix the skill text. |

Exit codes: 0 by default; `--fail-on-findings` exits 1 on any active finding,
`--fail-on-incomplete` exits 1 on partial analysis. Use both in CI.

## Baselines

`skillspector baseline <dir> --no-llm -o <file> --reason "<why>"` records current
findings by fingerprint; `scan --baseline <file>` then reports only new ones. A
baseline entry needs a written reason and human review. Never baseline to make a new
skill pass. `--use-shipped-baseline` trusts the skill author's baseline: do not use it
on third-party skills.

## CI

`skillspector scan ... --no-llm --format sarif --output <file>` and upload SARIF to the
platform's code-scanning view (see ci-quality-gates).

## Secret scan

`<repo>/bin/detect-secrets.sh [dirs...]` — exit 0 clean, 1 findings. Run it on every
directory you changed before a commit. For generated artifacts also run the
generation gate (guardrails-gate).

## Rules for skill and agent text

- Pin every tool version you mention; no pipe-to-shell installers.
- No instructions to run elevated or destructive commands without human confirmation.
- No sending repository content to external services except documented, redacted
  integrations.
- Precise descriptions: say when to use and when not to.
