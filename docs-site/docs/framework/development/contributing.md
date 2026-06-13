---
title: "Contributing Guide"
sidebar_position: 2
---
# Contributing Guide

Guidelines for contributing to the k6 Enterprise Load Testing Framework.

---

## Table of Contents

1. [Development Setup](#development-setup)
2. [Project Structure](#project-structure)
3. [Development Workflow](#development-workflow)
4. [Commit Conventions](#commit-conventions)
5. [Testing Requirements](#testing-requirements)
6. [Code Style](#code-style)
7. [Pull Request Process](#pull-request-process)
8. [Key Conventions](#key-conventions)

---

## Development Setup

### Prerequisites

- **Node.js** >= 18
- **npm** >= 9
- **k6** >= 1.0.0 (for running tests)
- **Docker** and **Docker Compose** (for infrastructure stack)

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd k6-framework

# Install dependencies
npm install

# Verify setup
npm run validate   # typecheck + lint
npm run test       # run unit tests
npm run build      # webpack production build
```

### Optional: xk6-redis Binary

If working with Redis-based patterns, build the custom k6 binary:

```bash
./bin/build-binary.sh
```

### Optional: Observability Stack

```bash
# Core stack (Grafana + Prometheus + Redis)
docker compose up -d

# Full observability (adds Loki + Tempo + Pyroscope)
docker compose --profile observability up -d
```

---

## Project Structure

```
k6-framework/
  src/
    core/           -- config loading, CLI, validation, RBAC, SLO, secrets
    helpers/        -- request, data, date, redis, websocket, graphql, upload, browser, crypto
    patterns/       -- auth, retry, pagination, correlation, weighted, chaos, contract
    reporting/      -- HTML/JSON reports, capacity analysis, trend visualization
    observability/  -- health monitoring, overhead detection, Pyroscope, tracing
    metrics/        -- calculators (performance, throughput, error, SLA, stability)
    ai/             -- agents (analyst, builder, planner, reporter), anomaly detection
    integrations/   -- notifications, Slack bot
    types/          -- TypeScript type definitions
  clients/
    _reference/     -- canonical example scenarios (tracked in git)
    _benchmark/     -- framework overhead benchmarks (tracked in git)
    examples/       -- cookbook-style example scenarios (tracked in git)
    <client>/       -- real client workloads (gitignored, separate repos)
  bin/              -- CLI tools
  test/             -- Vitest unit tests
  docs/             -- feature documentation (EN + ES)
  infrastructure/   -- Docker Compose, Grafana dashboards, Prometheus config
```

### Path Aliases

| Alias | Path |
|-------|------|
| `@core/*` | `src/core/*` |
| `@helpers/*` | `src/helpers/*` |
| `@observability/*` | `src/observability/*` |
| `@patterns/*` | `src/patterns/*` |
| `@types-k6/*` | `src/types/*` |

---

## Development Workflow

### Common Commands

```bash
# Build
npm run build              # webpack production build
npm run build:watch        # webpack watch mode

# Type checking and linting
npm run typecheck          # tsc --noEmit
npm run lint               # ESLint
npm run lint:fix           # ESLint with auto-fix
npm run format             # Prettier write
npm run validate           # typecheck + lint (run before committing)

# Testing
npm run test               # vitest run
npm run test:watch         # vitest watch
npm run test:coverage      # vitest with v8 coverage

# Running k6 tests
./bin/run-test.sh --client=_reference --scenario=smoke --profile=smoke
```

### Build Pipeline

- **Webpack** auto-discovers `clients/*/scenarios/**/*.ts` as entry points
- Output: `dist/<client>/<scenario-path>.js`
- Target: `web` (k6 goja runtime, NOT Node.js)
- Externals: `k6` builtins and jslib URLs
- CopyWebpackPlugin copies `clients/*/data/` and `clients/*/config/` to `dist/`

---

## Commit Conventions

This project follows [Conventional Commits](https://www.conventionalcommits.org/). Use `npm run commit` for an interactive commitizen prompt.

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Commit Types

| Type | Description |
|------|-------------|
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation only changes |
| `style` | Code style (formatting, semicolons, etc.) |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf` | Performance improvement |
| `test` | Adding or correcting tests |
| `build` | Build system or external dependencies |
| `ci` | CI configuration files and scripts |
| `chore` | Other changes that do not modify src or test files |
| `revert` | Reverts a previous commit |

### Scopes

`core`, `runner`, `helpers`, `redis`, `reporting`, `metrics`, `observability`, `patterns`, `ai`, `ci`, `docs`

### Rules

- Use imperative present tense: "add" not "added" or "adds"
- No capital first letter, no trailing period
- Max 100 characters for subject line
- Reference issues in footer: `Closes #123`
- Breaking changes: `BREAKING CHANGE: <description>` in footer or `!` after type/scope

### Examples

```bash
# Feature
feat(patterns): add funnel pattern with drop-off tracking

# Bug fix
fix(helpers): handle null response body in RequestHelper

# Breaking change
feat(core)!: require Node.js 18+ for config loading

BREAKING CHANGE: dropped support for Node.js 16

# Docs
docs(patterns): add retry pattern usage examples
```

### Automated Versioning

Commit types map to version bumps:

| Commit Type | Version Bump | Example |
|-------------|-------------|---------|
| `fix:` | patch | 1.0.0 -> 1.0.1 |
| `feat:` | minor | 1.0.0 -> 1.1.0 |
| `BREAKING CHANGE:` or `!` | major | 1.0.0 -> 2.0.0 |

```bash
# Bump version based on commit history
npm run version:bump

# Manual version bump
./bin/version.sh patch   # 1.2.3 -> 1.2.4
./bin/version.sh minor   # 1.2.3 -> 1.3.0
./bin/version.sh major   # 1.2.3 -> 2.0.0
```

---

## Testing Requirements

### Unit Tests

- Tests use **Vitest** with the `test/**/*.test.ts` convention
- Test setup is in `test/setup.ts`
- All new features must include unit tests
- Run `npm run test:coverage` to verify coverage

### Writing Tests

```typescript
// test/helpers/data-helper.test.ts
import { describe, it, expect } from "vitest";
import { randomEmail, uuid } from "../../src/helpers/data-helper";

describe("DataHelper", () => {
  it("should generate valid email format", () => {
    const email = randomEmail();
    expect(email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  });

  it("should generate valid UUID v4", () => {
    const id = uuid();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
```

### k6 Integration Tests

```bash
# Run reference scenarios against the built output
npm run test:reference
```

---

## Code Style

### ESLint and Prettier

The project uses ESLint for linting and Prettier for formatting.

```bash
# Check lint
npm run lint

# Auto-fix lint issues
npm run lint:fix

# Format all files
npm run format

# Combined validation
npm run validate   # typecheck + lint
```

### Key Style Rules

- TypeScript strict mode
- No `any` types (use `unknown` + type guards)
- Prefer `const` over `let`
- Use explicit return types on exported functions
- Use JSDoc comments for public APIs

### k6 Runtime Constraints

Code in `src/` runs in the k6 goja runtime (Go-based JS engine), NOT Node.js:

- No `fs`, `http`, `path`, `url` Node.js modules -- use k6 APIs instead
- No `async/await` in k6 VU code (except with xk6 extensions like xk6-redis)
- Use `k6/http` for HTTP requests, `k6/crypto` for crypto
- `__ENV` for environment variables (not `process.env`)
- `open()` for reading files at init time

Code in `bin/` runs in Node.js and can use Node.js APIs freely.

---

## Pull Request Process

### Before Submitting

1. Run the full validation suite:
   ```bash
   npm run validate   # typecheck + lint
   npm run test       # unit tests
   npm run build      # verify build succeeds
   ```

2. Ensure all new code has tests

3. Update documentation if adding new features:
   - Dual-language docs: `.md` for EN, `.es.md` for ES in `docs/`
   - Update relevant existing docs if behavior changes

4. Follow the commit conventions described above

### PR Guidelines

- Keep PRs focused -- one feature or fix per PR
- Write a clear PR description explaining the "why"
- Include a test plan with steps to verify the changes
- Reference related issues in the PR description

### Review Checklist

- [ ] Code follows project style (ESLint/Prettier pass)
- [ ] TypeScript compiles without errors
- [ ] Unit tests pass and cover new code
- [ ] Documentation updated if needed
- [ ] No hardcoded secrets or credentials
- [ ] k6 runtime compatibility verified (no Node.js-only APIs in `src/`)

---

## Key Conventions

### Client Isolation

- Each client has its own `config/`, `data/`, and `scenarios/` directories under `clients/<name>/`
- Client directories (except `_reference`, `_benchmark`, `examples`) are gitignored
- Environment configs: `envs/<client>.env` (gitignored), `envs/<client>.env.example` (tracked)

### Documentation

- Dual-language: `.md` for English, `.es.md` for Spanish in `docs/`
- Use the existing doc style: language toggle header, table of contents, horizontal rules between sections

### Scenarios

- Scenarios import from `../../src` (relative) or via path aliases (`@core/*`, `@helpers/*`, etc.)
- Each scenario is a TypeScript file under `clients/<name>/scenarios/`
- Webpack auto-discovers and bundles them as separate entry points

### speckit Workflow

For feature development using speckit:
- Specs live under `specs/<feature-id>/`
- Workflow: specify > clarify > plan > tasks > analyze > checklist > implement > taskstoissues

---

## Related Documentation

- [Workflow](/docs/framework/workflow) -- end-to-end test execution workflow
- [Test Types](/docs/framework/test-types) -- supported test types and profiles
- [Client Management](/docs/framework/advanced/client-management) -- creating and managing clients
- [Code Quality](/docs/framework/development/code-quality) -- quality standards and enforcement
