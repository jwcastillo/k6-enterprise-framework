---
title: "Generators — US21"
sidebar_position: 3
---
# Generators — US21

Scaffold new clients, test scenarios, services, and data factories without writing boilerplate.

**Tasks:** T-059, T-060, T-061, T-062, T-063, T-064  
**Scripts:** `bin/generate.js`, `bin/create-client.sh`, `bin/generate-data.js`

---

## Quick Start

```bash
# Interactive generator (menu-driven)
node bin/generate.js

# Non-interactive: create a new client
bin/create-client.sh my-client

# Generate test data
node bin/generate-data.js --type=users --count=1000 --format=csv > data/users.csv
node bin/generate-data.js --type=transactions --count=50000 --format=json
```

---

## Interactive generator — bin/generate.js (T-059)

Launches a menu-driven wizard (no external dependencies — pure Node.js `readline`):

```
k6 Enterprise Framework — Generator
────────────────────────────────────
1) New client
2) New test scenario
3) New service class
4) New data factory
q) Quit

Select option:
```

### Menu: New client (1)

Prompts for:
- Client name (alphanumeric, hyphens, underscores)
- Primary service base URL

Creates the full client directory tree (see `create-client.sh` below).

### Menu: New test scenario (2)

Prompts for:
- Client name (must already exist)
- Scenario name (e.g. `api/smoke-orders`)
- Protocol: http / graphql / websocket / mixed

Creates `clients/{client}/scenarios/{name}.ts` from `shared/templates/generators/scenario-api.ts`.

### Menu: New service class (3)

Prompts for:
- Client name
- Service name (e.g. `OrderService`)
- Base URL

Creates `clients/{client}/lib/services/{name}.ts` from `shared/templates/generators/service.ts`.

### Menu: New data factory (4)

Prompts for:
- Client name
- Factory name (e.g. `OrderFactory`)

Creates `clients/{client}/lib/factories/{name}.ts` from `shared/templates/generators/factory.ts`.

---

## Non-interactive scaffolder — bin/create-client.sh (T-060)

Creates a complete, runnable client directory in under 5 seconds.

```bash
bin/create-client.sh <client-name>
```

### Created structure

```
clients/my-client/
├── config/
│   └── default.json          ← pre-filled client config
├── data/
│   └── .gitkeep
├── lib/
│   ├── factories/
│   │   └── .gitkeep
│   └── services/
│       └── my-client-service.ts   ← example service class
├── reports/                  ← excluded from git
├── scenarios/
│   └── api/
│       └── smoke-baseline.ts      ← runnable smoke test
└── README.md                 ← client documentation
```

### Validation

Name must match `^[a-zA-Z0-9_-]+$`. Duplicate client names are rejected immediately (EC-CLI-010).

### Next steps (printed after scaffold)

```
✓ Client 'my-client' created successfully!

Next steps:
  1. Edit clients/my-client/config/default.json — set your service URL
  2. Run: bin/run-test.sh --client=my-client --scenario=api/smoke-baseline
  3. View report: reports/my-client/api/smoke-baseline/{timestamp}/report.html
```

---

## Data generator — bin/generate-data.js (T-061)

Generate realistic test datasets in CSV or JSON format.

### Usage

```bash
node bin/generate-data.js [options]

Options:
  --type=TYPE        users | products | transactions  (required)
  --count=N          Number of records (default: 100)
  --format=FORMAT    csv | json                       (default: json)
  --output=FILE      Write to file instead of stdout
  --seed=N           Random seed for reproducibility
```

### Data types

**users** — `id`, `username`, `email`, `firstName`, `lastName`, `role`, `country`  
**products** — `id`, `sku`, `name`, `price`, `category`, `stock`, `currency`  
**transactions** — `id`, `userId`, `productId`, `amount`, `currency`, `status`, `timestamp`

### Examples

```bash
# 500 users as CSV (pipe to file)
node bin/generate-data.js --type=users --count=500 --format=csv > data/users.csv

# 10000 products as JSON array
node bin/generate-data.js --type=products --count=10000 --format=json --output=data/products.json

# Reproducible dataset with seed
node bin/generate-data.js --type=transactions --count=200 --seed=42 --format=csv
```

### Streaming mode (count > 10,000)

For large datasets, the generator switches to streaming mode to avoid memory pressure:

```
Generating 50000 transactions...
  ████████████████░░░░░░░░  10000/50000 (20%)  12.3s elapsed
  ████████████████████████  50000/50000 (100%) done in 61.2s
```

Progress is reported every 10% or every 10 seconds (EC-CLI-011).

---

## Templates — shared/templates/generators/

All generators use templates with `{{PLACEHOLDER}}` substitution:

| Template | Used for |
|----------|----------|
| `client-default.json` | Client config stub |
| `scenario-api.ts` | Test scenario skeleton |
| `service.ts` | Service class with CRUD methods |
| `factory.ts` | Data factory class |
| `client-readme.md` | Client README |

### Adding custom templates

1. Copy an existing template to `shared/templates/generators/`
2. Use `{{NAME}}`, `{{CLIENT_NAME}}`, `{{SERVICE_NAME}}`, `{{BASE_URL}}` as placeholders
3. Reference the template in `bin/generate.js` via the `templates` config map

---

## Reference client — clients/examples/ (T-063, T-064)

A fully-annotated reference implementation covering all framework protocols and patterns.

### Scenario catalog

| # | File | Protocol | Pattern |
|---|------|----------|---------|
| 01 | `api/01-auth-bearer.ts` | HTTP | Bearer token auth |
| 02 | `api/02-contract-validation.ts` | HTTP | JSON schema validation |
| 03 | `api/03-pagination.ts` | HTTP | Cursor/page pagination |
| 04 | `api/04-retry-backoff.ts` | HTTP | Exponential retry |
| 05 | `api/05-correlation.ts` | HTTP | Trace header propagation |
| 06 | `api/06-weighted-execution.ts` | HTTP | Weighted scenario distribution |
| 07 | `api/07-structured-logging.ts` | HTTP | StructuredLogger integration |
| 08 | `api/08-rate-limiting.ts` | HTTP | Rate-limit detection + retry |
| 09 | `mixed/09-ecommerce-flow.ts` | HTTP | Multi-step business flow |
| 10 | `api/10-graphql.ts` | GraphQL | Query + mutation |
| 11 | `api/11-file-upload.ts` | HTTP | Multipart upload |
| 12 | `integration/12-websocket.ts` | WebSocket | Echo + pub/sub |
| 13 | `mixed/13-multi-protocol.ts` | HTTP+WS+GQL | Protocol mixing |
| 14 | `api/14-advanced-headers.ts` | HTTP | Tracing + localization headers |
| 15 | `integration/15-smoke-baseline.ts` | HTTP | Framework overhead baseline |

### Running examples

```bash
# Single example scenario
bin/run-test.sh --client=examples --scenario=api/01-auth-bearer

# Run all examples
bin/testing/run-all-tests.sh --client=examples --concurrency=3

# Run only API scenarios
bin/testing/run-all-tests.sh --client=examples --pattern="api/*.ts"
```

### SC-067 — Adaptation time ≤15 minutes

Each scenario file is self-contained and heavily annotated. A developer familiar with k6  
can adapt any scenario to their own service in under 15 minutes by:

1. Copying the scenario file to their client's `scenarios/` directory
2. Updating the `BASE_URL` and endpoint paths
3. Adjusting check thresholds to match their SLO

---

## Non-interactive mode (MCP / CI)

`bin/generate.js` supports `--non-interactive` for use from the MCP server or CI pipelines:

```bash
# Create a service class non-interactively
node bin/generate.js --non-interactive --type=service --client=clienteA --name=OrderService

# Create a test scenario
node bin/generate.js --non-interactive --type=test --client=clienteA --name=api/load-orders
```

This is the same code path invoked by `generate_scaffold` in the MCP server (T-067).
