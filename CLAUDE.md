# k6 Enterprise Framework

Two layers: framework core in `src/` (TypeScript bundled for the k6 goja runtime, not
Node.js) and clients in `clients/<name>/`. All runs go through `./bin/run-test.sh`.
Use pnpm. Before a commit: `pnpm typecheck && pnpm lint && pnpm test`. Conventional
Commits. Public repository: no client names, hosts, IPs or credentials.

## Agent team

A performance engineering team of subagents lives in `.claude/agents/` and is
coordinated by the `perf-team` skill (`.claude/skills/perf-team/SKILL.md`):

discover (perf-flow-discoverer) → plan (perf-test-architect) → author
(perf-scenario-author, perf-browser-engineer) → validate (perf-guardrail-reviewer) →
smoke → load, human-gated (perf-load-operator) → analyze (perf-results-analyst) →
report (perf-reporter). Framework changes: perf-framework-maintainer.

Non-negotiable gates: the generation gate and reviewer PASS before a scenario is
committed; smoke exits 0 before any load; every heavier, `--unsafe`, production,
distributed or capacity run needs an explicit human "yes" for that run; numbers in
analyses and reports come only from run artifacts and deterministic tools.
Docs: `docs-site/docs/framework/ai/agent-team.md`.
