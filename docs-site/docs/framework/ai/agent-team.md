---
id: agent-team
title: Claude Code Agent Team
sidebar_position: 2
---

# Claude Code Agent Team

The repository ships a performance engineering team for [Claude Code](https://code.claude.com/docs):
nine subagents in `.claude/agents/`, one orchestrator skill (`perf-team`) and a set of
specialist skills in `.claude/skills/`. The team takes a user journey or a service from
discovery to a client report while enforcing the framework's safety gates.

This is independent of the [runtime AI agents](./agents.md) in `src/ai` (Planner,
Builder, Analyst, Reporter). The test architect may use the runtime planner as a
draft generator when an LLM key is configured.

## Pipeline

```
 human scope ──► perf-flow-discoverer ──► perf-test-architect ──► perf-scenario-author
                  (discover-flow.js,        (test-plan.md)          + perf-browser-engineer
                   Playwright, HAR)                                 (scenarios/<bucket>/)
                                                                          │
                                                                          ▼
 perf-reporter ◄── perf-results-analyst ◄── perf-load-operator ◄── perf-guardrail-reviewer
 (report/)         (analysis.md)            smoke ─► [human yes] ─► load   (validate-generated,
                                            (bin/run-test.sh only)          secrets, SkillSpector)

 perf-framework-maintainer: changes to src/, bin/, export, docs (any time, via PR)
```

Hand-off artifacts live under `reports/` (gitignored): `reports/discovery/<flow>/` and
`reports/perf-team/<work-id>/` (`test-plan.md`, `analysis.md`, `report/`). Only
scenarios, client libraries and synthetic data are committed.

## Gates

1. **Scope** — discovery and runs name the target, environment and allowed hosts; the
   human confirms. Production scope is confirmed explicitly every time.
2. **Generation gate** — `node bin/validate-generated.js --kind=<scenario|testplan|flow|patch|report>`
   must pass and the reviewer must return PASS before a scenario is committed or run.
   When the validator is not available, the reviewer reports `NOT RUN` and the human
   decides.
3. **Smoke before load** — the same scenario must exit `0` with `--profile=smoke` first.
4. **Human confirmation for load** — every non-smoke, `--unsafe`, production,
   distributed or capacity-search run needs an explicit "yes" for that run.
5. **Deterministic numbers** — analysis and reports use only numbers from run artifacts
   and deterministic tools (compare, trend, SLO report, generated analysis).

The reviewer, operator and discoverer carry a `PreToolUse` hook
(`bin/agent-bash-guard.js`): the reviewer may only run validators, scanners,
typecheck/lint/test and read-only git; the operator can never call raw `k6 run` /
`k6 cloud` or set `K6_ALLOW_PROD_LOAD`, and heavy, unsafe, production and cluster
commands always prompt the human; every discovery run prompts for scope confirmation.

## Agents

| Agent | Tools | Preloaded skills |
|-------|-------|------------------|
| `perf-flow-discoverer` | Read, Grep, Glob, Bash (guarded) | flow-discovery, playwright-automation, har-to-k6, jev-typesafe, test-data-management, guardrails-gate |
| `perf-test-architect` | Read, Grep, Glob, Write (plan only), Bash | k6-scenario-authoring, run-operations, test-data-management, chaos-resilience, har-to-k6, guardrails-gate |
| `perf-scenario-author` | Read, Grep, Glob, Edit, Write, Bash | k6-scenario-authoring, test-data-management, chaos-resilience, guardrails-gate, k6 |
| `perf-browser-engineer` | Read, Grep, Glob, Edit, Write, Bash | playwright-automation, k6-browser, har-to-k6, k6-scenario-authoring, guardrails-gate |
| `perf-guardrail-reviewer` | Read, Grep, Glob, Bash (allowlist) | guardrails-gate, security-scanning, k6-scenario-authoring, ci-quality-gates |
| `perf-load-operator` | Read, Grep, Glob, Bash (guarded) | run-operations, k6-distributed-runs, observability-setup, chaos-resilience |
| `perf-results-analyst` | Read, Grep, Glob, Write, Bash | results-analysis, jev-typesafe, observability-setup, promql |
| `perf-reporter` | Read, Grep, Glob, Write, Edit, Bash | reporting-toolkit, performance-report, results-analysis, guardrails-gate |
| `perf-framework-maintainer` | Read, Grep, Glob, Edit, Write, Bash | framework-development, client-export, ci-quality-gates, framework-mcp-server, guardrails-gate, security-scanning |

## Skills

| Skill | Covers |
|-------|--------|
| `perf-team` | Orchestration: pipeline, owners, hand-offs, gates, RACI |
| `k6-scenario-authoring` | Buckets, aliases, goja-only imports, patterns, thresholds, tags, gate markers |
| `flow-discovery` | Safe use of `discover-flow.js`, scoping, outputs, hand-off |
| `guardrails-gate` | `validate-generated` kinds, common failures, secret scan |
| `run-operations` | Runner flags, profiles, gates, exit codes 0/1/99/107/108, abort, capacity search |
| `results-analysis` | Artifact map, compare/trend/SLO tools, deterministic-first rule, triage |
| `k6-distributed-runs` | k6-operator Helm chart, parallelism, testid, data via Secret or init container |
| `test-data-management` | SharedArray/DataPool, uniqueness across VUs and pods, generation, Redis, PII |
| `observability-setup` | Local stack, runner outputs, native histograms, tracing, dashboards |
| `ci-quality-gates` | CI templates, exit-code gates, JUnit, regression gating, security steps |
| `client-export` | `export-client.sh`, standalone layout, `update-framework.sh` |
| `chaos-resilience` | Chaos bucket, chaos-injection pattern, continuity metrics, approvals |
| `playwright-automation` | Playwright capture (not load), HAR modes, auth state, routing, Test Agents, MCP |
| `k6-browser` | k6 browser module, Web Vitals, probe pattern, `-with-browser` image |
| `jev-typesafe` | TypeSafe Jev typed decisions, triage, discovery decider, redaction |
| `har-to-k6` | HAR capture, sanitizing, conversion (k6 Studio, har-to-k6), mapping to conventions |
| `security-scanning` | SkillSpector (pinned), baselines, SARIF, secret scan |
| `framework-development` | Changing `src/` and `bin/` safely, tests, docs EN/ES, commits |
| `framework-mcp-server` | The framework MCP server tools and their rules |
| `reporting-toolkit` | Which tool per deliverable: performance-report, archify, docx/pdf/pptx/xlsx |

Existing skills (`k6`, `k6-docs`, `k6-performance-tester`, `performance-engineering`,
`performance-report`, `promql`, `dashboarding`, `opentelemetry`) are reused as-is.

### Optional reporting tools

- **archify** (diagrams) is pinned in `skills-lock.json` (tag `v2.16.0`) but not
  vendored. Install on demand with `npx skills@1.7.0 experimental_install` and scan it
  with SkillSpector before use; the installed folder is gitignored.
- **Document skills** (docx, pdf, pptx, xlsx) have a proprietary license and are enabled
  as the `document-skills@anthropic-agent-skills` plugin from the `anthropics/skills`
  marketplace, declared by a maintainer in the project settings
  (`extraKnownMarketplaces` + `enabledPlugins`). See the `reporting-toolkit` skill.

## How to use

```text
# Whole pipeline
Use the perf-team skill to take the orders API from plan to report on staging;
work-id orders-api-load.

# One step
Ask perf-load-operator to run the smoke for api/orders.
@perf-results-analyst analyze the last run of api/orders
```

`/agents` lists the team. In a standalone export created with
`./bin/export-client.sh --with-claude`, the agents, the repo skills and the Bash guard
are copied; the standalone runner has no `--client` flag and does not enforce scenario
gates, so the agents check `export const gate` themselves.

## Verification

- `pnpm test` runs `test/claude/agent-team.test.ts`: every agent and skill parses, agent
  skills exist, the reviewer has no edit tools, and the Bash guard decisions hold.
- `skillspector scan .claude/agents --recursive --no-llm` and
  `skillspector scan .claude/skills/<name> --no-llm` report SAFE for the team files.
