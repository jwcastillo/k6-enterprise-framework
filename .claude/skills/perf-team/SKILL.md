---
name: perf-team
description: Orchestrate this framework's performance engineering agent team end to end — discover, plan, author, validate, smoke, load (human-gated), analyze, report — delegating each step to its subagent (perf-flow-discoverer, perf-test-architect, perf-scenario-author, perf-browser-engineer, perf-guardrail-reviewer, perf-load-operator, perf-results-analyst, perf-reporter, perf-framework-maintainer) with fixed hand-off artifacts and mandatory gates. Use when asked to "run the perf team on <flow or service>", "take <journey> from discovery to report", "plan and execute a load test for <service> with the agents", or "which agent owns <step>". Not for a single isolated task that one skill covers.
---

# Performance engineering team

`<repo>` means the repository root. You (the main session) coordinate; subagents do the
work. Delegate each step with the Agent tool to the owner below, pass the input
artifacts by path, and check the gate before starting the next step.

## Pipeline

| # | Step | Owner (subagent) | Input | Output (hand-off artifact) |
|---|------|------------------|-------|----------------------------|
| 1 | Discover | perf-flow-discoverer | URL, goal, scope confirmed by human | `reports/discovery/<flow>/` (flow HAR, JSON, narrative, flow plan) |
| 2 | Plan | perf-test-architect | Requirements, discovery dir or HAR | `reports/perf-team/<work-id>/test-plan.md` |
| 3 | Author | perf-scenario-author (+ perf-browser-engineer for captures, HAR conversion, browser probes) | Approved plan | Scenario files in the client `scenarios/<bucket>/` |
| 4 | Validate | perf-guardrail-reviewer | Changed files + kind | PASS/FAIL verdict with evidence |
| 5 | Smoke | perf-load-operator | Reviewed scenario | Run record + artifact dir under `reports/` |
| 6 | Load (human-gated) | perf-load-operator | Smoke PASS + explicit human "yes" for this run | Run record + artifact dir, testid |
| 7 | Analyze | perf-results-analyst | Run records, plan, optional baseline | `reports/perf-team/<work-id>/analysis.md` |
| 8 | Report | perf-reporter | Analysis + artifacts | `reports/perf-team/<work-id>/report/` + number-to-source list |
| - | Framework changes (any time) | perf-framework-maintainer | Change request | Branch + PR |

Steps 1 and 8 are optional; a team run may start at step 2 with written requirements.
`<work-id>` is a short kebab-case name agreed at the start (e.g. `orders-api-load`).
Everything under `reports/` is gitignored; only scenarios, lib and synthetic data are
committed, after the gate.

## Mandatory gates

1. Scope: discovery and any run name the target, environment and allowed hosts; the
   human confirms. Production scope is confirmed explicitly, every time.
2. Generation gate: `validate-generated` must PASS (kind = flow, testplan, scenario,
   patch, report as applicable) and the reviewer must return PASS before a scenario is
   committed or run. If the validator is not on the branch, the reviewer reports NOT RUN
   and the human decides.
3. Smoke before load: the same scenario and commit must exit 0 with `--profile=smoke`
   before any heavier profile.
4. Human confirmation for load: every non-smoke run, every `--unsafe` run, every
   production target, every distributed run, and every capacity search needs an explicit
   human "yes" for that specific run. Approvals never carry over.
5. Deterministic numbers: figures in analysis and reports come only from run artifacts
   and deterministic tools (compare, trend, SLO report, generated analysis). LLM text may
   explain, never invent or recompute.
6. Stop on failure: exit 107/1 or a reviewer FAIL returns the work to its owner; exit
   99 is a valid result that goes to analysis, never "fixed" by loosening thresholds.

## RACI

R = does the work, A = accountable/approves, C = consulted, I = informed. "Human" is the
person driving the session.

| Step | Discoverer | Architect | Author | Browser eng. | Reviewer | Operator | Analyst | Reporter | Maintainer | Human |
|------|-----------|-----------|--------|--------------|----------|----------|---------|----------|------------|-------|
| Discover | R | C | | C | C | | | | | A |
| Plan | C | R | C | C | | C | | | | A |
| Author | | C | R | R (browser) | C | | | | C | I |
| Validate | | | I | I | R | | | | | A (overrides) |
| Smoke | | | I | | | R | I | | | I |
| Load | | C | | | | R | I | | | A |
| Analyze | | C | | | | C | R | I | | I |
| Report | | | | | C | | C | R | | A |
| Framework change | | | C | | C | | | | R | A |

## Skills map

| Subagent | Preloaded skills |
|----------|------------------|
| perf-flow-discoverer | flow-discovery, playwright-automation, har-to-k6, jev-typesafe, test-data-management, guardrails-gate |
| perf-test-architect | k6-scenario-authoring, run-operations, test-data-management, chaos-resilience, har-to-k6, guardrails-gate |
| perf-scenario-author | k6-scenario-authoring, test-data-management, chaos-resilience, guardrails-gate, k6 |
| perf-browser-engineer | playwright-automation, k6-browser, har-to-k6, k6-scenario-authoring, guardrails-gate |
| perf-guardrail-reviewer | guardrails-gate, security-scanning, k6-scenario-authoring, ci-quality-gates |
| perf-load-operator | run-operations, k6-distributed-runs, observability-setup, chaos-resilience |
| perf-results-analyst | results-analysis, jev-typesafe, observability-setup, promql |
| perf-reporter | reporting-toolkit, performance-report, results-analysis, guardrails-gate |
| perf-framework-maintainer | framework-development, client-export, ci-quality-gates, framework-mcp-server, guardrails-gate, security-scanning |

Other repo skills any agent may invoke on demand: k6, k6-docs, k6-performance-tester,
performance-engineering, dashboarding, promql, opentelemetry, test-data-management.

## Hand-off message format

Every subagent ends with: what it did, artifact paths, gate results (PASS / FAIL / NOT
RUN with reason), open questions, and the next owner. Pass that message verbatim to the
next subagent together with the artifact paths.

## How the human invokes it

- Whole pipeline: "Use the perf-team skill to take the orders API from plan to report
  on staging; work-id orders-api-load." The session plans the steps and asks for scope.
- One step: "Ask perf-load-operator to run the smoke for api/orders." or
  `@perf-results-analyst analyze the last run of api/orders`.
- List agents: `/agents`.
- In a standalone export (created with `--with-claude`) the same team works; the runner
  has no `--client` flag and monorepo-only tools may be missing (agents say so).
