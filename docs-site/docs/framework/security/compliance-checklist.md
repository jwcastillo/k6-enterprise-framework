---
title: "k6 Enterprise Load Testing Framework — Feature Compliance Checklist"
sidebar_position: 4
---
# k6 Enterprise Load Testing Framework — Feature Compliance Checklist

**Version**: 1.0  
**Last Updated**: 2026-02-23  
**Framework**: k6 Enterprise Load Testing Framework (Service Performance & Resilience)

---

## How to Use This Checklist

This document provides a structured, testable verification checklist for every feature in the k6 Enterprise Load Testing Framework. It is organized into **16 categories** with **190+ individually verifiable items**.

### Instructions

1. **Go through each category** sequentially or focus on the category relevant to your audit.
2. **Execute the verification command** or manual check described in each item.
3. **Mark the checkbox** `[x]` when the feature passes verification.
4. **Record failures** in the Notes column of the summary table with the failing item ID.
5. **Calculate coverage** per category using: `Coverage = Verified / Total * 100`.

### Verification Types

| Type | Description |
|------|-------------|
| **CMD** | Execute a CLI command and verify output |
| **FILE** | Verify a file exists and contains expected content |
| **MANUAL** | Manual inspection or functional test |
| **CONFIG** | Verify configuration file structure |
| **DOCKER** | Requires Docker/docker-compose running |
| **K8S** | Requires Kubernetes cluster |

---

## Summary

| # | Category | Features | Verified | Coverage | Notes |
|---|----------|----------|----------|----------|-------|
| 1 | [Load Profiles](#1-load-profiles) | 9 | ___ / 9 | ___% | |
| 2 | [Helpers](#2-helpers) | 14 | ___ / 14 | ___% | |
| 3 | [Patterns & Extension Points](#3-patterns) | 13 | ___ / 13 | ___% | |
| 4 | [Metrics Engine](#4-metrics-engine) | 25 | ___ / 25 | ___% | |
| 5 | [Reporting](#5-reporting) | 25 | ___ / 25 | ___% | |
| 6 | [Grafana Dashboards](#6-grafana-dashboards) | 9 | ___ / 9 | ___% | |
| 7 | [Custom Metrics](#7-custom-metrics) | 8 | ___ / 8 | ___% | |
| 8 | [Groups Analysis](#8-groups-analysis) | 6 | ___ / 6 | ___% | |
| 9 | [SLA/SLO](#9-slaslo) | 10 | ___ / 10 | ___% | |
| 10 | [Security](#10-security) | 14 | ___ / 14 | ___% | |
| 11 | [CI/CD Integration](#11-cicd-integration) | 10 | ___ / 10 | ___% | |
| 12 | [Observability](#12-observability) | 12 | ___ / 12 | ___% | |
| 13 | [Generators](#13-generators) | 8 | ___ / 8 | ___% | |
| 14 | [Distributed Testing](#14-distributed-testing) | 8 | ___ / 8 | ___% | |
| 15 | [MCP Server](#15-mcp-server) | 11 | ___ / 11 | ___% | |
| 16 | [AI Roadmap v2](#16-ai-roadmap-v2) | 12 | ___ / 12 | ___% | |
| | **TOTAL** | **194** | ___ / 194 | ___% | |

---

## 1. Load Profiles

The framework provides **13 predefined load profiles** covering the full spectrum from smoke testing to long-duration soak runs, including arrival-rate profiles for open-model testing.

| Profile | VUs | Duration | Key Thresholds |
|---------|-----|----------|----------------|
| smoke | 1-2 | 1 min | p95<2000ms, errors<1% |
| quick | 5 | 3 min | p95<1500ms, errors<5% |
| load | 20 | 14 min | p95<1000ms, errors<5% |
| rampup | 50 | 13 min | p95<2000ms |
| capacity | 200 | 20 min | p95<3000ms |
| stress | 400 | 25 min | p95<5000ms, errors<15% |
| spike | 300 burst | ~8 min | p95<5000ms |
| breakpoint | 1000 | 1 h | p95<10000ms |
| soak | 20 | 4 h+ | p95<2000ms |

- [ ] **LP-001** Smoke profile: 1-2 VUs, 1 minute, p95<2000ms
  - Type: CMD
  - Verify: `./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=smoke`
  - Expected: Exit code 0, report generated in `reports/_reference/`, checks pass rate >= 99%

- [ ] **LP-002** Quick profile: 5 VUs, 3 minutes, CI/CD fast feedback
  - Type: CMD
  - Verify: `./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=quick`
  - Expected: Exit code 0, duration ~3 minutes, p95<1500ms, p99<3000ms

- [ ] **LP-003** Load profile: 20 VUs, 14-minute ramp-hold-ramp pattern
  - Type: CMD
  - Verify: `./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=load`
  - Expected: Exit code 0, stages show 0->20 ramp (2m), hold (10m), ramp down (2m)

- [ ] **LP-004** Rampup profile: gradual increment to 50 VUs over 13 minutes
  - Type: CMD
  - Verify: `./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=rampup`
  - Expected: Exit code 0, VU count increases progressively through stages

- [ ] **LP-005** Capacity profile: 200 VUs, 20 minutes, find max throughput
  - Type: CMD
  - Verify: `./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=capacity`
  - Expected: Exit code 0 or 1 (threshold breach acceptable), report shows throughput plateau

- [ ] **LP-006** Stress profile: 400 VUs, 25 minutes, find breaking point
  - Type: CMD
  - Verify: `./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=stress`
  - Expected: Report generated, error rate and latency increase visible under stress

- [ ] **LP-007** Spike profile: burst to 300 VUs, ~8 minutes, test elasticity
  - Type: CMD
  - Verify: `./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=spike`
  - Expected: Report shows sudden VU spike and recovery pattern

- [ ] **LP-008** Breakpoint profile: ramp to 1000 VUs over 1 hour
  - Type: CMD
  - Verify: `./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=breakpoint`
  - Expected: Test runs with increasing VUs; system limit identified in report

- [ ] **LP-009** Soak profile: 20 VUs sustained for 4+ hours
  - Type: CMD
  - Verify: `./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=soak`
  - Expected: Long-duration run completes; memory leak detection in report; p95<2000ms maintained

---

## 2. Helpers

The framework provides **14 reusable helper classes** in `src/helpers/` that encapsulate common load testing operations.

- [ ] **HLP-001** RequestHelper: HTTP client with auto tracing and auth header injection
  - Type: FILE + MANUAL
  - Verify: File `src/helpers/request-helper.ts` exists; run `_reference` scenario that uses `RequestHelper`
  - Expected: HTTP requests include `X-Request-ID` and `X-Correlation-ID` headers automatically

- [ ] **HLP-002** DataHelper: test data loading from CSV, JSON, and environment variables
  - Type: FILE + MANUAL
  - Verify: File `src/helpers/data-helper.ts` exists; scenario uses `DataHelper.fromCSV()` or `DataHelper.fromJSON()`
  - Expected: Data loaded correctly, VUs receive different data rows

- [ ] **HLP-003** DateHelper: date formatting, timezone conversion, ISO 8601 support
  - Type: FILE
  - Verify: File `src/helpers/date-helper.ts` exists with methods for `format()`, `toISO()`, `addDays()`
  - Expected: Helper exports DateHelper class with standard date manipulation methods

- [ ] **HLP-004** HeaderHelper: tracing headers (UUID v4 correlation IDs), custom header management
  - Type: FILE + MANUAL
  - Verify: File `src/helpers/header-helper.ts` exists; `HeaderHelper.tracing()` generates RFC 4122 v4 UUIDs
  - Expected: Headers contain valid UUID v4 format correlation IDs (bits 14=4, bits 19=8/9/a/b)

- [ ] **HLP-005** ValidationHelper: response validation, schema checks, assertion utilities
  - Type: FILE
  - Verify: File `src/helpers/validation-helper.ts` exists with `validateStatus()`, `validateSchema()`, `validateBody()`
  - Expected: Helper provides chainable validation methods for HTTP responses

- [ ] **HLP-006** PerformanceHelper: custom timing, markers, performance annotations
  - Type: FILE
  - Verify: File `src/helpers/performance-helper.ts` exists
  - Expected: Helper provides `startTimer()`, `endTimer()`, `mark()` methods for custom timing

- [ ] **HLP-007** StructuredLogger: structured JSON logging with levels and context
  - Type: FILE + MANUAL
  - Verify: File `src/helpers/structured-logger.ts` exists; logs output JSON format with `level`, `msg`, `timestamp`
  - Expected: Log entries are parseable JSON with consistent schema

- [ ] **HLP-008** RedisHelper: Redis client wrapper for k6 with connection pooling
  - Type: FILE
  - Verify: File `src/helpers/redis-helper.ts` exists with `set()`, `get()`, `del()`, `exists()`, `mset()`, `mget()`
  - Expected: Helper wraps k6 Redis client with convenient methods and error handling

- [ ] **HLP-009** UploadHelper: file upload support (multipart/form-data)
  - Type: FILE
  - Verify: File `src/helpers/upload-helper.ts` exists with `uploadFile()`, `uploadMultiple()`
  - Expected: Helper handles multipart form data construction for file uploads

- [ ] **HLP-010** GraphQLHelper: GraphQL query/mutation builder with variables support
  - Type: FILE
  - Verify: File `src/helpers/graphql-helper.ts` exists with `query()`, `mutation()`, `subscribe()`
  - Expected: Helper constructs proper GraphQL request bodies with variables and operation names

- [ ] **HLP-011** WebSocketHelper: WebSocket connection management with message handlers
  - Type: FILE
  - Verify: File `src/helpers/websocket-helper.ts` exists with `connect()`, `send()`, `onMessage()`
  - Expected: Helper manages WebSocket lifecycle with timeout and reconnection support

- [ ] **HLP-012** DataPool: shared data pool with round-robin and random access patterns
  - Type: FILE + MANUAL
  - Verify: File `src/helpers/data-pool.ts` exists; example scenario `10-data-pool.ts` uses it
  - Expected: DataPool distributes data across VUs without duplication (round-robin) or with randomization

- [ ] **HLP-013** RedisSecurityHelper: secure Redis operations with key prefix isolation
  - Type: FILE
  - Verify: File `src/helpers/redis-security-helper.ts` exists with client-scoped key prefixing
  - Expected: Keys are automatically prefixed with client name to prevent cross-client data access

- [ ] **HLP-014** CheckSystem: extensible check registration via `registerCheck()`
  - Type: FILE
  - Verify: File `src/core/` exports `registerCheck()` function; `src/helpers/` uses check system
  - Expected: Custom checks appear in framework HTML/JSON reports without modifying generic layer

---

## 3. Patterns

The framework provides **10 reusable patterns** in `src/patterns/` for common load testing scenarios.

- [ ] **PAT-001** Authentication pattern: Bearer, Basic, OAuth2, and API Key support
  - Type: FILE + MANUAL
  - Verify: Files `01-auth-bearer.ts`, `02-auth-basic.ts`, `03-auth-oauth2.ts`, `04-auth-apikey.ts` in examples
  - Expected: Each auth method works with `__ENV` variables; no hardcoded credentials

- [ ] **PAT-002** Correlation pattern: extract and reuse dynamic values across requests
  - Type: FILE
  - Verify: File `src/patterns/correlation.ts` or equivalent pattern exists
  - Expected: Pattern extracts tokens/IDs from responses and injects into subsequent requests

- [ ] **PAT-003** Pagination pattern: iterate through paginated API responses
  - Type: FILE
  - Verify: File `src/patterns/pagination.ts` or equivalent pattern exists
  - Expected: Pattern handles offset/limit, cursor-based, and link-header pagination

- [ ] **PAT-004** Retry pattern: configurable retry with exponential backoff
  - Type: FILE
  - Verify: File `src/patterns/retry.ts` or equivalent pattern exists
  - Expected: Pattern retries failed requests with configurable max attempts, backoff, and jitter

- [ ] **PAT-005** Weighted execution pattern: distribute VUs across scenarios by weight
  - Type: FILE
  - Verify: File `src/patterns/weighted-execution.ts` or equivalent exists
  - Expected: Traffic splits according to configured weights (e.g., 70% browse, 20% search, 10% buy)

- [ ] **PAT-006** Contract testing pattern: validate API responses against schemas
  - Type: FILE
  - Verify: File `src/patterns/contract.ts` or equivalent exists
  - Expected: Pattern validates response structure, types, and required fields against contract definition

- [ ] **PAT-007** Mock server pattern: lightweight HTTP mock for dependency simulation
  - Type: FILE + CONFIG
  - Verify: File `src/node/mock-server.ts` exists (relocated from `src/patterns/` in Phase 4 / ARC-06); mock config in `clients/{name}/mocks/*.json`
  - Expected: Mock server starts in `setup()`, serves configured endpoints with simulated latency, stops in `teardown()`

- [ ] **PAT-008** Chaos injection pattern: fault injection for resilience testing
  - Type: FILE + CONFIG
  - Verify: Chaos configuration in `clients/{name}/chaos/` or inline config; example `11-chaos.ts`
  - Expected: Supports latency injection, error injection, timeout simulation; differentiated reporting for chaos vs real errors

- [ ] **PAT-009** Redis patterns: distributed data sharing, rate limiting, real-time stats
  - Type: FILE
  - Verify: Redis patterns documented in `docs/REDIS_DATA_SUPPORT.md`; example `15-redis-data-pool.ts`
  - Expected: User pools, distributed counters, rate limiting, and cross-VU coordination via Redis

- [ ] **PAT-010** Funnel pattern: multi-step user journey with drop-off simulation
  - Type: FILE
  - Verify: File `src/patterns/funnel.ts` or equivalent exists; checkout flow example `06-checkout-flow.ts`
  - Expected: Simulates realistic user funnels where a percentage of users drop off at each step

- [ ] **PAT-011** Extension points: `registerCheck()` for custom check registration
  - Type: FILE
  - Verify: `src/core/` exports `registerCheck()` function; product layer can call without forking
  - Expected: Custom checks registered via `registerCheck(name, fn, options)` appear in reports automatically

- [ ] **PAT-012** Extension points: `registerIntegration()` for service connectors
  - Type: FILE
  - Verify: `src/core/` exports `registerIntegration()` function
  - Expected: Product teams can add integrations (e.g., custom notification channels) without modifying generic layer

- [ ] **PAT-013** Two-layer architecture: Generic Layer (`src/`) and Product Layer (`clients/`)
  - Type: FILE
  - Verify: Verify separation: `src/` contains no client-specific code; `clients/` extends via patterns only
  - Expected: Clear separation; product teams extend without forking; no direct `src/` modifications required

---

## 4. Metrics Engine

The Metrics Engine (`src/metrics/`) calculates **125+ performance metrics** grouped by domain from k6 `handleSummary` data and optional external Prometheus metrics. Metrics are organized across **11 calculators**.

### Performance Calculator (50 metrics)

- [ ] **MET-001** Performance calculator instantiation and metric count
  - Type: FILE
  - Verify: File `src/metrics/calculators/performance-calculator.ts` exists
  - Expected: Calculator produces ~50 PERF metrics (CHK-API-175 to CHK-API-224)

- [ ] **MET-002** Latency percentiles: p50, p90, p95, p99 for `http_req_duration`
  - Type: MANUAL
  - Verify: Run smoke test, inspect `summary.json` metrics section
  - Expected: `perf_latency_p50`, `perf_latency_p90`, `perf_latency_p95`, `perf_latency_p99` present

- [ ] **MET-003** APDEX score calculation (Application Performance Index 0-1)
  - Type: MANUAL
  - Verify: Run test, check HTML report APDEX gauge section
  - Expected: APDEX score between 0 and 1; gauge rendered with color coding (green/yellow/red)

- [ ] **MET-004** TTFB (Time to First Byte) metrics
  - Type: MANUAL
  - Verify: Inspect metrics output for `perf_ttfb_avg`, `perf_ttfb_p95`
  - Expected: TTFB metrics present and within expected ranges

- [ ] **MET-005** Request duration breakdown (connect, TLS, waiting, receiving)
  - Type: MANUAL
  - Verify: Inspect metrics for `http_req_connecting`, `http_req_tls_handshaking`, `http_req_waiting`, `http_req_receiving`
  - Expected: Duration breakdown components sum approximately to total duration

### Throughput Calculator

- [ ] **MET-006** Throughput calculator: 25 THRU metrics (CHK-API-225 to CHK-API-249)
  - Type: FILE
  - Verify: File `src/metrics/calculators/throughput-calculator.ts` exists
  - Expected: Metrics include `thru_rps_avg`, `thru_rps_max`, `thru_rps_per_vu`, `thru_data_received`, `thru_data_sent`

- [ ] **MET-007** Requests per second (RPS) average, max, and per-VU
  - Type: MANUAL
  - Verify: Run load test, inspect throughput section of HTML report
  - Expected: RPS metrics calculated and displayed in throughput chart

### Error Calculator (30 metrics)

- [ ] **MET-008** Error calculator: 30 ERR metrics (CHK-API-250 to CHK-API-279)
  - Type: FILE
  - Verify: File `src/metrics/calculators/error-calculator.ts` exists
  - Expected: Metrics include error rate, error count, error distribution by status code

- [ ] **MET-009** Error rate and error distribution (4xx vs 5xx breakdown)
  - Type: MANUAL
  - Verify: Run test with some expected errors, check error distribution chart in HTML report
  - Expected: 4xx and 5xx errors separated; error rate calculated as failed/total

### SLA Calculator (20 metrics)

- [ ] **MET-010** SLA calculator: 20 SLA metrics (CHK-API-330 to CHK-API-349)
  - Type: FILE
  - Verify: File `src/metrics/calculators/sla-calculator.ts` exists
  - Expected: SLA metrics evaluate against defined SLO targets with pass/warn/fail/na states

### Saturation Calculator

- [ ] **MET-011** Saturation calculator: resource saturation metrics
  - Type: FILE
  - Verify: Directory `src/metrics/calculators/saturation/` exists with sub-calculators (`cpu`, `memory`, `io`, `network`, `resource`, `index`); legacy `saturation-calculator.ts` shim re-exports the facade for backwards compatibility (split in Phase 4 / ARC-07)
  - Expected: Detects CPU, memory, and connection saturation from external metrics

### Stability Calculator

- [ ] **MET-012** Stability calculator: consistency and variance metrics
  - Type: FILE
  - Verify: File `src/metrics/calculators/stability-calculator.ts` exists
  - Expected: Metrics for response time variance, coefficient of variation, stability score

### Scalability Calculator

- [ ] **MET-013** Scalability calculator: efficiency under increasing load
  - Type: FILE
  - Verify: File `src/metrics/calculators/scalability-calculator.ts` exists
  - Expected: Metrics for throughput scaling factor, latency degradation ratio

### Chaos Calculator

- [ ] **MET-014** Chaos calculator: resilience metrics during fault injection
  - Type: FILE
  - Verify: File `src/metrics/calculators/chaos-calculator.ts` exists
  - Expected: Metrics for recovery time, error amplification, graceful degradation score

### Security Calculator

- [ ] **MET-015** Security calculator: security-related performance metrics
  - Type: FILE
  - Verify: File `src/metrics/calculators/security-calculator.ts` exists
  - Expected: Metrics for auth latency overhead, TLS handshake time, security header presence

### Observability Calculator

- [ ] **MET-016** Observability calculator: infrastructure and tracing metrics
  - Type: FILE
  - Verify: File `src/metrics/calculators/observability-calculator.ts` exists
  - Expected: Metrics from Prometheus, Tempo, Loki, Pyroscope data when available; `na` otherwise

### Data Integrity Calculator

- [ ] **MET-017** Data integrity calculator: data consistency metrics
  - Type: FILE
  - Verify: File `src/metrics/calculators/data-integrity-calculator.ts` exists
  - Expected: Metrics for data corruption rate, consistency check results

### Engine Integration

- [ ] **MET-018** MetricsEngine.withP1Calculators() factory method
  - Type: FILE
  - Verify: `MetricsEngine` class has `withP1Calculators()` static method
  - Expected: Returns engine with all P1 calculators pre-configured

- [ ] **MET-019** MetricsReport structure: byCategory, all, summary
  - Type: MANUAL
  - Verify: Run test, inspect `MetricsReport` object in `summary.json`
  - Expected: Report has `byCategory` (object of arrays), `all` (flat array), `summary` (total/pass/warn/fail/na)

- [ ] **MET-020** Metric 4-state evaluation: pass, warn, fail, na
  - Type: MANUAL
  - Verify: Inspect metrics output for variety of states
  - Expected: Each metric has status field with one of: `pass`, `warn`, `fail`, `na`

- [ ] **MET-021** Warn zone calculation (threshold x 1.1)
  - Type: MANUAL
  - Verify: Set threshold at 500ms; response at 520ms should be `warn`
  - Expected: Values between threshold and threshold*1.1 get `warn` status

- [ ] **MET-022** External metrics integration via `externalMetrics` / Prometheus
  - Type: MANUAL
  - Verify: Configure `externalMetrics` in test; supply Prometheus data
  - Expected: Previously `na` metrics become `pass`/`warn`/`fail` with external data

- [ ] **MET-023** `buildMetricsInput()` helper transforms k6 handleSummary data
  - Type: FILE
  - Verify: `src/metrics/` exports `buildMetricsInput` function
  - Expected: Function accepts k6 `data` object, context, and options; returns valid `MetricsInput`

- [ ] **MET-024** Metrics summary aggregation: total, pass, warn, fail, na counts
  - Type: MANUAL
  - Verify: Run test, inspect `report.summary` in JSON output
  - Expected: `summary` object contains `{ total: N, pass: N, warn: N, fail: N, na: N }` with correct totals

- [ ] **MET-025** Metrics categorization: `byCategory` groups metrics by domain
  - Type: MANUAL
  - Verify: Inspect `report.byCategory` in metrics output
  - Expected: Keys include `performance`, `throughput`, `error`, `sla`, `saturation`, `stability`, `scalability`, `chaos`, `security`, `observability`, `dataIntegrity`

---

## 5. Reporting

The reporting system generates comprehensive, offline-capable HTML reports with interactive visualizations.

- [ ] **RPT-001** Interactive HTML report generation with 17+ sections
  - Type: CMD
  - Verify: `./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=smoke`
  - Expected: `reports/_reference/*/report.html` generated; self-contained with zero CDN dependencies

- [ ] **RPT-002** Header section: test metadata (client, service, environment, profile, user, execution ID, timestamp)
  - Type: MANUAL
  - Verify: Open generated HTML report, inspect header section
  - Expected: All metadata fields populated correctly

- [ ] **RPT-003** KPI strip: checks pass rate, avg/p95/p99 latency, error rate, throughput, APDEX, SLA status
  - Type: MANUAL
  - Verify: Open HTML report, inspect KPI strip at top
  - Expected: All 7+ KPI values displayed with color coding

- [ ] **RPT-004** APDEX gauge: visual 0-1 gauge with color-coded satisfaction rating
  - Type: MANUAL
  - Verify: Open HTML report, locate APDEX gauge section
  - Expected: Gauge rendered with green (>0.94), yellow (0.85-0.94), red (<0.85) zones

- [ ] **RPT-005** SLA/SLO compliance: traffic light table with actual vs target values
  - Type: MANUAL
  - Verify: Open HTML report, locate SLA/SLO section
  - Expected: Table shows green/yellow/red indicators per SLO metric

- [ ] **RPT-006** Latency distribution chart: interactive p50, p95, p99 lines over time
  - Type: MANUAL
  - Verify: Open HTML report, locate latency chart (Chart.js)
  - Expected: Interactive chart with tooltips, zoom, and pan; three percentile lines visible

- [ ] **RPT-007** Throughput chart: requests per second over time with VU overlay
  - Type: MANUAL
  - Verify: Open HTML report, locate throughput section
  - Expected: RPS line chart with VU count overlay on secondary axis

- [ ] **RPT-008** Error distribution chart: 4xx vs 5xx breakdown
  - Type: MANUAL
  - Verify: Open HTML report, locate error distribution section
  - Expected: Bar or pie chart showing 4xx and 5xx error categories

- [ ] **RPT-009** Groups analysis section: timing and checks per group
  - Type: MANUAL
  - Verify: Run test with `group()` blocks, open HTML report
  - Expected: Per-group timing, check pass/fail counts, and status indicators

- [ ] **RPT-010** Custom metrics section: Trends, Counters, Rates, Gauges panels
  - Type: MANUAL
  - Verify: Run test with custom metrics, open HTML report
  - Expected: Separate panels for each custom metric type with values

- [ ] **RPT-011** Web Vitals section: LCP, FCP, CLS, TTFB, INP scores
  - Type: MANUAL
  - Verify: Run browser test or test emitting web vitals, open HTML report
  - Expected: Web vitals displayed with good/needs-improvement/poor ratings

- [ ] **RPT-012** JSON summary output (`summary.json`)
  - Type: CMD
  - Verify: After test, check `reports/_reference/*/summary.json` exists
  - Expected: Valid JSON with metrics, thresholds, checks, and metadata

- [ ] **RPT-013** PDF export via Puppeteer headless rendering
  - Type: CMD
  - Verify: `node bin/export-report.js --format=pdf --input=reports/_reference/*/report.html`
  - Expected: PDF file generated from HTML report with all charts rendered

- [ ] **RPT-014** PNG export via Puppeteer headless rendering
  - Type: CMD
  - Verify: `node bin/export-report.js --format=png --input=reports/_reference/*/report.html`
  - Expected: PNG screenshot(s) of report generated

- [ ] **RPT-015** LLM analysis report (Claude integration for intelligent performance insights)
  - Type: CMD
  - Verify: Run test with `--llm-analysis` flag or equivalent; requires API key
  - Expected: LLM-generated analysis section in report with insights and recommendations

- [ ] **RPT-016** Automatic comparison with previous execution (delta tables, color badges, sparkline)
  - Type: MANUAL
  - Verify: Run same test twice, open second report
  - Expected: Comparison section shows absolute and percentage changes with color badges and evolution sparkline

- [ ] **RPT-017** Custom branding (organization logo, colors, naming)
  - Type: CONFIG
  - Verify: Configure branding in client config; run test; open report
  - Expected: Report header shows custom logo, organization name, and color scheme

- [ ] **RPT-018** Checks detail section: all k6 checks with pass/fail counts and success rates
  - Type: MANUAL
  - Verify: Open HTML report, locate Checks Detail section (#11)
  - Expected: Every k6 `check()` listed with pass count, fail count, and percentage

- [ ] **RPT-019** Thresholds section: all thresholds with pass/fail status and actual values
  - Type: MANUAL
  - Verify: Open HTML report, locate Thresholds section (#12)
  - Expected: Each threshold listed with its expression, actual value, and pass/fail indicator

- [ ] **RPT-020** HTTP details section: request/response details per endpoint
  - Type: MANUAL
  - Verify: Open HTML report, locate HTTP Details section (#16)
  - Expected: Per-endpoint breakdown showing URL, method, count, avg/p95 duration, error rate

- [ ] **RPT-021** Executive summary section: high-level summary for non-technical stakeholders
  - Type: MANUAL
  - Verify: Open HTML report, locate Executive Summary section (#17)
  - Expected: Plain-language summary of test outcome suitable for management review

- [ ] **RPT-022** PII redaction in report output
  - Type: MANUAL
  - Verify: Run test with PII in URL parameters; inspect HTML report for redacted values
  - Expected: Email addresses, tokens, IPs replaced with `[REDACTED]` in all report sections

- [ ] **RPT-023** Trend analysis across multiple historical runs
  - Type: MANUAL
  - Verify: Run same test 3+ times; open latest report
  - Expected: Trend section shows metrics evolution across historical runs with trendlines

- [ ] **RPT-024** WCAG accessibility compliance for HTML reports
  - Type: MANUAL
  - Verify: Run accessibility audit tool (e.g., axe, Lighthouse) on generated HTML report
  - Expected: Report meets WCAG 2.1 AA requirements; proper ARIA labels, keyboard navigation, contrast ratios

- [ ] **RPT-025** Chart.js interactive visualizations (tooltips, zoom, pan)
  - Type: MANUAL
  - Verify: Open HTML report; hover over charts for tooltips; use scroll/pinch to zoom
  - Expected: All charts support hover tooltips, zoom via scroll/pinch, and pan via drag

---

## 6. Grafana Dashboards

The framework ships with **3 pre-built dashboards**, provisioned automatically via Docker Compose.

- [ ] **GRF-001** Load Test Overview dashboard provisioned in Grafana
  - Type: DOCKER
  - Verify: `./bin/observability.sh up --full && ./bin/observability.sh open`; navigate to Dashboards
  - Expected: "k6 Load Test Overview" dashboard available with panels for latency, throughput, errors, VUs

- [ ] **GRF-002** Enterprise Analytics dashboard provisioned
  - Type: DOCKER
  - Verify: Navigate to Dashboards in Grafana
  - Expected: "k6 Enterprise Analytics" dashboard with advanced cross-test comparison panels

- [ ] **GRF-003** Web Vitals dashboard provisioned
  - Type: DOCKER
  - Verify: Navigate to Dashboards in Grafana
  - Expected: "k6 Web Vitals" dashboard with LCP, FCP, CLS, TTFB, INP panels

- [ ] **GRF-004** Template variables: test_name, test_timestamp, client, environment
  - Type: DOCKER
  - Verify: Open any dashboard, check template variable dropdowns
  - Expected: 4 variables (test_name, test_timestamp, client, environment) auto-populated from Prometheus labels

- [ ] **GRF-005** Prometheus data source auto-configured
  - Type: DOCKER
  - Verify: Grafana > Configuration > Data Sources
  - Expected: Prometheus data source pointing to `http://prometheus:9090` pre-configured

- [ ] **GRF-006** Dashboard JSON provisioning files in `grafana/dashboards/`
  - Type: FILE
  - Verify: Check `grafana/dashboards/` directory for JSON files
  - Expected: At least 3 JSON dashboard definition files present

- [ ] **GRF-007** Custom metrics panels: Rates & Gauges panel in dashboards
  - Type: DOCKER
  - Verify: Run test with custom metrics, open Load Test Overview in Grafana
  - Expected: Custom metrics panels show Trend, Counter, Rate, and Gauge data

- [ ] **GRF-008** Prometheus metrics export on port 5656
  - Type: CMD
  - Verify: During test run: `curl http://localhost:5656/metrics`
  - Expected: Prometheus text format metrics with `k6_` prefix and custom labels

- [ ] **GRF-009** Auto-injected labels (test_name, test_timestamp, client, environment) on all metrics
  - Type: MANUAL
  - Verify: Query Prometheus for `k6_http_req_duration` and check labels
  - Expected: All 4 custom labels present on every exported metric

---

## 7. Custom Metrics

The framework supports 4 k6 custom metric types with auto-detection, Prometheus naming conventions, and Grafana integration.

- [ ] **CUS-001** Trend metric: auto-detected and displayed in reports and Grafana
  - Type: MANUAL
  - Verify: Define a `Trend` metric in test, run test, check HTML report and Grafana
  - Expected: Trend metric appears in custom metrics section with p50/p90/p95/p99 values

- [ ] **CUS-002** Counter metric: auto-detected and displayed in reports and Grafana
  - Type: MANUAL
  - Verify: Define a `Counter` metric in test, run test, check report
  - Expected: Counter metric appears with cumulative count value

- [ ] **CUS-003** Rate metric: auto-detected and displayed in reports and Grafana
  - Type: MANUAL
  - Verify: Define a `Rate` metric in test, run test, check report
  - Expected: Rate metric appears as percentage (0-100%) in report

- [ ] **CUS-004** Gauge metric: auto-detected and displayed in reports and Grafana
  - Type: MANUAL
  - Verify: Define a `Gauge` metric in test, run test, check report
  - Expected: Gauge metric appears with min/max/current value

- [ ] **CUS-005** Prometheus naming convention (`k6_custom_<name>`)
  - Type: MANUAL
  - Verify: During test with Prometheus export, query for custom metric names
  - Expected: Custom metrics follow Prometheus naming: `k6_custom_my_metric_name` (snake_case)

- [ ] **CUS-006** Custom metrics in HTML report: separate panel per type
  - Type: MANUAL
  - Verify: Run dashboard demo test, open HTML report
  - Expected: Custom Metrics section has separate sub-panels: Trends, Counters, Rates, Gauges

- [ ] **CUS-007** Custom metrics in Grafana: auto-detected panels
  - Type: DOCKER
  - Verify: Run test with custom metrics, open Grafana dashboard
  - Expected: Custom metrics appear in dedicated Grafana panels without manual dashboard configuration

- [ ] **CUS-008** Custom metric thresholds (user-defined thresholds on custom metrics)
  - Type: CONFIG
  - Verify: Define threshold for custom metric in options, run test
  - Expected: Custom metric threshold evaluated and shown in thresholds section of report

---

## 8. Groups Analysis

The framework automatically analyzes k6 `group()` blocks with synthetic threshold injection and detailed per-group metrics.

- [ ] **GRP-001** Synthetic threshold injection for all groups
  - Type: MANUAL
  - Verify: Define groups without explicit thresholds, run test, check report thresholds section
  - Expected: `group_duration{group:::GroupName}` thresholds auto-injected (default: `p(95)<5000`)

- [ ] **GRP-002** `root_group` filtering (excludes root group from analysis)
  - Type: MANUAL
  - Verify: Run test with groups, inspect groups analysis section
  - Expected: `root_group` (the implicit top-level group) is filtered out from group listings

- [ ] **GRP-003** Per-group timing: duration percentiles per group
  - Type: MANUAL
  - Verify: Run test with multiple groups, check groups section in HTML report
  - Expected: Each group shows p50, p95 duration timing

- [ ] **GRP-004** Per-group checks: pass/fail counts per group
  - Type: MANUAL
  - Verify: Run test with checks inside groups, inspect groups analysis
  - Expected: Each group shows number of checks passed and failed

- [ ] **GRP-005** Group analysis in HTML report section (#8)
  - Type: MANUAL
  - Verify: Open HTML report, locate Groups Analysis section
  - Expected: Table/cards showing each group with timing, checks, and pass/fail status

- [ ] **GRP-006** Group analysis in Grafana dashboard
  - Type: DOCKER
  - Verify: Run test with groups, open Grafana dashboard
  - Expected: Group duration metrics visible in dashboard with per-group filtering

---

## 9. SLA/SLO

Service Level Objective definitions per service with automatic evaluation, 3-state classification, APDEX scoring, and monthly reporting.

- [ ] **SLO-001** SLO definition in `clients/{name}/config/slos.json`
  - Type: CONFIG
  - Verify: Check `clients/_reference/config/slos.json` exists with `version`, `services[]`, `metrics[]` structure
  - Expected: Valid SLO config with `name`, `target`, `riskMargin`, `unit`, `description` per metric

- [ ] **SLO-002** 3-state evaluation: cumple (pass) / en_riesgo (at-risk) / incumple (fail)
  - Type: MANUAL
  - Verify: Run test with SLO config, inspect SLA/SLO section in HTML report
  - Expected: Each SLO shows one of three states with appropriate color (green/yellow/red)

- [ ] **SLO-003** Risk margin calculation (target * riskMargin)
  - Type: MANUAL
  - Verify: Configure SLO with `target: 500` and `riskMargin: 0.1`; result at 520ms
  - Expected: Status is `at-risk` (between 500ms and 550ms = 500 * 1.1)

- [ ] **SLO-004** APDEX scoring (Application Performance Index 0-1)
  - Type: MANUAL
  - Verify: Run test, check APDEX gauge in HTML report
  - Expected: Score calculated as: (satisfied + tolerating/2) / total; satisfied = <T, tolerating = <4T

- [ ] **SLO-005** SLO evaluation per service (multi-service support)
  - Type: CONFIG
  - Verify: Define SLOs for multiple services in `slos.json`
  - Expected: Each service evaluated independently with its own set of SLO metrics

- [ ] **SLO-006** Monthly compliance reports
  - Type: MANUAL
  - Verify: Check for monthly aggregation in reporting; run multiple tests over time
  - Expected: Aggregated SLO compliance over time period with error budget consumption

- [ ] **SLO-007** SLO configuration via YAML or JSON
  - Type: CONFIG
  - Verify: Define SLOs in both `slos.json` and `slos.yaml` formats
  - Expected: Framework accepts both formats for SLO definitions

- [ ] **SLO-008** SLO results in JSON summary output
  - Type: CMD
  - Verify: Run test, inspect `summary.json` for SLO results
  - Expected: JSON contains `slo` section with per-metric evaluation results

- [ ] **SLO-009** Error budget calculation and tracking
  - Type: MANUAL
  - Verify: Configure SLO with 99.9% availability; run tests; check error budget consumed
  - Expected: Error budget remaining calculated as `(1 - target) * period - actual_downtime`

- [ ] **SLO-010** SLO status in HTML report traffic light table
  - Type: MANUAL
  - Verify: Run test with SLO config, open HTML report SLA/SLO section
  - Expected: Traffic light table with green (pass), yellow (at-risk), red (fail) per SLO with actual vs target values

---

## 10. Security

The framework implements **14 security controls** covering access control, audit, isolation, and hardening.

- [ ] **SEC-001** RBAC: 3 roles (developer, lead, admin) with permission matrix
  - Type: CONFIG
  - Verify: Check `clients/{name}/config/rbac.json` for role definitions
  - Expected: Three roles with differentiated permissions (developer: smoke/quick/load only; lead: all profiles; admin: full management)

- [ ] **SEC-002** Immutable audit log: all actions logged with timestamp, user, action, result
  - Type: MANUAL
  - Verify: Run test, check audit log file for entry with `timestamp`, `userId`, `action`, `result`
  - Expected: Audit entries are append-only, contain all required fields, and cannot be modified

- [ ] **SEC-003** Client isolation: path traversal prevention
  - Type: MANUAL
  - Verify: Attempt to access files outside client directory via `../` in paths
  - Expected: Framework rejects path traversal attempts; no file access outside client scope

- [ ] **SEC-004** Shell hardening: command injection prevention in `run-test.sh`
  - Type: MANUAL
  - Verify: Pass shell metacharacters in `--client` parameter (e.g., `; rm -rf /`)
  - Expected: Input sanitized; shell metacharacters rejected or escaped; no command execution

- [ ] **SEC-005** CLI input validation: parameter sanitization for all CLI inputs
  - Type: MANUAL
  - Verify: Pass invalid/malicious values to CLI parameters (special chars, long strings, null bytes)
  - Expected: All inputs validated against allowlists; invalid inputs rejected with clear error message

- [ ] **SEC-006** Secure YAML parsing: no code execution via YAML deserialization
  - Type: FILE
  - Verify: Check YAML parser configuration; attempt to load YAML with `!!js/function` tags
  - Expected: YAML parser configured for safe mode; code execution tags rejected

- [ ] **SEC-007** Secrets management: environment variable injection, no hardcoded secrets
  - Type: FILE + MANUAL
  - Verify: `grep -rn "password\|token\|api_key\|secret" clients/` shows only `__ENV.*` references
  - Expected: All credentials loaded from environment variables; no string literals matching secret patterns

- [ ] **SEC-008** PII redaction in reports and metrics
  - Type: MANUAL
  - Verify: Run test with PII in URL tags; check HTML report and Prometheus metrics
  - Expected: Sensitive tag values redacted (emails, IPs, tokens replaced with `[REDACTED]`)

- [ ] **SEC-009** Prometheus metric sanitization (label value validation)
  - Type: MANUAL
  - Verify: Inject metric with special characters in labels; check Prometheus output
  - Expected: Label values sanitized to prevent injection; only safe characters allowed

- [ ] **SEC-010** Config security: blocked fields in custom profiles
  - Type: MANUAL
  - Verify: Create custom profile with `exec`, `env`, or `disableSecretMasking` field
  - Expected: Framework rejects profile with explicit error; attempt logged to audit trail

- [ ] **SEC-011** Execution isolation: client tests cannot access other clients' data
  - Type: MANUAL
  - Verify: Run test for client A; verify no access to client B's reports, config, or data
  - Expected: File system access scoped to `clients/{name}/` only

- [ ] **SEC-012** Report isolation: HTML reports are self-contained, no external requests
  - Type: MANUAL
  - Verify: Open HTML report in browser with network tab open; check for external requests
  - Expected: Zero external HTTP requests; all CSS, JS, fonts embedded inline; WCAG accessible

- [ ] **SEC-013** Identity sanitization: user identity validation (a-z, A-Z, 0-9, _.@-)
  - Type: MANUAL
  - Verify: Pass user identity with special characters; check sanitized value
  - Expected: Only `[a-zA-Z0-9_.@-]` allowed; max 128 chars; invalid defaults to `anonymous`

- [ ] **SEC-014** Binary and custom profile validation
  - Type: MANUAL
  - Verify: Check `profile-validator.ts` validates custom profiles against allowlist
  - Expected: Only `name`, `description`, `stages`, `thresholds` fields accepted; `additionalProperties: false` enforced

---

## 11. CI/CD Integration

Templates and tooling for integrating the framework into CI/CD pipelines with quality gates.

- [ ] **CI-001** GitHub Actions workflow template
  - Type: FILE
  - Verify: Check for `.github/workflows/` template or `shared/templates/ci/github-actions.yml`
  - Expected: Workflow template with test execution, threshold evaluation, and artifact upload steps

- [ ] **CI-002** GitLab CI pipeline template
  - Type: FILE
  - Verify: Check for `shared/templates/ci/gitlab-ci.yml` or `.gitlab-ci.yml` template
  - Expected: Pipeline template with stages for test execution and quality gate evaluation

- [ ] **CI-003** Quality gate exit codes (0=pass, 1=fail, 2=error, 99=partial)
  - Type: CMD
  - Verify: Run test that passes thresholds (expect 0); run test that fails (expect 1)
  - Expected: Exit codes match documented values and can be used for pipeline gating

- [ ] **CI-004** Threshold override via environment variable (`QG_THRESHOLDS_OVERRIDE`)
  - Type: CMD
  - Verify: `QG_THRESHOLDS_OVERRIDE='{"http_req_duration[p95]": 800}' ./bin/run-test.sh ...`
  - Expected: Overridden threshold used instead of config file value

- [ ] **CI-005** detect-secrets integration for pre-commit scanning
  - Type: FILE
  - Verify: Check for `.pre-commit-config.yaml` or detect-secrets configuration
  - Expected: Pre-commit hook configured to scan for hardcoded secrets before commit

- [ ] **CI-006** Report artifact upload in CI templates
  - Type: FILE
  - Verify: Inspect CI templates for artifact upload steps
  - Expected: HTML report, summary.json, and metrics uploaded as pipeline artifacts

- [ ] **CI-007** Nightly regression suite support
  - Type: FILE
  - Verify: CI templates include scheduled trigger configuration
  - Expected: Cron schedule for nightly runs with full load profile suite

- [ ] **CI-008** Multi-channel notifications (Slack, Teams, email)
  - Type: FILE + CONFIG
  - Verify: Check CI templates and framework config for notification configuration
  - Expected: Notification templates for pass/fail results to configured channels

- [ ] **CI-009** Docker-based CI execution (containerized test runs)
  - Type: DOCKER
  - Verify: `docker run --rm -v "$(pwd)/reports:/app/reports" k6-enterprise:latest --client=_reference --scenario=api/smoke-users --profile=smoke`
  - Expected: Test runs inside Docker container with reports mounted to host

- [ ] **CI-010** Environment-specific threshold configuration (staging vs production)
  - Type: CONFIG
  - Verify: Configure different thresholds per environment in `config/{env}.json`
  - Expected: Pipeline uses environment-matched thresholds for quality gate evaluation

---

## 12. Observability

The observability stack provides **5 core services** plus framework-specific instrumentation.

- [ ] **OBS-001** Prometheus metrics collection from k6
  - Type: DOCKER
  - Verify: `./bin/observability.sh up --full`; run test; query `http://localhost:9090`
  - Expected: k6 metrics available in Prometheus with custom labels

- [ ] **OBS-002** Grafana visualization (port 3000, default admin/admin)
  - Type: DOCKER
  - Verify: `open http://localhost:3000`; login with admin/admin
  - Expected: Grafana accessible with pre-provisioned dashboards and data sources

- [ ] **OBS-003** Loki log aggregation
  - Type: DOCKER
  - Verify: Check docker-compose for Loki service; query logs in Grafana Explore
  - Expected: k6 structured logs collected and queryable via Loki data source in Grafana

- [ ] **OBS-004** Tempo distributed tracing
  - Type: DOCKER
  - Verify: Check docker-compose for Tempo service; run test with tracing enabled
  - Expected: Traces visible in Grafana Explore via Tempo data source; trace-to-metrics correlation

- [ ] **OBS-005** Pyroscope continuous profiling
  - Type: DOCKER
  - Verify: Check docker-compose for Pyroscope service; access Pyroscope UI
  - Expected: CPU and memory profiles of k6 load generator available for analysis

- [ ] **OBS-006** Docker Compose observability profile (`--profile observability`)
  - Type: CMD
  - Verify: `docker compose -f infrastructure/docker-compose.standalone.yml --profile observability config` shows all 5 services
  - Expected: Prometheus, Grafana, Loki, Tempo, Pyroscope services defined in compose file

- [ ] **OBS-007** Generator health monitoring (CPU and memory graphs)
  - Type: MANUAL
  - Verify: Run load test, open HTML report Generator Health section (#14)
  - Expected: CPU and memory usage graphs of the load generator during the test

- [ ] **OBS-008** Overhead detection and warnings
  - Type: CMD
  - Verify: `./bin/run-test.sh --client=_benchmark --service=baseline --test=smoke`
  - Expected: Framework overhead measured; warning if overhead > configured threshold

- [ ] **OBS-009** Tracing instrumentation (X-Request-ID, X-Correlation-ID headers)
  - Type: MANUAL
  - Verify: Run test with `HeaderHelper.tracing()`; inspect request headers
  - Expected: Every request includes UUID v4 `X-Request-ID` and `X-Correlation-ID` for distributed tracing

- [ ] **OBS-010** Pyroscope instrumentation for k6 profiling
  - Type: DOCKER
  - Verify: Check Pyroscope configuration for k6 process profiling
  - Expected: k6 binary profiled during test execution; flamegraphs available in Pyroscope UI

- [ ] **OBS-011** Anomaly detection in reports (section #15)
  - Type: MANUAL
  - Verify: Run test that produces anomalies (latency spikes, error bursts); check report section #15
  - Expected: Anomalies detected with auto-generated recommendations

- [ ] **OBS-012** Benchmark client (`_benchmark`) for measuring framework overhead
  - Type: CMD
  - Verify: `./bin/run-test.sh --client=_benchmark --service=baseline --test=load`
  - Expected: Benchmark report generated with framework overhead metrics (5-10 min runtime)

---

## 13. Generators

Scaffold new clients, test scenarios, services, and data factories without writing boilerplate.

- [ ] **GEN-001** Interactive generator menu (`node bin/generate.js`)
  - Type: CMD
  - Verify: `node bin/generate.js` (interactive, menu-driven)
  - Expected: Menu shows 4 options: New client, New test scenario, New service class, New data factory

- [ ] **GEN-002** Client scaffolding (`bin/create-client.sh`)
  - Type: CMD
  - Verify: `bin/create-client.sh test-compliance-client`
  - Expected: Full client directory tree created: `clients/test-compliance-client/{config,scenarios,lib,mocks,data}/`

- [ ] **GEN-003** Scenario generator (HTTP, GraphQL, WebSocket, mixed protocols)
  - Type: CMD
  - Verify: Use generator to create scenario with each protocol type
  - Expected: `clients/{client}/scenarios/{name}.ts` created from `shared/templates/generators/scenario-api.ts`

- [ ] **GEN-004** Service class generator
  - Type: CMD
  - Verify: Use generator to create a new service class
  - Expected: `clients/{client}/lib/services/{Name}Service.ts` created with base methods

- [ ] **GEN-005** Data factory generator
  - Type: CMD
  - Verify: `node bin/generate-data.js --type=users --count=1000 --format=csv`
  - Expected: CSV/JSON data file generated with realistic test data

- [ ] **GEN-006** Template-based generation (uses `shared/templates/generators/`)
  - Type: FILE
  - Verify: Check `shared/templates/generators/` directory for template files
  - Expected: Templates exist for scenario-api, scenario-graphql, scenario-websocket, service, factory

- [ ] **GEN-007** Non-interactive mode for CI (`bin/create-client.sh <name>`)
  - Type: CMD
  - Verify: `bin/create-client.sh ci-test-client` (no interactive prompts)
  - Expected: Client created without prompts; exit code 0

- [ ] **GEN-008** Generated client passes validation (`validate_schema`)
  - Type: CMD
  - Verify: Create client, then validate its config: `node bin/validate-config.js clients/test-client/config/default.json`
  - Expected: Generated config passes schema validation with zero errors

---

## 14. Distributed Testing

Run k6 load tests distributed across multiple Kubernetes pods using k6-operator.

- [ ] **DST-001** k6-operator integration via `bin/run-distributed.sh`
  - Type: K8S
  - Verify: `./bin/run-distributed.sh --client=myapp --scenario=api/checkout --profile=load --image=<registry>/k6:latest`
  - Expected: TestRun CRD created; pods spawned; test executes across multiple runners

- [ ] **DST-002** Execution segments: parallelism configuration
  - Type: K8S
  - Verify: `./bin/run-distributed.sh --parallelism=8 ...`
  - Expected: 8 runner pods created; VU load split evenly across pods

- [ ] **DST-003** Container image build support (`--build` flag)
  - Type: K8S
  - Verify: `./bin/run-distributed.sh --build --registry=registry.example.com/myapp ...`
  - Expected: Docker image built and pushed to registry before test execution

- [ ] **DST-004** NetworkPolicy for pod-to-pod security
  - Type: K8S + FILE
  - Verify: Check `k8s/` or `helm/` directory for NetworkPolicy manifests
  - Expected: NetworkPolicy limits runner pod egress to SUT and Prometheus endpoints only

- [ ] **DST-005** RBAC for Kubernetes service accounts
  - Type: K8S + FILE
  - Verify: Check for ServiceAccount, Role, RoleBinding manifests
  - Expected: k6 runner pods use least-privilege service account

- [ ] **DST-006** Helm chart for deployment
  - Type: FILE
  - Verify: Check `helm/` or `charts/` directory for Helm chart files
  - Expected: Helm chart with configurable values for parallelism, image, resources, and tolerations

- [ ] **DST-007** TestRun CRD generation
  - Type: K8S
  - Verify: `./bin/run-distributed.sh` generates valid TestRun YAML
  - Expected: Generated YAML matches k6-operator TestRun CRD spec with correct parallelism and script reference

- [ ] **DST-008** Prometheus remote write from distributed runners
  - Type: K8S
  - Verify: Run distributed test; query Prometheus for metrics from all pods
  - Expected: Metrics from all runner pods aggregated in Prometheus with pod-level labels

---

## 15. MCP Server

Expose the k6 Enterprise Framework to Claude Desktop and other MCP-compatible clients via the Model Context Protocol.

### Resources (Read-Only)

- [ ] **MCP-001** `read_config` resource: read client configuration (`k6://config/{client}/{env}`)
  - Type: CMD
  - Verify: Build MCP server (`cd mcp-server && npm run build`); test resource via MCP client
  - Expected: Returns parsed JSON config from `clients/{client}/config/{env}.json`

- [ ] **MCP-002** `list_scenarios` resource: list client test scenarios (`k6://scenarios/{client}`)
  - Type: CMD
  - Verify: Query `k6://scenarios/_reference` via MCP client
  - Expected: Returns array of scenario paths relative to `clients/{client}/scenarios/`

- [ ] **MCP-003** `get_metrics` resource: retrieve past execution metrics (`k6://metrics/{test_id}`)
  - Type: CMD
  - Verify: Query `k6://metrics/{client}/{scenario}/{timestamp}` after running a test
  - Expected: Returns metrics from `reports/{client}/{scenario}/{timestamp}/k6-summary.json`

### Tools (Actions)

- [ ] **MCP-004** `run_test` tool: execute a k6 load test
  - Type: CMD
  - Verify: Call `run_test({ client: "_reference", test: "api/smoke-users", profile: "smoke" })`
  - Expected: Test executes; returns `{ status, exitCode, output, reportPath }`

- [ ] **MCP-005** `validate_schema` tool: validate config against JSON schemas
  - Type: CMD
  - Verify: Call `validate_schema({ file: "clients/_reference/config/default.json" })`
  - Expected: Returns `{ valid: true, errors: [] }` for valid config

- [ ] **MCP-006** `generate_scaffold` tool: generate new framework artifacts
  - Type: CMD
  - Verify: Call `generate_scaffold({ name: "TestService", type: "service", client: "_reference" })`
  - Expected: Returns `{ created: ["clients/_reference/lib/services/TestService.ts"] }`

- [ ] **MCP-007** `queryKnowledgeBase` tool: RAG query over framework docs and code
  - Type: CMD
  - Verify: Call tool with query about framework feature
  - Expected: Returns relevant code snippets and documentation from knowledge base

- [ ] **MCP-008** `getObservabilityData` tool: query Prometheus/Loki/Tempo data
  - Type: CMD + DOCKER
  - Verify: Call tool with time range and metric query
  - Expected: Returns observability data from configured backends

- [ ] **MCP-009** `validateGeneratedCode` tool: validate AI-generated k6 scripts
  - Type: CMD
  - Verify: Call tool with TypeScript content to validate
  - Expected: Returns validation result with syntax errors, missing imports, security issues

- [ ] **MCP-010** `getTestHistory` tool: retrieve historical test results
  - Type: CMD
  - Verify: Call tool with client name and optional time range
  - Expected: Returns list of past test executions with pass/fail status and key metrics

- [ ] **MCP-011** `createJiraTicket` tool: create Jira tickets for failed tests
  - Type: CMD
  - Verify: Call tool with test failure details and Jira config
  - Expected: Returns Jira ticket URL/ID (requires Jira credentials configured)

---

## 16. AI Roadmap v2

Version 2.0 transforms the framework into an **Intelligent Quality Platform** through 4 specialized AI agents.

### Planner Agent

- [ ] **AI-001** Planner agent: generates TestPlan from OpenAPI spec
  - Type: CMD
  - Verify: `npx ts-node src/ai/agents/planner-agent.ts --format=openapi --spec=./openapi.json`
  - Expected: TestPlan JSON generated with endpoints, test types, traffic models

- [ ] **AI-002** Planner agent: generates TestPlan from natural language
  - Type: CMD
  - Verify: `npx ts-node src/ai/agents/planner-agent.ts --format=natural-language --spec="E-commerce API with checkout flow"`
  - Expected: TestPlan JSON generated from text description

- [ ] **AI-003** Planner agent: handles incomplete OpenAPI (EC-AI-003)
  - Type: MANUAL
  - Verify: Provide partial OpenAPI spec; check for warnings in output
  - Expected: Partial plan generated with warnings about missing endpoints/schemas

### Builder Agent

- [ ] **AI-004** Builder agent: generates executable k6 TypeScript scripts from TestPlan
  - Type: CMD
  - Verify: `npx ts-node src/ai/agents/builder-agent.ts --plan=./test-plan.json`
  - Expected: `.ts` files generated; compile without errors; use framework helpers (RequestHelper, etc.)

- [ ] **AI-005** Builder agent: success rate >= 95% (SC-100)
  - Type: MANUAL
  - Verify: Run builder against 12 TestPlan fixtures; count successful generations
  - Expected: At least 12/12 (or 11/12 minimum) generate valid, executable scripts

- [ ] **AI-006** Builder agent: auto-correction up to 3 cycles
  - Type: MANUAL
  - Verify: Provide TestPlan that produces initially invalid output; check retry behavior
  - Expected: Builder retries up to 3 times with self-correction before failing

### Analyst Agent

- [ ] **AI-007** Analyst agent: root cause correlation from k6 + observability data
  - Type: CMD
  - Verify: `npx ts-node src/ai/agents/analyst-agent.ts --results=./summary.json --from=-1h`
  - Expected: AnalysisReport with anomalies, correlations, regressions, recommendations

- [ ] **AI-008** Anomaly detector: statistical detection (z-score, IQR, CUSUM, percentile)
  - Type: CMD
  - Verify: `npx ts-node src/ai/analysis/anomaly-detector.ts --metrics=./summary.json --baseline-runs=10`
  - Expected: Deterministic (no LLM) anomaly detection with scored anomalies

- [ ] **AI-009** Analyst agent: comparison with historical best
  - Type: MANUAL
  - Verify: Run analyst with multiple historical results available
  - Expected: Report includes regression analysis vs best historical metrics

### Reporter Agent

- [ ] **AI-010** Reporter agent: executive + technical summary generation
  - Type: CMD
  - Verify: Run full pipeline or reporter agent standalone
  - Expected: Executive summary (non-technical) and technical summary (detailed) generated

- [ ] **AI-011** Reporter agent: multi-channel notifications (Slack, Teams, Jira)
  - Type: CONFIG
  - Verify: Configure notification channels; run pipeline with `--notify=slack,jira`
  - Expected: Notifications sent to configured channels with enriched test results

### Pipeline Orchestrator

- [ ] **AI-012** Full pipeline: Planner -> Builder -> run_test -> Analyst -> Reporter
  - Type: CMD
  - Verify: `node cmd/ai-pipeline.js --client=acme-corp --spec=./openapi.json --format=openapi --notify=slack`
  - Expected: Full pipeline executes end-to-end; report generated; notifications sent

---

## Final Summary

### Completion Tracking

| Status | Count |
|--------|-------|
| Total items | 194 |
| Verified | ___ |
| Failed | ___ |
| Skipped | ___ |
| N/A | ___ |

### Category Completion

| Category | Status |
|----------|--------|
| Load Profiles (9) | ________ |
| Helpers (14) | ________ |
| Patterns & Extension Points (13) | ________ |
| Metrics Engine (25) | ________ |
| Reporting (25) | ________ |
| Grafana Dashboards (9) | ________ |
| Custom Metrics (8) | ________ |
| Groups Analysis (6) | ________ |
| SLA/SLO (10) | ________ |
| Security (14) | ________ |
| CI/CD Integration (10) | ________ |
| Observability (12) | ________ |
| Generators (8) | ________ |
| Distributed Testing (8) | ________ |
| MCP Server (11) | ________ |
| AI Roadmap v2 (12) | ________ |

### Audit Record

| Field | Value |
|-------|-------|
| **Auditor** | ________________ |
| **Date** | ________________ |
| **Framework Version** | ________________ |
| **Environment** | ________________ |
| **k6 Version** | ________________ |
| **Node.js Version** | ________________ |
| **Docker Version** | ________________ |
| **Kubernetes Version** | ________________ (if applicable) |
| **Overall Result** | PASS / FAIL / PARTIAL |
| **Notes** | ________________ |

---

> **Document generated**: 2026-02-23
> **Framework**: k6 Enterprise Load Testing Framework
> **Total verifiable items**: 194
