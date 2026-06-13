# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Conventional Commits](https://www.conventionalcommits.org/).

## [Unreleased]

### Added
- **p99.9 thresholds** on formal load profiles (smoke, quick, load, rampup, capacity, soak, throughput-*). Captures the tail latency that p99 hides.
- **VU-based variants** preserved as `load-vu`, `stress-vu`, `spike-vu`, `soak-vu` for special cases where VU concurrency is the metric of interest.
- **`observability/http-safe.ts`** — canonical `fetchSafe()` (timeout + AbortController + structured errors + auto-masking) consolidated from three reimplementations.
- **`core/secrets-manager::maskSensitive()`** — text-level secret scanner (Bearer / Basic / Authorization / password / token) added alongside the existing value-level `maskSecret()`.
- **`metrics/calculators/_helpers.ts`** — shared `m()`, `na()`, `avg()`, `percentile()` previously inlined in every calculator (≈360 LOC removed).
- **`metrics/types.ts::avg()`** — promoted from the calculators helpers so reporting code can consume it without crossing layer boundaries.

### Changed
- ⚠️ **BREAKING — Open-model defaults**: `load`, `stress`, `spike`, `soak` profiles now use arrival-rate executors (`ramping-arrival-rate` / `constant-arrival-rate`) instead of `ramping-vus`. This eliminates coordinated omission — when the SUT slows down, requests keep arriving at the target rate instead of VUs piling up in waits, so reported percentiles reflect what real users experience. Scenarios that depend on the prior closed-model semantics must switch to `load-vu`/`stress-vu`/`spike-vu`/`soak-vu`, or adopt the new open-model behavior (recommended).
- ⚠️ **BREAKING — `PrometheusClient` removed from `src/metrics/metrics-engine.ts`**. The canonical client is now `src/ai/observability/observability-clients.ts::PrometheusClient`, which returns the unified `ObservabilityResult` schema. The deleted class had no in-tree callers; out-of-tree consumers (none known) must migrate.
- `helpers/data-helper::randomItem` now accepts `readonly T[]` so callers passing `as const` arrays no longer need a cast.

### Deprecated
- Backward-compat aliases (kept for one minor release, will be removed in v0.4.0):
  - `helpers/redis-security::isSensitiveKey` → use `hasSensitivePrefix` instead.
  - `helpers/data-helper::weightedSwitch` (the picker variant) → use `pickWeightedFn` instead. The runner variant in `patterns/weighted-execution` keeps the canonical name.
  - `core/config-validator::ValidationResult` / `ValidationError` → use `ConfigValidationResult` / `ConfigValidationError`.
  - `core/quality-gate::ThresholdResult` → use `QualityGateThresholdResult`.
  - `helpers/validation-helper::ValidationResult` → use `ResponseValidation`.
  - `metrics/types::SloConfig` → use `SlaSloConfig`.
  - `types/config::AuthConfig` → use `ClientAuthConfig`.
  - `types/ai::AuthConfig` → use `AiAuthConfig`.
  - `ai/adaptive/self-healing::AuditEntry` → use `HealingAuditEntry`.

### Refactored (no behavior change)
- Consolidated three divergent `maskSensitive()` regex copies into the canonical one in `core/secrets-manager`. The merged version covers the union of patterns (some copies were missing Basic auth, others were missing `Authorization:` headers).
- Twelve duplicate type names disambiguated across the framework (see Deprecated). Each renamed type ships a `@deprecated` alias for backward compat.
- `examples/scenarios/api/04-retry-backoff.ts` rewritten to use `RequestHelper` + `withRetry` instead of inlining its own retry loop.
- `examples/scenarios/api/14-advanced-headers.ts` uses `uuid()` from `data-helper` instead of redefining locally.
- Validation suite types in `ai/agents/{analyst,builder}-validation-suite.ts` namespaced (`AnalystSuiteResult` / `BuilderSuiteResult`) to avoid collision.

## [0.2.0] - 2026-02-26

### Added
- **Standalone client tooling (spec 004):** HTML report generator, observability stack (Grafana+Prometheus), standalone binary builder, Claude Code config, MCP server
- **Export capabilities:** `--with-reports`, `--with-observability`, `--with-binary`, `--with-claude`, `--with-mcp`, `--full` flags in export-client.sh
- **Comprehensive README:** Dynamic README generation for exported clients with all capability sections
- **GitHub update support:** `--from=github:<org>/<repo>` with `--ref` in update-framework.sh
- **Unit testing:** Vitest infrastructure with 323 tests across 10 files (98%+ coverage on helpers/metrics)
- **CI pipeline:** `.github/workflows/unit-test.yml` for automated testing on push/PR
- **DataHelper extensions:** uuid, randomInt, randomItem, shuffle, randomBoolean, randomPhone, randomPassword, clone, merge, weightedSwitch, formatNumber, toQueryString, randomName, randomDate

### Fixed
- `.gitignore` now excludes `coverage/` and allows `.env.standalone`

## [0.1.0] - 2026-02-18

### Added
- **Core framework:** Two-layer architecture (generic + client) with TypeScript, webpack, k6
- **Helpers:** DataHelper, DateHelper, ValidationHelper, HeaderHelper, RequestHelper, RedisHelper, GraphQL, WebSocket, Upload
- **Patterns:** Auth, retry, pagination, correlation, weighted execution, contract validation, funnel, chaos injection
- **Metrics engine:** 11 domain calculators (performance, throughput, error, SLA, stability, scalability, saturation, chaos, security, observability, data-integrity) producing 288 metric results
- **Reporting:** HTML dashboard with SVG charts, JSON summary, capacity analysis, trend visualization
- **Observability:** Docker Compose stack (Grafana, Prometheus, Loki, Tempo, Pyroscope) with 3 dashboards
- **CLI tools:** run-test.sh (5-step pipeline), export-client.sh, build-binary.sh, clean-reports.sh
- **Binary builder:** Go-based standalone executable with embedded test scenarios
- **MCP server:** Model Context Protocol integration for Claude Code
- **3 client templates:** _benchmark, _reference, examples
- **13 load profiles:** smoke, quick, load, rampup, capacity, stress, spike, breakpoint, soak, throughput-low, throughput-medium, throughput-high, throughput-ramp
- **4 CI workflows:** k6-test, perf-gate, perf-regression, perf-smoke
- **Documentation:** Complete bilingual docs (EN/ES) with 28 files, feature catalog, compliance checklist
- **Quality toolchain:** ESLint, Prettier, Husky, commitlint, commitizen
