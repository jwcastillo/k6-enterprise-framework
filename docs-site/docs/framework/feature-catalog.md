---
title: "k6 Enterprise Framework — Complete Feature Catalog"
sidebar_position: 1
---
# k6 Enterprise Framework — Complete Feature Catalog

> **196+ features across 16 categories** — A comprehensive listing of every capability in the k6 Enterprise Load Testing Framework.

---

## Summary Matrix

| #  | Category                     | Features | Status      |
|----|------------------------------|----------|-------------|
| 1  | Load Profiles                | 15       | Stable      |
| 2  | Helpers                      | 15       | Stable      |
| 3  | Patterns                     | 10       | Stable      |
| 4  | Metrics Engine               | 125+     | Stable      |
| 5  | Reporting                    | 18+      | Stable      |
| 6  | Grafana Dashboards           | 3        | Stable      |
| 7  | Custom Metrics               | 4 types  | Stable      |
| 8  | Groups Analysis              | 3        | Stable      |
| 9  | SLA / SLO                    | 5        | Stable      |
| 10 | Security                     | 14       | Stable      |
| 11 | CI/CD                        | 3        | Stable      |
| 12 | Observability                | 9        | Stable      |
| 13 | Generators                   | 4        | Stable      |
| 14 | Distribution (K8s)           | 5        | Stable      |
| 15 | MCP Server                   | 8 tools  | Stable      |
| 16 | AI Roadmap v2                | 4 agents | Beta        |
|    | **Total**                    | **192+** |             |

---

## 1. Load Profiles (15)

Pre-built load profile configurations that define virtual-user ramp patterns, durations, and threshold criteria. Each profile is a self-contained JSON file consumed by the runner via `--profile` flag.

### LP-001: smoke

- **VUs:** 1-2
- **Duration:** 1 min
- **Thresholds:** p(95) < 2000 ms, error rate < 1%, checks >= 99%
- **Stages:** 30s ramp to 1 VU, 30s ramp to 0 VU
- **Max Duration:** 2 min
- **Purpose:** Minimal load to verify the system is operational before heavier tests
- **File:** `shared/profiles/smoke.json`

### LP-002: quick

- **VUs:** 5
- **Duration:** 3 min
- **Thresholds:** p(95) < 1500 ms, p(99) < 3000 ms, error rate < 5%, checks >= 95%
- **Stages:** 30s ramp to 5, 2m hold at 5, 30s ramp to 0
- **Purpose:** Fast feedback loop for development — validates basic performance during feature work
- **File:** `shared/profiles/quick.json`

### LP-003: load

- **VUs:** 20
- **Duration:** 14 min
- **Thresholds:** p(95) < 1000 ms, p(99) < 2000 ms, error rate < 5%, checks >= 95%
- **Stages:** 2m ramp to 20, 10m hold at 20, 2m ramp to 0
- **Purpose:** Standard load testing — validates system behavior under expected production-level traffic
- **File:** `shared/profiles/load.json`

### LP-004: rampup

- **VUs:** 10 to 50
- **Duration:** 13 min
- **Thresholds:** p(95) < 1500 ms, error rate < 10%, checks >= 90%
- **Stages:** 2m ramp to 10, 3m ramp to 30, 3m ramp to 50, 3m hold at 50, 2m ramp to 0
- **Purpose:** Gradual load increase — identifies the point where performance begins to degrade
- **File:** `shared/profiles/rampup.json`

### LP-005: capacity

- **VUs:** 50 to 200
- **Duration:** 20 min
- **Thresholds:** p(95) < 2000 ms, p(99) < 5000 ms, error rate < 15%, checks >= 85%
- **Stages:** 3m ramp to 50, 4m ramp to 100, 4m ramp to 150, 4m ramp to 200, 3m hold at 200, 2m ramp to 0
- **Purpose:** Capacity planning — determines the maximum throughput the system can sustain
- **File:** `shared/profiles/capacity.json`

### LP-006: stress

- **VUs:** 100 to 400
- **Duration:** 25 min
- **Thresholds:** p(95) < 5000 ms, error rate < 30%, checks >= 70%
- **Stages:** 3m ramp to 100, 5m ramp to 200, 5m ramp to 300, 5m ramp to 400, 3m hold at 400, 4m ramp to 0
- **Purpose:** Stress testing — pushes the system well beyond normal limits to find breaking points
- **File:** `shared/profiles/stress.json`

### LP-007: spike

- **VUs:** Burst to 300
- **Duration:** 8 min
- **Thresholds:** p(95) < 5000 ms, error rate < 25%, checks >= 75%
- **Stages:** 30s ramp to 300, 1m hold at 300, 30s ramp to 50, 3m hold at 50, 30s ramp to 300, 1m hold at 300, 1m30s ramp to 0
- **Purpose:** Spike testing — validates system behavior under sudden traffic bursts
- **File:** `shared/profiles/spike.json`

### LP-008: breakpoint

- **VUs:** Ramp to 1000
- **Duration:** 1 hour
- **Thresholds:** p(95) < 60000 ms, error rate < 50%
- **Stages:** Continuous linear ramp from 0 to 1000 over 1h
- **Purpose:** Breakpoint testing — finds the absolute upper limit where the system fails
- **File:** `shared/profiles/breakpoint.json`

### LP-009: soak

- **VUs:** 20
- **Duration:** 4 hours+
- **Thresholds:** p(95) < 1500 ms, p(99) < 3000 ms, error rate < 5%, checks >= 95%
- **Stages:** 5m ramp to 20, 3h50m hold at 20, 5m ramp to 0
- **Purpose:** Endurance testing — detects memory leaks, resource exhaustion, and long-term degradation
- **File:** `shared/profiles/soak.json`

### LP-010: throughput-low

- **Executor:** constant-arrival-rate
- **Rate:** 10 iterations/second
- **Duration:** 5 min
- **VUs:** 20 pre-allocated, 50 max
- **Thresholds:** p(95) < 2000 ms, p(99) < 5000 ms, error rate < 5%, checks >= 95%
- **Purpose:** Low constant throughput — open-model baseline testing
- **File:** `shared/profiles/throughput-low.json`

### LP-011: throughput-medium

- **Executor:** constant-arrival-rate
- **Rate:** 50 iterations/second
- **Duration:** 5 min
- **VUs:** 60 pre-allocated, 150 max
- **Thresholds:** p(95) < 1500 ms, p(99) < 3000 ms, error rate < 5%, checks >= 95%
- **Purpose:** Medium constant throughput — simulates typical production traffic with open model
- **File:** `shared/profiles/throughput-medium.json`

### LP-012: throughput-high

- **Executor:** constant-arrival-rate
- **Rate:** 100 iterations/second
- **Duration:** 5 min
- **VUs:** 120 pre-allocated, 300 max
- **Thresholds:** p(95) < 1000 ms, p(99) < 2000 ms, error rate < 5%, checks >= 95%
- **Purpose:** High constant throughput — peak traffic simulation with open model
- **File:** `shared/profiles/throughput-high.json`

### LP-013: throughput-ramp

- **Executor:** ramping-arrival-rate
- **Rate:** 10→100 iterations/second (ramped)
- **Duration:** 12 min
- **VUs:** 120 pre-allocated, 300 max
- **Thresholds:** p(95) < 2000 ms, p(99) < 5000 ms, error rate < 10%, checks >= 90%
- **Stages:** 2m → 10/s, 3m → 50/s, 3m → 100/s, 2m hold at 100/s, 2m → 0
- **Purpose:** Ramping throughput — finds maximum sustainable request rate with open model
- **File:** `shared/profiles/throughput-ramp.json`

### LP-014: Throughput Model (users → RPS)

- **Purpose:** GPT-inspired formula that converts a target concurrent-user count into recommended RPS and max-VU values per endpoint class
- **Endpoint classes:** `"api"` (20 RPS/1k users), `"web"` (2), `"git-pull"` (2), `"git-push"` (0.4, floored to ≥1)
- **Max-VU recommendation:** `min(targetRps × 5, 2000)`
- **Functions:** `targetRpsForUsers(users, class)`, `recommendMaxVUs(rps)`, `buildThroughputPlan(users)`
- **File:** `src/core/throughput-model.ts`

### LP-015: Test Gating (quarantine / experimental / unsafe)

- **Purpose:** Orthogonal safety axis that prevents execution of risky scenarios unless an explicit CLI opt-in flag is supplied
- **Gate kinds:** `"quarantined"`, `"experimental"`, `"unsafe"` (declared via `export const gate = "<kind>"`)
- **Runner flags:** `--quarantined`, `--experimental`, `--unsafe` (default-deny; missing flag exits 108)
- **Note:** NOT a 6th bucket — gated scenarios still live in one of the 5 canonical buckets
- **Files:** `src/core/gating.ts`, `bin/run-test.sh` (gate check block)

---

## 2. Helpers (15)

Reusable TypeScript modules providing common utilities for k6 test scripts. All helpers are importable from `src/helpers/index.ts`.

### HLP-001: RequestHelper

- **Purpose:** HTTP client wrapper with automatic tracing headers and auth injection
- **Methods:** `get()`, `post()`, `put()`, `patch()`, `delete()`
- **Features:** Auto-attaches correlation IDs, supports all HTTP verbs, integrates with auth patterns
- **File:** `src/helpers/request-helper.ts`

### HLP-002: DataHelper

- **Purpose:** Random test data generation with realistic formats
- **Methods:** `randomString()`, `randomEmail()`, `randomCreditCard()` (Luhn-valid), `randomUser()`, `randomPrice()`
- **Features:** Luhn algorithm for credit cards, configurable string lengths, locale-aware names
- **File:** `src/helpers/data-helper.ts`

### HLP-003: DateHelper

- **Purpose:** Date manipulation and formatting for test scenarios
- **Methods:** `format()`, `range()`, `addDays()`, `addHours()`, `addMinutes()`, `toUnixTimestamp()`, `isPast()`, `isFuture()`, `dayOfWeek()`
- **Features:** ISO 8601 formatting, Unix timestamp conversion, date arithmetic
- **File:** `src/helpers/date-helper.ts`

### HLP-004: HeaderHelper

- **Purpose:** HTTP header construction for tracing, auth, and instrumentation
- **Methods:** Tracing headers (UUID-based), auth headers, standard headers, localization headers, instrumentation headers
- **Features:** W3C Trace Context compatible, automatic correlation ID generation
- **File:** `src/helpers/header-helper.ts`

### HLP-005: ValidationHelper

- **Purpose:** Response validation utilities for assertions
- **Methods:** `status()`, `hasFields()`, `responseTime()`, email/URL/UUID/credit-card validators
- **Features:** Schema-like field presence checks, format validation, threshold-based timing checks
- **File:** `src/helpers/validation-helper.ts`

### HLP-006: PerformanceHelper

- **Purpose:** Statistical analysis of response time distributions
- **Methods:** Percentile calculation (p50/p90/p95/p99), `aggregate()`, `compareBaseline()`
- **Features:** Baseline comparison with delta analysis, multi-run aggregation
- **File:** `src/helpers/performance-helper.ts`

### HLP-007: StructuredLogger

- **Purpose:** JSON-structured logging with secret masking
- **Methods:** `logRequest()`, `logEvent()`, `logError()`, `sanitizeUrl()`
- **Features:** Automatic PII/secret detection and masking, URL credential sanitization, structured JSON output
- **File:** `src/helpers/structured-logger.ts`

### HLP-008: RedisHelper

- **Purpose:** Redis operations wrapper for data-driven testing
- **Methods:** `set()`, `get()`, `del()`, `hset()`, `hget()`, `hgetall()`, `lpush()`, `rpush()`, `lpop()`, `lrange()`, `sadd()`, `smembers()`, `incr()`, `decr()`, `scan()`, `bulkLoad()`
- **Features:** Full Redis data structure support (strings, hashes, lists, sets), bulk loading, TTL management
- **File:** `src/helpers/redis-helper.ts`

### HLP-009: UploadHelper

- **Purpose:** File upload/download operations for multipart testing
- **Methods:** `uploadFile()` (multipart/form-data), `downloadFile()`, `withRateLimitHandling()`
- **Features:** Multipart encoding, automatic retry on 429, rate limit detection
- **File:** `src/helpers/upload-helper.ts`

### HLP-010: GraphQLHelper

- **Purpose:** GraphQL query and mutation execution
- **Methods:** `query()`, `mutate()` — both with variables support
- **Features:** Variable injection, partial response handling, error extraction
- **File:** `src/helpers/graphql-helper.ts`

### HLP-011: WebSocketHelper

- **Purpose:** WebSocket connection lifecycle management
- **Methods:** `runWebSocket()`, `wsEchoTest()`
- **Features:** Automatic `wss://` enforcement, message send/receive, connection lifecycle hooks
- **File:** `src/helpers/websocket-helper.ts`

### HLP-012: DataPool

- **Purpose:** Test data pool management with allocation strategies
- **Methods:** CSV/JSON pool initialization, round-robin access, random access, VU-based allocation
- **Features:** Exhaustion policies (recycle, stop, error), VU-affinity allocation, thread-safe access
- **File:** `src/helpers/data-pool.ts`

### HLP-013: CheckSystem

- **Purpose:** Structured assertion framework with named check groups
- **Methods:** `registerCheck()`, `statusCheck()`, `schemaCheck()`, `thresholdCheck()`, `runChecks()`
- **Features:** Named check registration, batch execution, result aggregation
- **File:** `src/core/check-system.ts`

### HLP-014: RedisSecurityHelper

- **Purpose:** Secure Redis operations with access control
- **Methods:** Redis security wrappers, access validation
- **Features:** Key-level access control, operation auditing, connection security
- **File:** `src/helpers/redis-security.ts`

### HLP-015: ThinkTimeHelper

- **Purpose:** Realistic user think-time simulation for load tests
- **Methods:** `thinkTime()` (uniform random), `thinkTimeNormal()` (normal distribution), `randomNormal()` (Box-Muller), `pace()` (iteration pacing)
- **Features:** Preset ranges (FAST/NORMAL/SLOW/READING), clamped normal distribution, iteration pacing for constant throughput
- **File:** `src/helpers/think-time-helper.ts`

---

## 3. Patterns (10)

Reusable architectural patterns for common load-testing scenarios. All patterns are importable from `src/patterns/index.ts`.

### PAT-001: Authentication

- **Purpose:** Multi-protocol authentication flows
- **Functions:** `authenticate()`, `isSessionValid()`, `sessionRequestOptions()`
- **Protocols:** Bearer Token, Basic Auth, OAuth2 (client credentials, authorization code), API Key
- **Features:** Token caching, automatic refresh, session validation
- **File:** `src/patterns/auth-pattern.ts`

### PAT-002: Correlation & Interpolation

- **Purpose:** Dynamic data extraction and template substitution
- **Functions:** `extractFromResponse()`, `interpolate()`
- **Features:** JSONPath/regex extraction, Mustache-style template interpolation, chained extraction
- **File:** `src/patterns/correlation-pattern.ts`

### PAT-003: Pagination

- **Purpose:** Automated traversal of paginated API endpoints
- **Functions:** `initPagination()`, `traverseAll()`
- **Modes:** Offset-based, cursor-based, page-number-based
- **Features:** Automatic next-page detection, configurable page size, result accumulation
- **File:** `src/patterns/pagination-pattern.ts`

### PAT-004: Retry with Backoff

- **Purpose:** Resilient request execution with exponential backoff
- **Functions:** `withRetry()`, `retryRequest()`
- **Features:** Exponential backoff with jitter, configurable max retries, retry condition predicates
- **File:** `src/patterns/retry-pattern.ts`

### PAT-005: Weighted Execution

- **Purpose:** Probabilistic scenario distribution
- **Functions:** `weightedSwitch()`
- **Features:** Weighted random selection, scenario mixing, percentage-based distribution
- **File:** `src/patterns/weighted-execution.ts`

### PAT-006: Contract Validation

- **Purpose:** JSON Schema-based API contract validation
- **Class:** `ContractValidator`
- **Features:** ajv-based JSON Schema validation, custom error messages, draft-07 support
- **File:** `src/patterns/contract-validation.ts`

### PAT-007: Mock Server

- **Purpose:** Mock server configuration and URL management
- **Functions:** `loadMockConfigs()`, `getMockUrl()`
- **Features:** Per-endpoint mock definitions, environment-aware URL resolution, response stubbing
- **File:** `src/node/mock-server.ts` (Node-only; moved out of `src/patterns/` in Phase 4 / ARC-06)

### PAT-008: Chaos Injection

- **Purpose:** Fault injection for resilience testing
- **Functions:** `loadChaosConfig()`, `evaluateChaosRules()`
- **Features:** Latency injection, error injection, abort injection, configurable fault rates
- **File:** `src/patterns/chaos-injection.ts`

### PAT-009: Redis-Backed Patterns

- **Purpose:** Distributed coordination via Redis
- **Classes/Functions:** `UserPool`, `DistributedRateLimiter`, `StatsCounter`
- **Features:** Distributed user pool with checkout/checkin, global rate limiting, atomic counters
- **File:** `src/patterns/redis-patterns.ts`

### PAT-010: Funnel Analysis

- **Purpose:** Multi-step funnel execution with dropout tracking
- **Functions:** `initFunnelMetrics()`, `runFunnel()`
- **Features:** Step-by-step conversion tracking, dropout rate per step, funnel visualization data
- **File:** `src/patterns/funnel-pattern.ts`

---

## 4. Metrics Engine (125+ metrics in 11 calculators)

A central pipeline that collects, calculates, threshold-checks, and reports metrics. The engine follows a `collect -> calculate -> threshold-check -> report` architecture. Each calculator registers itself and is executed in order.

**Architecture:**
- **File:** `src/metrics/metrics-engine.ts` — Core orchestrator
- **Types:** `src/metrics/types.ts` — Shared types and utility functions

### 4.1 Performance Calculator (50 metrics: PERF-001 to PERF-050)

Calculates response time and latency metrics from k6 native data.

| ID Range       | Metric Group                        | Description                                           |
|----------------|-------------------------------------|-------------------------------------------------------|
| PERF-001..009  | Response Time Percentiles           | avg, min, median, max, p90, p95, p99, stddev, CV      |
| PERF-010..018  | TTFB & Connection Phases            | TTFB, DNS lookup, TCP connect, TLS handshake, server processing, content transfer |
| PERF-019..025  | APDEX & Satisfaction                | APDEX score (configurable T), satisfied/tolerating/frustrated ratios |
| PERF-026..035  | Trend Analysis                      | Response time trend slope (linear regression), warm-up stabilization indicator |
| PERF-036..050  | Advanced Latency                    | Idle time, protocol-specific markers, degradation index |

- **File:** `src/metrics/calculators/performance-calculator.ts`

### 4.2 Throughput Calculator (25 metrics: THRU-001 to THRU-025)

Calculates throughput, bandwidth, and capacity metrics.

| ID Range       | Metric Group                        | Description                                           |
|----------------|-------------------------------------|-------------------------------------------------------|
| THRU-001..005  | Core Throughput                     | RPS achieved, bytes in/out, TPS                       |
| THRU-006..010  | Ratio Analysis                      | Peak-to-mean ratio, throughput per VU                 |
| THRU-011..015  | Ceiling Detection                   | Throughput ceiling, Little's Law validation            |
| THRU-016..020  | Goodput & Amplification             | Goodput, retry amplification factor                   |
| THRU-021..025  | Headroom & Limits                   | Rate-limit headroom, connection limit proximity       |

- **File:** `src/metrics/calculators/throughput-calculator.ts`

### 4.3 Error Calculator (30 metrics: ERR-001 to ERR-030)

Calculates error distribution, trends, and correlation metrics.

| ID Range       | Metric Group                        | Description                                           |
|----------------|-------------------------------------|-------------------------------------------------------|
| ERR-001..005   | Core Error Rates                    | Overall error rate, 5xx rate, 429 rate, 4xx rate      |
| ERR-006..010   | Failure Modes                       | Timeout rate, connection failures, DNS failures, TLS failures |
| ERR-011..015   | Spike & Trend                       | Error spike (max 1-min window), error trend slope     |
| ERR-016..020   | Budget & Retry                      | Error budget burn rate, retry success rate, circuit breaker indicators |
| ERR-021..025   | Shannon Entropy                     | Error code distribution entropy, error diversity      |
| ERR-026..030   | Cascade & Correlation               | Cascade failure detection, error correlation analysis |

- **File:** `src/metrics/calculators/error-calculator.ts`

### 4.4 Saturation Calculator (50 metrics: SAT-001 to SAT-050)

Calculates resource saturation across 11 subsystems. Requires external metrics from Prometheus.

| ID Range       | Metric Group                        | Description                                           |
|----------------|-------------------------------------|-------------------------------------------------------|
| SAT-001..005   | VU Saturation                       | Peak VU, saturation point, headroom                   |
| SAT-006..010   | CPU                                 | App CPU, host CPU, throttle events                    |
| SAT-011..015   | Memory                              | RSS, growth slope, OOM indicator                      |
| SAT-016..020   | GC                                  | Pause p99, frequency, overhead, heap utilization      |
| SAT-021..025   | System                              | Threads, pool queue depth, file descriptors, socket backlog |
| SAT-026..030   | Storage                             | Disk I/O, IOPS, latency                               |
| SAT-031..035   | Network                             | Bandwidth, drops, retransmits, ephemeral ports        |
| SAT-036..040   | Connection Pool                     | Exhaustion, wait time, utilization                    |
| SAT-041..045   | Database                            | Pool usage, query latency, lock wait, deadlocks       |
| SAT-046..048   | Cache                               | Hit ratio, eviction rate, latency                     |
| SAT-049..050   | Queue                               | Depth, publish latency, consumer lag                  |

- **Files:** `src/metrics/calculators/saturation/` (5 sub-calculators: `cpu`, `memory`, `io`, `network`, `resource`) + `saturation/index.ts` facade. The legacy `saturation-calculator.ts` is a 5-line re-export shim kept for backwards compatibility (Phase 4 / ARC-07).

### 4.5 SLA Calculator (20 metrics: SLA-001 to SLA-020)

Calculates Service Level Agreement compliance.

| ID Range       | Metric Group                        | Description                                           |
|----------------|-------------------------------------|-------------------------------------------------------|
| SLA-001..005   | Availability                        | Request-based availability, time-based availability   |
| SLA-006..010   | Error Budget                        | Error budget remaining, burn rate                     |
| SLA-011..015   | SLO Compliance                      | Latency SLO compliance, throughput SLO compliance, multi-SLI composite score |
| SLA-016..020   | Recovery & Breach                   | MTTR, breach duration, breach frequency, correctness rate, idempotency |

- **File:** `src/metrics/calculators/sla-calculator.ts`

### 4.6 Stability / Soak Calculator (20 metrics: STAB-001 to STAB-020)

Detects long-running degradation patterns via regression analysis.

| ID Range       | Metric Group                        | Description                                           |
|----------------|-------------------------------------|-------------------------------------------------------|
| STAB-001..005  | Leak Detection                      | Memory leak slope, handle leak, thread leak, connection leak |
| STAB-006..010  | Latency Drift                       | Early vs late p95 comparison, latency degradation index |
| STAB-011..015  | Throughput Drift                    | Early vs late RPS comparison, throughput stability    |
| STAB-016..020  | Error & Log Drift                   | Error rate drift, spike detection, log volume anomaly, soak suitability assessment |

- **File:** `src/metrics/calculators/stability-calculator.ts`

### 4.7 Scalability Calculator (20 metrics: SCALE-001 to SCALE-020)

Evaluates how the system scales with increasing load.

| ID Range       | Metric Group                        | Description                                           |
|----------------|-------------------------------------|-------------------------------------------------------|
| SCALE-001..005 | Scalability Index                   | Linear scalability index (Amdahl's Law proxy), efficiency ratio |
| SCALE-006..010 | Multi-Load Analysis                 | Throughput at 2x/5x/10x baseline, latency at 2x/5x/10x baseline |
| SCALE-011..015 | Efficiency                          | RPS per VU, request amplification factor              |
| SCALE-016..020 | Ceiling & Curve                     | Throughput ceiling detection, latency degradation curve (p95 vs VU slope) |

- **File:** `src/metrics/calculators/scalability-calculator.ts`

### 4.8 Chaos Engineering Calculator (20 metrics: CHAOS-001 to CHAOS-020)

Measures resilience under fault injection.

| ID Range       | Metric Group                        | Description                                           |
|----------------|-------------------------------------|-------------------------------------------------------|
| CHAOS-001..005 | Recovery                            | Recovery time (MTTR proxy), circuit breaker activation/reset cycles |
| CHAOS-006..010 | Storm & Isolation                   | Retry storm detection, bulkhead isolation effectiveness |
| CHAOS-011..015 | Degradation & Resilience            | Graceful degradation score, composite resilience score |
| CHAOS-016..020 | Fault-Specific                      | Network partition error rate, CPU spike error rate, latency overhead from chaos agents |

- **File:** `src/metrics/calculators/chaos-calculator.ts`

### 4.9 Security Under Load Calculator (20 metrics: SEC-001 to SEC-020)

Evaluates security posture during load testing.

| ID Range       | Metric Group                        | Description                                           |
|----------------|-------------------------------------|-------------------------------------------------------|
| SEC-001..005   | Authentication                      | Auth failure rate under load, token refresh failure rate, JWT/session expiry rate |
| SEC-006..010   | Rate Limiting & TLS                 | Rate-limiting accuracy (429 vs expected), TLS version compliance |
| SEC-011..015   | Headers & Input                     | Security header presence, input validation rejection rate |
| SEC-016..020   | Advanced                            | Privilege escalation detection, PII leak indicators, CORS misconfiguration |

- **File:** `src/metrics/calculators/security-calculator.ts`

### 4.10 Observability Under Load Calculator (20 metrics: OBS-001 to OBS-020)

Evaluates observability stack health during load.

| ID Range       | Metric Group                        | Description                                           |
|----------------|-------------------------------------|-------------------------------------------------------|
| OBS-001..005   | Log & Trace                         | Log ingestion rate/completeness, trace completeness, sampling rate |
| OBS-006..010   | Alerting & Correlation              | Alert latency, correlation ID propagation rate        |
| OBS-011..015   | Dashboard & Scrape                  | Dashboard refresh rate, metrics scrape success rate   |
| OBS-016..020   | Instrumentation                     | Structured logging compliance, distributed trace coverage, span error rate, overhead |

- **File:** `src/metrics/calculators/observability-calculator.ts`

### 4.11 Data Integrity Calculator (13 metrics: DI-001 to DI-013)

Validates data correctness under concurrent load.

| ID Range       | Metric Group                        | Description                                           |
|----------------|-------------------------------------|-------------------------------------------------------|
| DI-001..003    | Consistency                         | Read-after-write consistency, stale reads, duplicate request detection |
| DI-004..006    | Transactions                        | Transaction rollback rate, data loss events, response schema consistency |
| DI-007..010    | Business Logic                      | Business invariant violations, idempotency correctness, partial write detection |
| DI-011..013    | Ordering & Integrity                | Counter/balance drift, event ordering violations, checksum/hash validation failures |

- **File:** `src/metrics/calculators/data-integrity-calculator.ts`

### ME-001: Overall Results Score

- **Purpose:** GPT-inspired 0–100 score computed from pass/warn/fail metric counts; appended to every `MetricsReport` as `score`
- **Grades:** A ≥ 90 / B ≥ 80 / C ≥ 70 / D ≥ 60 / F < 60; healthy = value ≥ 90
- **Weighting:** pass = 1.0, warn = 0.5, fail = 0; `na` metrics excluded from denominator
- **Surfaces as:** `MetricsReport.score` → JSON `extendedMetrics.score`
- **File:** `src/metrics/score.ts`

---

## 5. Reporting (18+ features)

A comprehensive reporting pipeline producing interactive HTML, PDF, JSON, and Markdown outputs.

### RPT-001: Interactive HTML Report

- **Sections:** 17+ sections in a single-page interactive report
- **Features:**
  - KPI strip (checks, avg response time, p95, p99, error rate, throughput, APDEX)
  - APDEX gauge visualization with color-coded ranges
  - SLA compliance table with pass/fail indicators
  - Percentile distribution chart (histogram + overlay)
  - Groups analysis panel with per-group breakdown
  - Custom metrics panel (Counters, Gauges, Rates, Trends)
  - Web Vitals panel (LCP, FID, CLS, TTFB)
  - Historical comparison (delta tables + sparklines)
  - Expandable raw data sections
- **File:** `src/reporting/html-report-generator.ts`

### RPT-002: PDF / PNG Export

- **Purpose:** Automated export of HTML reports to PDF and PNG via headless Puppeteer
- **Features:** Configurable page size, landscape/portrait, custom margins
- **File:** `src/reporting/html-report-generator.ts` (export methods)

### RPT-003: LLM Analysis Reports

- **Purpose:** AI-generated narrative analysis of test results
- **Outputs:** `analysis-*.md` (technical analysis), `message-*.md` (stakeholder summary)
- **Features:** Context-aware analysis, recommendation generation, severity classification

### RPT-004: Auto-Comparison

- **Purpose:** Automatic comparison with previous execution for the same client/scenario
- **Features:** Delta calculation, regression detection, improvement highlighting

### RPT-005: Trend Analysis

- **Purpose:** Historical trend visualization across multiple runs
- **Features:** Sparkline charts, moving averages, trend direction indicators
- **File:** `src/reporting/trend-visualizer.ts`

### RPT-006: JSON Summary Output

- **Purpose:** Machine-readable summary in JSON format (schema v2.0.0)
- **Features:** Structured output for CI/CD pipeline consumption, threshold pass/fail status
- **File:** `src/reporting/json-summary-generator.ts`

### RPT-007: Capacity Analysis

- **Purpose:** Projection of system capacity based on test results
- **Features:** Maximum sustainable load estimation, bottleneck identification
- **File:** `src/reporting/capacity-analyzer.ts`, `src/reporting/capacity-report-generator.ts`

### RPT-008: Branding

- **Purpose:** Customizable report branding
- **Features:** Custom logo, brand colors, organization name injection
- **File:** `src/core/branding-validator.ts`

### RPT-009: WCAG Accessibility

- **Purpose:** Accessible report output compliant with WCAG guidelines
- **Features:** Proper heading hierarchy (h1-h6), aria-labels, color contrast, keyboard navigation

### RPT-010: KPI Strip

- **Purpose:** At-a-glance KPI summary bar at the top of HTML reports
- **Metrics:** Checks pass rate, average response time, p95, p99, error rate, throughput (RPS), APDEX score

### RPT-011: APDEX Gauge

- **Purpose:** Visual APDEX score representation
- **Features:** Color-coded gauge (Excellent/Good/Fair/Poor/Unacceptable), configurable T threshold

### RPT-012: SLA Compliance Table

- **Purpose:** Tabular SLA evaluation with pass/fail status
- **Features:** Per-SLO row with target, actual, status, and margin

### RPT-013: Percentile Distribution Chart

- **Purpose:** Response time distribution visualization
- **Features:** Histogram with p50/p90/p95/p99 overlay lines

### RPT-014: Groups Analysis Panel

- **Purpose:** Per-group performance breakdown
- **Features:** Group-level metrics (avg, p95, error rate), synthetic thresholds per group

### RPT-015: Custom Metrics Panel

- **Purpose:** Display of user-defined k6 custom metrics
- **Types:** Counters, Gauges, Rates, Trends
- **Features:** Auto-detection, tabular display with sparklines

### RPT-016: Web Vitals Panel

- **Purpose:** Browser-oriented Web Vitals metrics
- **Metrics:** LCP (Largest Contentful Paint), FID (First Input Delay), CLS (Cumulative Layout Shift), TTFB
- **Features:** Good/Needs Improvement/Poor classification per Core Web Vitals thresholds

### RPT-017: Historical Comparison

- **Purpose:** Side-by-side comparison with historical runs
- **Features:** Delta tables (absolute + percentage), sparkline trend charts, regression alerts

### RPT-018: Overall Score Badge

- **Purpose:** KPI cell in the HTML report metrics strip showing a 0–100 overall health score with color coding
- **Color thresholds:** green ≥ 90 / amber 70–89 / red < 70
- **Score resolution:** prefers `extendedMetrics.score` (full engine score); falls back to checks-only derivation via `scoreFromCounts`
- **File:** `src/reporting/artifacts/html-generator.ts`

---

## 6. Grafana Dashboards (3)

Pre-built Grafana dashboard JSON models provisioned via the infrastructure stack.

### GRF-001: Load Test Overview

- **Purpose:** Real-time k6 test monitoring dashboard
- **Panels:** VU count, RPS, response time percentiles, error rate, checks, iterations
- **Data Source:** Prometheus (k6 statsd/prometheus output)
- **File:** `infrastructure/grafana/dashboards/k6-load-test-overview.json`

### GRF-002: Enterprise Analytics

- **Purpose:** Cross-run analytics and historical trend analysis
- **Panels:** Test history, trend comparisons, SLA tracking, capacity projections
- **Data Source:** Prometheus
- **File:** `infrastructure/grafana/dashboards/k6-enterprise-analytics.json`

### GRF-003: Web Vitals

- **Purpose:** Browser performance metrics dashboard
- **Panels:** LCP, FID, CLS, TTFB with Good/Needs Improvement/Poor thresholds
- **Data Source:** Prometheus
- **File:** `infrastructure/grafana/dashboards/k6-web-vitals.json`

---

## 7. Custom Metrics (4 types)

Support for k6 custom metric types in test scripts, with automatic collection, threshold evaluation, and report integration.

### CM-001: Counter

- **Purpose:** Cumulative count of events
- **Usage:** `new Counter('my_counter')` — track total occurrences (e.g., business transactions, cache hits)
- **Report:** Total value, rate per second

### CM-002: Gauge

- **Purpose:** Instantaneous value tracking
- **Usage:** `new Gauge('my_gauge')` — track current state (e.g., queue depth, active sessions)
- **Report:** Last value, min, max

### CM-003: Rate

- **Purpose:** Percentage of non-zero values
- **Usage:** `new Rate('my_rate')` — track success/failure ratios (e.g., cache hit rate, auth success rate)
- **Report:** Percentage value with pass/fail threshold

### CM-004: Trend

- **Purpose:** Statistical distribution tracking
- **Usage:** `new Trend('my_trend')` — track timing distributions (e.g., custom operation latency)
- **Report:** avg, min, max, med, p90, p95, p99

---

## 8. Groups Analysis (3)

Hierarchical test organization with per-group metrics and synthetic thresholds.

### GRP-001: Group Definition

- **Purpose:** Organize test steps into named groups via k6 `group()` API
- **Features:** Nested group support, automatic timing per group

### GRP-002: Per-Group Metrics

- **Purpose:** Automatic metric breakdown per group
- **Metrics:** avg, p95, p99, error rate, check pass rate per group
- **Features:** Synthetic thresholds per group, group-level pass/fail

### GRP-003: Group Analysis in Reports

- **Purpose:** Dedicated report panel for group-level analysis
- **Features:** Sortable table, per-group sparklines, worst-performing group highlighting

---

## 9. SLA / SLO (5)

Service Level Agreement and Service Level Objective evaluation framework.

### SLO-001: SLO Definition

- **Purpose:** Declarative SLO definitions per service
- **Format:** JSON configuration in `clients/{name}/config/slos.json`
- **Features:** Latency targets, availability targets, error budget configuration

### SLO-002: Three-State Evaluation

- **Purpose:** SLO compliance classification
- **States:** `cumple` (meets target), `en_riesgo` (within risk margin), `incumple` (exceeds target)
- **File:** `src/core/slo-evaluator.ts`

### SLO-003: Error Budget Tracking

- **Purpose:** Error budget consumption monitoring
- **Features:** Remaining budget percentage, burn rate, projected exhaustion

### SLO-004: Multi-SLI Composite Score

- **Purpose:** Weighted composite score across multiple Service Level Indicators
- **Features:** Configurable SLI weights, normalized scoring

### SLO-005: SLO Reporting Integration

- **Purpose:** SLO results embedded in HTML and JSON reports
- **Features:** SLA compliance table, trend tracking across runs

---

## 10. Security (14)

Defense-in-depth security controls across the framework.

### SEC-001: RBAC (Role-Based Access Control)

- **Purpose:** Three-tier role system for framework access control
- **Roles:** `developer` (run tests, view reports), `lead` (manage clients, configure SLOs), `admin` (full access, manage roles)
- **Features:** Granular permission matrix, role inheritance
- **Files:** `src/core/rbac.ts`, `src/core/rbac-enforcer.ts`, `src/types/rbac.d.ts`

### SEC-002: Immutable Audit Log

- **Purpose:** Tamper-evident audit trail using SHA-256 hash chain
- **Format:** JSONL with hash chain (each entry includes hash of previous entry)
- **Events:** Test execution, config changes, role modifications, report access
- **Files:** `src/core/audit-logger.ts`, `src/types/audit.d.ts`

### SEC-003: Client Isolation

- **Purpose:** Path traversal protection for multi-tenant client directories
- **Features:** Canonical path resolution, symlink detection, directory boundary enforcement
- **Files:** `src/core/client-resolver.ts`, `src/core/client-validator.ts`

### SEC-004: Shell Hardening

- **Purpose:** Command injection prevention for shell operations
- **Features:** Input sanitization, argument escaping, secrets backend whitelist
- **File:** `src/core/config-security.ts`

### SEC-005: Secure YAML Parsing

- **Purpose:** Safe YAML deserialization with resource limits
- **Features:** Size limits, depth limits, billion laughs (YAML bomb) protection
- **File:** `src/core/yaml-parser.ts`

### SEC-006: Secrets Management

- **Purpose:** Detection and protection of secrets in configurations and output
- **Features:** Pattern-based secret detection (API keys, tokens, passwords), URL credential sanitization
- **File:** `src/core/secrets-manager.ts`

### SEC-007: PII Redaction

- **Purpose:** Automatic PII removal from HTML reports
- **Features:** Email, phone, SSN, credit card pattern detection and masking
- **File:** `src/reporting/html-report-generator.ts`

### SEC-008: Prometheus Sanitizer

- **Purpose:** Label and value sanitization for Prometheus metrics
- **Features:** Label name validation, value escaping, cardinality control
- **File:** `src/core/prometheus-sanitizer.ts`

### SEC-009: Config Security

- **Purpose:** Hardcoded secret detection in configuration files
- **Features:** Regex-based pattern scanning, pre-commit hook integration
- **File:** `src/core/config-security.ts`

### SEC-010: Execution Isolation

- **Purpose:** Process-level isolation for test executions
- **Features:** Isolated environment variables, isolated tags, temporary directory per execution
- **File:** `src/core/execution-isolation.ts`

### SEC-011: Report Isolation

- **Purpose:** Path traversal protection for report output directories
- **Features:** Output directory validation, cross-client report access prevention
- **File:** `src/core/report-isolation.ts`

### SEC-012: CLI Auth

- **Purpose:** RBAC enforcement at the CLI boundary
- **Features:** Token-based authentication, role verification before command execution
- **File:** `src/core/cli-auth.ts`

### SEC-013: Input Validation

- **Purpose:** Comprehensive input validation for all user-supplied parameters
- **Features:** Required field checks, format validation, length limits, type coercion prevention
- **File:** `src/core/input-validator.ts`

### SEC-014: Binary Validation

- **Purpose:** k6 binary integrity verification
- **Features:** Checksum validation, version verification, trusted source enforcement
- **File:** `src/core/binary-validator.ts`

---

## 11. CI/CD (3)

Ready-to-use pipeline templates for continuous performance testing.

### CI-001: GitHub Actions Template

- **Purpose:** GitHub Actions workflow for automated load test execution
- **Features:** Matrix strategy for multiple clients/scenarios, artifact upload, status checks
- **File:** `infrastructure/ci-templates/github-actions-client.yml`

### CI-002: GitLab CI Template

- **Purpose:** GitLab CI pipeline for automated load test execution
- **Features:** Stage-based execution, artifact collection, merge request integration
- **File:** `infrastructure/ci-templates/gitlab-ci-client.yml`

### CI-003: detect-secrets Integration

- **Purpose:** Pre-commit secret scanning
- **Features:** Baseline management, custom plugin support, CI pipeline integration

---

## 12. Observability (9)

Full observability stack integration for monitoring load test infrastructure and results.

### OBS-001: Prometheus Metrics Collection

- **Purpose:** Metrics ingestion from k6 and target systems
- **Features:** PromQL queries (instant + range), Loki log queries, Tempo traces, Pyroscope profiles
- **File:** `infrastructure/prometheus/prometheus.yml`, `src/ai/observability/observability-clients.ts` (canonical `PrometheusClient`), `src/observability/infra-metrics-collector.ts` (infra-side PromQL via `observability/http-safe.ts::fetchSafe`)

### OBS-002: Grafana Dashboards

- **Purpose:** Visual monitoring (see Section 6 for details)
- **Dashboards:** Load Test Overview, Enterprise Analytics, Web Vitals
- **File:** `infrastructure/grafana/dashboards/`

### OBS-003: Loki Log Aggregation

- **Purpose:** Centralized log collection and querying
- **Features:** LogQL queries, structured log ingestion, correlation with traces
- **File:** `infrastructure/loki/loki-config.yml`

### OBS-004: Tempo Distributed Tracing

- **Purpose:** Distributed trace collection and visualization
- **Features:** Trace-to-log correlation, service maps, latency histograms
- **File:** `infrastructure/tempo/tempo-config.yml`

### OBS-005: Pyroscope Profiling

- **Purpose:** Continuous profiling of target applications during load tests
- **Features:** CPU and memory flame graphs, comparison mode

### OBS-006: Generator Health Monitoring

- **Purpose:** Monitor the health of k6 load generators themselves
- **Features:** CPU/memory usage of generator nodes, dropped iterations detection

### OBS-007: Overhead Detection

- **Purpose:** Measure observability overhead on test accuracy
- **Features:** Instrumentation latency impact, resource cost of monitoring

### OBS-008: Tracing Instrumentation

- **Purpose:** Automatic trace context propagation in test requests
- **Formats:** W3C Trace Context, Jaeger, B3, Datadog
- **Features:** Configurable propagation format, header injection via HeaderHelper

### OBS-009: Pyroscope Instrumentation

- **Purpose:** Automatic profiling data collection during test execution
- **Features:** Language-agnostic profiling, per-endpoint flame graph generation

---

## 13. Generators (4)

Scaffolding tools for rapid creation of test artifacts.

### GEN-001: Client Scaffolding

- **Command:** `node bin/generate.js --type=client --name=<client-name>`
- **Generates:** Client directory structure with config, scenarios, services, data directories
- **Output:** `clients/<name>/config/`, `clients/<name>/scenarios/`, `clients/<name>/services/`

### GEN-002: Scenario Scaffolding

- **Command:** `node bin/generate.js --type=scenario --client=<client> --name=<scenario>`
- **Generates:** Test scenario file with imports, setup, default function, and teardown
- **Output:** `clients/<client>/scenarios/<name>.ts`

### GEN-003: Service Scaffolding

- **Command:** `node bin/generate.js --type=service --client=<client> --name=<service>`
- **Generates:** Service abstraction layer with typed request methods
- **Output:** `clients/<client>/services/<name>-service.ts`

### GEN-004: Data Factory Scaffolding

- **Command:** `node bin/generate.js --type=factory --client=<client> --name=<factory>`
- **Generates:** Data factory with builder pattern for test data creation
- **Output:** `clients/<client>/data/<name>-factory.ts`

---

## 14. Distribution — Kubernetes (5)

Distributed load test execution on Kubernetes via the k6 Operator.

### DIST-001: k6 Operator Integration

- **Purpose:** Orchestrate distributed k6 runs across multiple pods
- **Features:** Automatic pod scaling, test distribution, result aggregation
- **File:** `infrastructure/k8s/k6-testrun.yaml`

### DIST-002: Execution Segments

- **Purpose:** Divide test load across multiple k6 instances
- **Features:** Segment-based VU distribution, synchronized start

### DIST-003: NetworkPolicy

- **Purpose:** Network-level isolation for load test pods
- **Features:** Ingress/egress rules, namespace isolation
- **File:** `infrastructure/k8s/network-policy.yaml`

### DIST-004: K8s RBAC

- **Purpose:** Kubernetes-native access control for test execution
- **Resources:** ServiceAccount, Role, RoleBinding
- **File:** `infrastructure/k8s/rbac.yaml`, `infrastructure/k8s/helm/k6-enterprise/templates/rbac.yaml`

### DIST-005: Helm Charts

- **Purpose:** Templated Kubernetes deployment for the framework
- **Features:** Configurable values, multi-environment support
- **Files:** `infrastructure/k8s/helm/k6-enterprise/Chart.yaml`, `infrastructure/k8s/helm/k6-enterprise/values.yaml`

---

## 15. MCP Server (8 tools)

Model Context Protocol server enabling AI agents and IDE integrations to interact with the framework programmatically.

### MCP-001: run_test

- **Purpose:** Execute a k6 test via the CLI runner
- **Parameters:** `client`, `test`, `profile` (default: smoke), `env` (default: default)
- **Returns:** Status (pass/fail), exit code, output, report path
- **Security:** Input sanitization, concurrency guard (one test per client+scenario)
- **File:** `mcp-server/src/tools/index.ts`

### MCP-002: validate_schema

- **Purpose:** Validate a configuration file against JSON schema
- **Parameters:** Config file path or content
- **Returns:** Validation result with error details
- **File:** `mcp-server/src/tools/index.ts`

### MCP-003: generate_scaffold

- **Purpose:** Create client, test, or service scaffolding
- **Parameters:** Type (client/scenario/service/factory), name, client
- **Returns:** Generated file paths
- **File:** `mcp-server/src/tools/index.ts`

### MCP-004: query_knowledge_base

- **Purpose:** RAG-based search across framework documentation
- **Parameters:** `query`, `collection`, `top_k`, `type` (script/doc/helper/pattern), `client_id`
- **Returns:** Matching documents with relevance scores
- **File:** `mcp-server/src/tools/ai-tools.ts`

### MCP-005: get_observability_data

- **Purpose:** Fetch monitoring data from Prometheus, Tempo, Loki, and Pyroscope
- **Parameters:** Data source, query expression, time range
- **Returns:** Query results with timestamps
- **File:** `mcp-server/src/tools/ai-tools.ts`

### MCP-006: validate_generated_code

- **Purpose:** Validate TypeScript code quality for AI-generated test scripts
- **Parameters:** Code content or file path
- **Returns:** Validation report (syntax, imports, patterns, security)
- **File:** `mcp-server/src/tools/ai-tools.ts`

### MCP-007: get_test_history

- **Purpose:** Retrieve historical execution data for a client/test combination
- **Parameters:** Client, test, limit
- **Returns:** Execution history with metrics summaries
- **File:** `mcp-server/src/tools/ai-tools.ts`

### MCP-008: create_jira_ticket

- **Purpose:** Create a Jira ticket for performance bugs or regressions
- **Parameters:** Project, summary, description, priority, labels
- **Returns:** Ticket key and URL
- **Security:** Credential masking in output
- **File:** `mcp-server/src/tools/ai-tools.ts`

---

## 16. AI Roadmap v2 (4 agents)

Next-generation AI agent pipeline for autonomous load test planning, generation, analysis, and reporting.

### AI-001: Planner Agent

- **Purpose:** Analyze requirements and generate test plans
- **Capabilities:** Endpoint discovery, load profile recommendation, SLO suggestion, scenario design
- **File:** `src/ai/agents/planner-agent.ts`

### AI-002: Builder Agent

- **Purpose:** Generate k6 test scripts from test plans
- **Capabilities:** TypeScript code generation, helper/pattern integration, data factory creation
- **Validation:** Built-in validation suite for generated code quality
- **Files:** `src/ai/agents/builder-agent.ts`, `src/ai/agents/builder-validation-suite.ts`

### AI-003: Analyst Agent

- **Purpose:** Analyze test results and detect anomalies
- **Capabilities:** Statistical analysis, anomaly detection, root cause analysis, regression identification
- **Validation:** Analyst-specific validation suite
- **Files:** `src/ai/agents/analyst-agent.ts`, `src/ai/agents/analyst-validation-suite.ts`, `src/ai/analysis/anomaly-detector.ts`

### AI-004: Reporter Agent

- **Purpose:** Generate natural-language reports from analysis results
- **Capabilities:** Stakeholder-targeted summaries, technical deep-dives, executive briefs
- **File:** `src/ai/agents/reporter-agent.ts`

### Supporting AI Infrastructure

| Component              | Purpose                                          | File                                        |
|------------------------|--------------------------------------------------|---------------------------------------------|
| Pipeline Orchestrator  | Chains agents in sequence: Plan -> Build -> Analyze -> Report | `src/ai/pipeline/orchestrator.ts`           |
| Knowledge Base         | RAG-backed knowledge retrieval (ChromaDB)        | `src/ai/knowledge-base/knowledge-base.ts`   |
| Budget Manager         | Token/cost tracking across AI agent invocations  | `src/ai/core/budget-manager.ts`             |
| Self-Healing           | Adaptive test adjustment based on runtime errors | `src/ai/adaptive/self-healing.ts`           |
| Observability Clients  | AI agent access to Prometheus/Tempo/Loki/Pyroscope | `src/ai/observability/observability-clients.ts` |
| AI Stack PoC           | Proof-of-concept integration of the full AI stack | `src/ai/poc/ai-stack-poc.ts`                |

---

## Appendix: Directory Structure

```
k6-framework/
├── bin/                              # CLI scripts and generators
│   ├── generate.js                   # Scaffold generator
│   └── generate-data.js              # Data generation utilities
├── clients/                          # Client test projects
│   └── _reference/                   # Reference client template
├── docs/                             # Framework documentation
├── infrastructure/
│   ├── ci-templates/                 # CI/CD pipeline templates
│   ├── grafana/dashboards/           # Grafana dashboard JSON models
│   ├── k8s/                          # Kubernetes manifests and Helm charts
│   ├── loki/                         # Loki configuration
│   ├── prometheus/                   # Prometheus configuration
│   └── tempo/                        # Tempo configuration
├── mcp-server/src/                   # MCP server implementation
│   ├── tools/                        # MCP tool definitions
│   ├── resources/                    # MCP resource definitions
│   └── utils/                        # Shared utilities
├── shared/
│   └── profiles/                     # Load profile JSON definitions
└── src/
    ├── ai/                           # AI agent pipeline (v2)
    │   ├── agents/                   # Planner, Builder, Analyst, Reporter
    │   ├── analysis/                 # Anomaly detection
    │   ├── adaptive/                 # Self-healing
    │   ├── core/                     # Budget management
    │   ├── knowledge-base/           # RAG/ChromaDB integration
    │   ├── observability/            # AI observability clients
    │   ├── pipeline/                 # Agent orchestrator
    │   └── poc/                      # Proof of concept
    ├── core/                         # Framework core
    │   ├── rbac.ts                   # Role-based access control
    │   ├── audit-logger.ts           # Immutable audit log
    │   ├── secrets-manager.ts        # Secret detection
    │   ├── slo-evaluator.ts          # SLO evaluation
    │   ├── check-system.ts           # Assertion framework
    │   └── ...                       # 20+ core modules
    ├── helpers/                      # 14 reusable helpers
    ├── integrations/                 # External integrations (Slack, notifications)
    ├── metrics/                      # Metrics engine
    │   ├── metrics-engine.ts         # Core orchestrator
    │   └── calculators/              # 11 domain calculators
    ├── patterns/                     # 10 architectural patterns
    ├── reporting/                    # Report generation pipeline
    └── types/                        # TypeScript type definitions
```

---

> **Document version:** 1.0.0  
> **Last updated:** 2026-02-23  
> **Total features cataloged:** 192+
