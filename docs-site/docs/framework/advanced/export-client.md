---
title: "Client Export"
sidebar_position: 5
---
# Client Export

Export a client from the monorepo into a fully standalone repository that compiles, typechecks, and runs tests independently — no monorepo required.

---

## Table of Contents

1. [Overview](#overview)
2. [Usage](#usage)
3. [Required Parameters](#required-parameters)
4. [Options](#options)
5. [Capabilities](#capabilities)
6. [Standalone Layout](#standalone-layout)
7. [Import Rewriting](#import-rewriting)
8. [CI/CD Generation](#cicd-generation)
9. [New Client Scaffolding](#new-client-scaffolding)
10. [Updating the Framework](#updating-the-framework)
11. [Export Manifest](#export-manifest)
12. [Examples](#examples)

---

## Overview

The `bin/export-client.sh` script extracts a single client directory from the monorepo and produces a self-contained repository with:

- All client files (`scenarios/`, `lib/`, `config/`, `data/`)
- A vendorized copy of the framework core (`framework/`)
- Rewritten imports pointing to the local `framework/` directory
- Generated configuration files (`package.json`, `tsconfig.json`, `webpack.config.js`, etc.)
- A standalone test runner (`bin/run-test.sh`)
- An update script to pull new framework versions (`bin/update-framework.sh`)

The exported repository works independently — recipients only need `npm install && npm run build` to get started.

### Pipeline

The export follows a 5-step pipeline:

1. **Validate inputs** — client exists, output path is writable, no path traversal
2. **Copy files** — client files + framework core
3. **Rewrite imports** — `../../../src/` → `../framework/src/`
4. **Generate configs** — `package.json`, `tsconfig.json`, `webpack.config.js`, `.eslintrc.json`, `.gitignore`, `README.md`
5. **Post-export validation** — `npm install` + typecheck (optional)

---

## Usage

```bash
./bin/export-client.sh --client <name> --output <path> [OPTIONS]
```

### Dry run (preview without creating files)

```bash
./bin/export-client.sh --client=_reference --output=/tmp/test --dry-run
```

---

## Required Parameters

| Parameter | Description |
|-----------|-------------|
| `--client <name>` | Client directory name under `clients/`. Must exist in the monorepo (unless `--new` is used). |
| `--output <path>` | Output directory for the standalone repository. Must not exist unless `--force` is used. |

---

## Options

| Option | Description |
|--------|-------------|
| `--force` | Overwrite the output directory if it already exists. |
| `--skip-validate` | Skip post-export validation (`npm install` + typecheck). Useful for CI or fast exports. |
| `--git-init` | Initialize a git repository with an initial commit in the output directory. |
| `--ci <provider>` | Generate a CI/CD workflow. Supported: `github`, `gitlab`, `none` (default). |
| `--dry-run` | Show what would be exported without creating any files. |
| `--debug` | Enable verbose debug logging. |
| `--new` | Create a new client from scaffolding templates and export it (see [New Client Scaffolding](#new-client-scaffolding)). |
| `--service <name>` | Service name for `--new` scaffolding (default: `api`). |

---

## Capabilities

Optional flags to include extra tooling in the exported repository. Use `--full` to enable all.

| Flag | What it includes |
|------|-----------------|
| `--with-reports` | `bin/report.sh` — HTML report generator |
| `--with-observability` | `bin/observability.sh` + `infrastructure/` — Grafana, Prometheus, and dashboards |
| `--with-binary` | `bin/build-binary.sh` — standalone k6 binary builder (Go embed) |
| `--with-claude` | `.claude/` — CLAUDE.md, settings, and skills for Claude Code integration |
| `--with-mcp` | `mcp-server/` — standalone MCP server for AI-assisted test creation |
| `--full` | All of the above |

---

## Standalone Layout

```
<output>/
├── config/                Client configuration (default.json, staging.json, etc.)
├── data/                  Test data files (CSV, JSON)
├── lib/                   Client services, helpers, factories
│   ├── services/
│   └── factories/
├── scenarios/             k6 test scenarios (TypeScript)
│   ├── api/               Single-endpoint tests
│   ├── integration/       Multi-step flows
│   └── mixed/             Weighted traffic patterns
├── framework/             Framework core (vendorized)
│   ├── src/               Helpers, patterns, core modules
│   ├── shared/            Profiles and schemas
│   ├── bin/               Validation scripts
│   └── VERSION            Framework version at export time
├── bin/
│   ├── run-test.sh        Standalone test runner (5-step pipeline)
│   └── update-framework.sh   Update framework from monorepo or remote
├── package.json           Generated (with build, typecheck, lint scripts)
├── tsconfig.json          Generated (with path aliases to framework/)
├── webpack.config.js      Generated (auto-discovers scenarios/)
├── .eslintrc.json         Generated
├── .gitignore             Generated
├── README.md              Generated (with Quick Start, scenario table, structure)
└── export-manifest.json   Export metadata (version, date, file counts)
```

With capabilities enabled, additional files appear:

| Capability | Additional files |
|-----------|-----------------|
| `--with-reports` | `bin/report.sh` |
| `--with-observability` | `bin/observability.sh`, `infrastructure/` |
| `--with-binary` | `bin/build-binary.sh` |
| `--with-claude` | `.claude/CLAUDE.md`, `.claude/settings.local.json`, `.claude/skills/` |
| `--with-mcp` | `mcp-server/` |

---

## Import Rewriting

During export, all monorepo-style imports are rewritten to point to the local `framework/` directory:

```typescript
// Before (monorepo)
import { RequestHelper } from '../../../src/helpers/request';
import { retryPattern } from '../../../src/patterns/retry';

// After (standalone)
import { RequestHelper } from '../framework/src/helpers/request';
import { retryPattern } from '../framework/src/patterns/retry';
```

The rewriting:
- Converts relative paths like `../../../src/` to `../framework/src/`
- Preserves local imports (`./`, `../lib/`, `../config/`) untouched
- Preserves `k6` and `k6/*` imports untouched
- Preserves external URL imports (jslib) untouched

---

## CI/CD Generation

### GitHub Actions (`--ci=github`)

Generates `.github/workflows/k6.yml` with:
- Triggers on push/PR to `main` + manual dispatch with scenario/profile inputs
- Node.js 20 setup with npm cache
- k6 installation from official APT repository
- Build + typecheck + run pipeline
- Report artifact upload (30-day retention)

### GitLab CI (`--ci=gitlab`)

Generates `.gitlab-ci.yml` with:
- 4 stages: `validate` → `build` → `test` → `report`
- k6 installation in `before_script`
- Build artifacts passed between stages
- Report artifacts with 30-day retention

---

## New Client Scaffolding

Use `--new` to create a client from scratch without needing it in the monorepo first:

```bash
./bin/export-client.sh --client=payments-team --new --service=payments --output=~/payments-k6
```

This scaffolds:
- `config/default.json` with the service name pre-configured
- `lib/services/` and `lib/factories/` with starter files
- `scenarios/api/`, `scenarios/integration/`, `scenarios/mixed/` with example tests
- All framework files and generated configs

The temporary scaffolding is cleaned up automatically — nothing is left in the monorepo.

:::caution
`--new` will fail if a client with the same name already exists in the monorepo. To export an existing client, omit the `--new` flag.
:::

---

## Updating the Framework

Exported repositories include `bin/update-framework.sh` to pull newer framework versions:

```bash
# Update from a local monorepo checkout
./bin/update-framework.sh --from=/path/to/k6-enterprise-framework --yes

# Update from a remote git repository
./bin/update-framework.sh --from=github:org/k6-enterprise-framework --ref=v1.2.0
```

The update script replaces only the `framework/` directory, preserving all client files.

---

## Export Manifest

Every export produces an `export-manifest.json` with metadata:

```json
{
  "exportVersion": "1.0.0",
  "sourceFramework": "k6-enterprise-framework",
  "sourceVersion": "1.5.0",
  "client": "my-client",
  "exportedAt": "2026-03-23T10:30:00Z",
  "exportedBy": "bin/export-client.sh",
  "filesExported": {
    "scenarios": 12,
    "lib": 8,
    "config": 3,
    "data": 2,
    "frameworkSrc": 45,
    "total": 70
  },
  "importsRewritten": 34,
  "capabilities": {
    "reporting": false,
    "observability": false,
    "binaryBuilder": false,
    "claude": false,
    "mcp": false
  }
}
```

This manifest is used by `update-framework.sh` to track versions and by the team for audit purposes.

---

## Examples

### Export an existing client

```bash
./bin/export-client.sh \
  --client=my-client \
  --output=/tmp/my-client-standalone
```

### Full export with git and GitHub Actions

```bash
./bin/export-client.sh \
  --client=my-team \
  --output=~/my-team-k6 \
  --full \
  --git-init \
  --ci=github
```

### Create a new client from scratch

```bash
./bin/export-client.sh \
  --client=payments-team \
  --new \
  --service=payments \
  --output=~/payments-k6 \
  --git-init \
  --ci=gitlab
```

### Export with only reporting and observability

```bash
./bin/export-client.sh \
  --client=_reference \
  --output=/tmp/ref-standalone \
  --with-reports \
  --with-observability \
  --force
```

### Dry run to preview

```bash
./bin/export-client.sh \
  --client=_reference \
  --output=/tmp/test \
  --dry-run
```
