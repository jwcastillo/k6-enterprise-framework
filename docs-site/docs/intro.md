---
title: "k6 Enterprise Load Testing Framework"
sidebar_position: 1
---
# k6 Enterprise Load Testing Framework

A unified, self-service enterprise load testing platform built on [Grafana k6](https://k6.io) with a **two-layer architecture**: a reusable generic core (`src/`) and isolated per-client product layers (`clients/`).

**192+ features** across 16 categories — load profiles, helpers, patterns, metrics, reporting, observability, security, CI/CD, and AI.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Run the reference smoke test
./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=smoke

# 3. Run a consolidated artifact test
./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=smoke

# 4. View the interactive HTML report
open reports/_reference/api_smoke-users/html-report-*.html
```

---

## Architecture

```
k6-enterprise-framework/
├── src/                        # Generic layer (shared across all clients)
│   ├── core/                   # Execution engine, config loader, client resolver,
│   │                           #   profile loader, secrets manager, SLO evaluator,
│   │                           #   input validator, RBAC, audit log
│   ├── helpers/                # 14 reusable helpers
│   ├── patterns/               # 10 test patterns
│   ├── metrics/                # 125+ metrics engine
│   ├── observability/          # Generator health, overhead detector
│   └── reporting/              # HTML report generator, trend visualizer,
│                               #   capacity analyzer, JSON summary
├── shared/
│   ├── profiles/               # 13 load profile JSON definitions
│   └── schemas/                # JSON Schema definitions
├── clients/
│   ├── _reference/             # Reference implementation (start here)
│   ├── _benchmark/             # Framework overhead benchmark
│   └── examples/               # Example scenarios (groups, custom metrics, web vitals)
├── infrastructure/
│   ├── docker-compose.yml      # Observability stack
│   ├── grafana/dashboards/     # 3 Grafana dashboards (JSON provisioned)
│   └── k8s/                    # Kubernetes manifests (RBAC, NetworkPolicy)
├── bin/                        # CLI scripts (run-test, generators, exporters)
├── ci-templates/               # GitHub Actions + GitLab CI templates
└── reports/                    # Generated reports (HTML, JSON, PDF, LLM analysis)
```

---

## Features Matrix

| Category | Count | Highlights |
|----------|-------|------------|
| Load Profiles | 9 | smoke, quick, load, rampup, capacity, stress, spike, breakpoint, soak |
| Helpers | 14 | request, data, date, header, validation, performance, logger, redis, upload, graphql, websocket, data-pool |
| Patterns | 10 | auth, correlation, pagination, retry, weighted-execution, contract, mock-server, chaos-injection, redis-coordination, funnel |
| Metrics | 125+ | HTTP, checks, groups, custom (Trend/Counter/Rate/Gauge), Web Vitals, SLO, generator health |
| Reporting | 17+ | Interactive HTML, PDF/PNG export, LLM analysis, auto-comparison, trends, branding |
| Grafana Dashboards | 3 | Load Test Overview, Enterprise Analytics, Web Vitals |
| Custom Metrics | 4 types | Trend, Counter, Rate, Gauge — auto-detected in dashboards |
| Groups Analysis | Auto | Synthetic threshold injection, root_group supplementation, timing + checks |
| SLA/SLO | Auto | 3-state evaluation (cumple/en_riesgo/incumple), APDEX scoring, monthly reports |
| Security | 14 | RBAC, audit log, path traversal, shell hardening, YAML parsing, secrets, PII redaction |
| CI/CD | 2 | GitHub Actions, GitLab CI templates with detect-secrets |
| Observability | 5 | Prometheus, Grafana, Loki, Tempo, Pyroscope |
| Generators | 4 | Client, scenario, service, data factory scaffolding |
| Distribution | K8s | k6 Operator, execution segments, NetworkPolicy |
| MCP Server | 5 tools | AI integration for test execution and analysis |
| AI Roadmap v2 | 4 agents | Planner, Builder, Analyst, Reporter (ChromaDB + RAG) |

---

## Load Profiles

| Profile | VUs | Duration | Purpose |
|---------|-----|----------|---------|
| `smoke` | 1 | 1 min | Verify system is operational |
| `quick` | 5 | 3 min | CI/CD fast feedback |
| `load` | 20 | 14 min | Normal sustained load |
| `rampup` | 50 | 13 min | Gradual increment |
| `capacity` | 200 | 20 min | Find max throughput |
| `stress` | 400 | 25 min | Find breaking point |
| `spike` | 300 burst | 8 min | Test elasticity |
| `breakpoint` | ->1000 | 1 hour | Find system limit |
| `soak` | 20 | 4+ hours | Detect memory leaks |

---

## Helpers

| Helper | Purpose |
|--------|---------|
| `RequestHelper` | HTTP client with auto tracing headers + auth injection |
| `DataHelper` | Random strings, emails, credit cards (Luhn), users, prices |
| `DateHelper` | Date formatting, arithmetic, ranges, timezone-safe |
| `HeaderHelper` | Tracing headers (UUID), auth headers, localization, User-Agent |
| `ValidationHelper` | Status code, JSON fields, response time, email/URL/UUID validators |
| `PerformanceHelper` | Percentiles (p50/p90/p95/p99), aggregation, baseline comparison |
| `StructuredLogger` | JSON logging with automatic secret masking |
| `RedisHelper` | Redis shared state for inter-VU data sharing |
| `UploadHelper` | File upload with multipart/form-data |
| `GraphQLHelper` | GraphQL query/mutation with variables |
| `WebSocketHelper` | WebSocket connections with message handling |
| `DataPool` | CSV/JSON data pool management with round-robin/random access |

---

## Patterns

| Pattern | Purpose |
|---------|---------|
| `authenticate()` | Bearer, Basic, OAuth2, API Key flows |
| `extractFromResponse()` | Correlation — extract JSON/header/regex values |
| `interpolate()` | Template substitution `{{variable}}` in URLs/bodies |
| `initPagination()` / `traverseAll()` | Offset, cursor, page-based API traversal |
| `withRetry()` / `retryRequest()` | Exponential backoff with jitter |
| `weightedSwitch()` | Weighted random scenario distribution |
| `ContractValidator` | JSON Schema validation via ajv |
| `loadMockConfigs()` / `getMockUrl()` | Mock server configuration and routing |
| `loadChaosConfig()` / `evaluateChaosRules()` | Chaos injection with configurable failure rules |
| `UserPool` / `DistributedRateLimiter` | Redis-backed shared state and rate limiting |
| `initFunnelMetrics()` / `runFunnel()` | Multi-step funnel tracking with dropout analysis |

---

## Reporting

After each test execution, the framework generates:

- **Interactive HTML report** with 17+ sections (KPIs, APDEX, SLAs, latency charts, groups, custom metrics, web vitals, comparison)
- **PDF/PNG export** via Puppeteer headless rendering
- **LLM analysis reports** (`analysis-*.md` + `message-*.md`) with intelligent insights using Claude
- **Automatic comparison** with previous execution (delta tables + sparklines)
- **Trend analysis** across historical runs

```bash
# Run a scenario (report auto-generated)
./bin/run-test.sh --client=acme --scenario=api/users --profile=load

# Run a consolidated test suite
./bin/run-test.sh --client=acme --test=artifacts/api -- -e ARTIFACT=my-artifact

# Reports are auto-generated in:
# reports/{client}/{scenario_slug}/html-report-{timestamp}.html
```

---

## Grafana Dashboards

Three provisioned dashboards for real-time observability:

| Dashboard | Purpose |
|-----------|---------|
| **Load Test Overview** | KPIs, APDEX, SLA, latency percentiles, groups analysis, custom metrics |
| **Enterprise Analytics** | Capacity analysis, throughput, error patterns, custom metrics deep-dive |
| **Web Vitals** | LCP, FCP, CLS, TTFB, INP with good/needs-improvement/poor thresholds |

```bash
# Start observability stack
./bin/observability.sh up --full

# Access Grafana
./bin/observability.sh open
```

---

## Custom Metrics & Groups Analysis

Define custom business metrics that are automatically detected in reports and Grafana:

```typescript
import { Counter, Trend, Rate, Gauge } from "k6/metrics";

const transactions = new Counter("business_transactions");
const latency = new Trend("api_latency_ms");
const successRate = new Rate("business_success_rate");
const activeUsers = new Gauge("active_users_gauge");
```

Groups get automatic timing analysis with synthetic threshold injection:

```typescript
group("Checkout", () => {
  // Framework automatically tracks duration, checks, and injects thresholds
  const res = http.post(`${BASE_URL}/checkout`, payload);
  check(res, { "checkout ok": (r) => r.status === 200 });
});
```

---

## SLA/SLO & APDEX

- Define SLOs per service in `clients/{name}/config/slos.json`
- Automatic 3-state evaluation: **cumple** / **en_riesgo** / **incumple**
- APDEX scoring with configurable thresholds
- Monthly compliance reports with trends

---

## Security

14 security features including:
- **RBAC**: 3 roles (developer, lead, admin) with granular permissions
- **Immutable audit log**: SHA-256 hash chain in JSONL format
- **Client isolation**: path traversal protection, opaque errors
- **Shell hardening**: input validation, secrets backend whitelist
- **Secure YAML parsing**: size limits, depth limits, YAML bomb protection
- **Secrets management**: pattern detection, URL sanitization in logs
- **PII redaction**: automatic in HTML reports and Prometheus labels

---

## CI/CD Integration

Templates for GitHub Actions and GitLab CI:

```bash
# GitHub Actions: .github/workflows/k6-test.yml
# GitLab CI: .gitlab-ci.yml

# Both include:
# - Secret detection before test execution
# - Report artifact upload
# - Minimum-privilege permissions
```

---

## Observability Stack

```bash
./bin/observability.sh up --full
```

| Service | Port | Purpose |
|---------|------|---------|
| Grafana | 3000 | Dashboards |
| Prometheus | 9090 | Metrics |
| Loki | 3100 | Logs |
| Tempo | 3200 | Traces |
| Pyroscope | 4040 | Profiling |

---

## MCP Server

AI integration via Model Context Protocol:

```bash
node mcp-server/dist/index.js
```

---

## Environment Variables

```bash
K6_PROFILE=smoke              # Load profile
K6_ENV=default                # Target environment
K6_CLIENT=_reference          # Client name
K6_STRUCTURED_LOGS=true       # JSON structured logging
K6_DEBUG=true                 # Verbose debug output
K6_SECRETS_BACKENDS=env       # Secrets: env,vault,aws-sm,azure-kv
ANTHROPIC_API_KEY=sk-ant-...  # LLM analysis (optional)
```

---

## Creating a New Client

```bash
# Use the generator
node bin/generate.js --type=client --name=my-product

# Or scaffold manually
cp -r clients/_reference clients/my-product
# Edit config, add services, write scenarios
```

---

## Development

```bash
npm run build       # Compile TypeScript -> k6 bundles (webpack)
npm run typecheck   # TypeScript type check
npm run lint        # ESLint
npm run format      # Prettier
npm run validate    # TypeScript + ESLint (all checks)
```



## Next Steps

Explore the documentation using the sidebar:

- **[Feature Catalog](./framework/feature-catalog)** — complete 192+ feature listing
- **[Load Profiles](./framework/load-profiles)** — 13 predefined profiles
- **[Patterns Guide](./framework/patterns/patterns-guide)** — 10 test patterns
- **[Metrics Engine](./framework/metrics/metrics-engine)** — 125+ metrics reference
- **[Reporting](./framework/reporting/)** — HTML, PDF, LLM reports
- **[Security](./framework/security/)** — RBAC, audit, isolation
