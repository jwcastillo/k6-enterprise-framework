# k6 Enterprise Framework

> A production-grade, TypeScript-first load testing framework built on [Grafana k6](https://k6.io) — with a two-layer architecture, reusable helpers and patterns, first-class observability, and strict multi-client isolation.

[![k6](https://img.shields.io/badge/k6-v1.6.1-7d64ff)](https://k6.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/node-%3E%3D18-339933)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-11-f69220)](https://pnpm.io)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

---

## Why this framework

Writing one-off k6 scripts is easy. Running **repeatable, reviewable, observable** load tests across many services and teams is not. This framework solves the second problem:

- **Two-layer architecture** — a reusable generic core (`src/`) shared by every workload, and isolated per-client layers (`clients/`) that never leak into each other.
- **Batteries included** — HTTP/WS/GraphQL helpers, auth/retry/pagination/correlation/chaos patterns, a metrics engine, SLO evaluation, RBAC, secrets management, and self-contained HTML reporting.
- **Observability native** — overhead detection, generator health, distributed tracing (W3C / B3 / Jaeger), and Pyroscope profiling.
- **One runner, strong guardrails** — a single CLI enforces a canonical scenario taxonomy and safety gates so tests stay consistent and CI-friendly.

## Requirements

| Tool | Version | Notes |
|------|---------|-------|
| [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) | v1.6.1 | Test execution engine (goja runtime, **not** Node.js) |
| Node.js | >= 18 | CLI tooling, report generation, docs |
| [pnpm](https://pnpm.io) | 11 | The only supported package manager |
| Docker + Compose | optional | Local observability stack (`infrastructure/`) |
| Go | 1.25+ | Only for building a custom k6 binary (`bin/build-binary.sh`) |

## Quick start

```bash
# 1. Install dependencies (pnpm only)
pnpm install

# 2. Run the reference smoke test
./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=smoke

# 3. Open the self-contained HTML report
open reports/_reference/api_smoke-users/html-report-*.html
```

## The test runner

Every run goes through `./bin/run-test.sh`, which **requires both** a client and a scenario:

```bash
./bin/run-test.sh --client=<name> --scenario=<bucket>/<path> --profile=<name>
```

- `--client=<name>` — selects the `clients/<name>/` directory.
- `--scenario=<bucket>/<path>` — the path **must** start with one of the 5 canonical buckets below.
- `--profile=<name>` — named load intensity (e.g. `smoke`, `load`, `stress`, `soak`).

### Scenario taxonomy (5 canonical buckets)

| Bucket | Purpose | Reference example |
|--------|---------|-------------------|
| `api/` | Single-endpoint smoke probes | `clients/_reference/scenarios/api/smoke-users.ts` |
| `flow/` | Multi-step integration flows | `clients/_reference/scenarios/flow/auth-flow.ts` |
| `domain/` | Service-level scenarios (`domain/<service>/<action>.ts`) | `clients/_reference/scenarios/domain/orders-lifecycle.ts` |
| `chaos/` | Fault-injection / resilience scenarios | `clients/_reference/scenarios/chaos/fci-spike.ts` |
| `perf/` | Capacity, breakpoint, stress, soak | `clients/_reference/scenarios/perf/breakpoint-tier.ts` |

### Safety gates

Scenarios can opt into a gate so the runner refuses to run them without an explicit flag:

```typescript
export const gate = "experimental"; // also: "quarantined" | "unsafe"
```

Pass the matching flag (`--experimental`, `--quarantined`, `--unsafe`) to unlock. Gated scenarios exit with code `108` otherwise.

## Architecture

```
k6-enterprise-framework/
├── src/                    # Generic layer — shared across all clients
│   ├── core/               # Config, CLI, validation, RBAC, SLO, secrets
│   ├── helpers/            # HTTP, data, Redis, WS, GraphQL, upload, browser, crypto
│   ├── patterns/           # Auth, retry, pagination, correlation, chaos, funnel
│   ├── metrics/            # Metrics engine + specialized calculators
│   ├── observability/      # Overhead detection, health, tracing, Pyroscope
│   ├── reporting/          # HTML/JSON reports, capacity & trend analysis
│   ├── integrations/       # Notifications, Slack bot
│   ├── node/               # Node-only modules (never imported from k6 scenarios)
│   └── types/              # Shared TypeScript type definitions
├── clients/
│   ├── _reference/         # Canonical example scenarios — start here
│   ├── _benchmark/         # Framework overhead benchmarks
│   └── examples/           # Cookbook-style examples
├── shared/                 # JSON schemas, profiles, templates
├── bin/                    # CLI tooling (run-test, generate-report, validate-config…)
├── test/                   # Vitest unit tests
├── docs-site/              # Docusaurus documentation (EN + ES)
├── mcp-server/             # MCP server for AI-assisted test creation
├── infrastructure/         # Docker Compose, Grafana dashboards, K8s
└── cmd/                    # Custom k6 binary embedding (Go / xk6)
```

### Path aliases

| Alias | Path |
|-------|------|
| `@core/*` | `src/core/*` |
| `@helpers/*` | `src/helpers/*` |
| `@patterns/*` | `src/patterns/*` |
| `@observability/*` | `src/observability/*` |
| `@types-k6/*` | `src/types/*` |
| `@node/*` | `src/node/*` (forbidden from k6 scenarios — enforced by ESLint) |

> **Runtime note:** scenarios run in k6's goja engine, **not** Node.js. There is no `fs`, `http`, `path`, or `url` — use k6 built-ins (`k6/http`, `k6/ws`, `k6/crypto`, …). Webpack bundles each scenario for the `web` target.

## Adding your own client

Your real workloads live in their own isolated, git-ignored client directories — they never get committed to this framework repo:

```
clients/<your-client>/
├── config/      # Environment-specific JSON config
├── scenarios/   # k6 scenarios, organized by the 5 buckets
├── data/        # Test data (CSV/JSON/JSONL)
└── lib/         # Client-specific services & helpers
```

Scaffold one from the reference client, or export an existing client as a standalone repo:

```bash
./bin/create-client.sh --client=<name>
./bin/export-client.sh --client=<name> --output=/path/to/repo --git-init --ci=github
```

## Documentation

Full docs are a bilingual Docusaurus site (`docs-site/`, EN + ES):

```bash
pnpm docs:start        # English
pnpm docs:start:es     # Spanish
pnpm docs:build        # Static build
```

Highlights:

- **Feature Catalog** — `docs-site/docs/framework/feature-catalog.md`
- **Load Profiles** — `docs-site/docs/framework/load-profiles.md`
- **Patterns Guide** — `docs-site/docs/framework/patterns/patterns-guide.md`
- **Metrics Engine** — `docs-site/docs/framework/metrics/metrics-engine.md`
- **Reporting** — `docs-site/docs/framework/reporting/reporting.md`
- **Security** — `docs-site/docs/framework/security/security.md`

## Development

```bash
pnpm build           # Webpack production build
pnpm build:watch     # Webpack watch mode
pnpm typecheck       # tsc --noEmit
pnpm lint            # ESLint
pnpm test            # Vitest unit tests
pnpm validate        # typecheck + lint
```

This project follows [Conventional Commits](https://www.conventionalcommits.org/). Use commitizen (`pnpm exec cz`) for guided messages; pre-commit hooks run lint-staged + Prettier.

## License

[MIT](./LICENSE) © José Castillo
