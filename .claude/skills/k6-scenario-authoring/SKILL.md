---
name: k6-scenario-authoring
description: Write or modify k6 TypeScript scenarios that follow this framework's conventions — the 5 scenario buckets (api / flow / domain / chaos / perf), path aliases (@core, @helpers, @patterns, @observability, @reporting), goja-only imports, SharedArray/DataPool data, correlation / funnel / retry patterns, low-cardinality tags, thresholds, and gate markers. Use when asked to "write a k6 scenario for <endpoint or flow>", "convert this test plan into a scenario", "add thresholds/correlation to <scenario>", or "review a scenario against framework conventions". Not for generic k6 questions outside this repo (use the k6 skill) or for running tests (run-operations).
---

# k6 scenario authoring

`<repo>` means the repository root. Scenarios run in k6's goja runtime, not Node.js.

## Where the file goes

| Bucket | Purpose | Example to copy from |
|--------|---------|----------------------|
| `api/` | Single-endpoint probes | `<repo>/clients/_reference/scenarios/api/smoke-users.ts` |
| `flow/` | Multi-step user journeys | `<repo>/clients/_reference/scenarios/flow/checkout-flow.ts` |
| `domain/` | Service-level, `domain/<service>/<action>.ts` | `<repo>/clients/_reference/scenarios/domain/orders-lifecycle.ts` |
| `chaos/` | Fault injection / resilience | `<repo>/clients/_reference/scenarios/chaos/fci-spike.ts` |
| `perf/` | Capacity, breakpoint, stress, soak | `<repo>/clients/_reference/scenarios/perf/breakpoint-tier.ts` |

Monorepo path: `clients/<client>/scenarios/<bucket>/<name>.ts`. Standalone export:
`scenarios/<bucket>/<name>.ts`. Client services go in `lib/services`, factories in
`lib/factories`, data in `data`.

## Rules

1. Imports: `k6`, `k6/*` modules and the aliases `@core/*`, `@helpers/*`, `@patterns/*`,
   `@observability/*`, `@reporting/*`, `@types-k6/*`. Never `@node/*`, `fs`, `path`,
   `http`, `crypto` from Node, or any npm package that needs Node built-ins. ESLint
   blocks `@node/*` in scenarios.
2. Header JSDoc like the reference scenarios: `@executor`, `@profile`, `@thresholds`,
   `@cli`, `@expected`, `@troubleshoot`.
3. Base URLs and credentials come from `__ENV` or the client config, never literals.
   No tokens, cookies or real user data in source.
4. `thresholds` in `options` always present: at least latency percentile
   (`http_req_duration: ["p(95)<N"]`), error rate (`http_req_failed: ["rate<X"]`) and
   `checks`. Thresholds encode the SLO from the test plan; never widen them to make a
   run pass.
5. Tag requests with a stable `name` tag (e.g. `/orders/{id}`) so dynamic URLs do not
   explode metric cardinality. When the test uses dynamic URLs, set `systemTags` in
   `options` to a list that excludes `url` (keep `name`, `method`, `status`, `scenario`,
   `group`, `check`, `error_code`, `expected_response`).
6. Leave load shape to profiles: prefer small `vus`/`duration` defaults that the runner's
   `--profile` overrides. Arrival-rate scenarios use the `throughput-*` profiles.
7. Data: large or shared files load once in init context with `SharedArray` or
   `DataPool` (`@helpers/data-pool`). No `open()` inside the default function. See
   test-data-management for uniqueness across VUs and instances.
8. Think time with `sleep()` (or `@helpers/think-time-helper`) between user steps.
9. Checks via `@core/check-system` (`runChecks`, `statusCheck`, `schemaCheck`,
   `thresholdCheck`) or `check()`.
10. Gates: a scenario that can harm a shared environment (destructive writes, chaos
    against real dependencies, very high load) declares
    `export const gate = "unsafe";` (double quotes, top level). Unfinished work uses
    `"experimental"`; known-flaky uses `"quarantined"`.

## Patterns

| Need | Use |
|------|-----|
| Value from response A used in request B | `extractFromResponse` + `interpolate` from `@patterns/correlation-pattern` |
| Step-by-step conversion journey | `runFunnel` / `initFunnelMetrics` from `@patterns/funnel-pattern` |
| Transient failures that the real client retries | `withRetry` / `retryRequest` from `@patterns/retry-pattern` (never to hide errors) |
| Traffic mix | `weightedSwitch` from `@patterns/weighted-execution` |
| Auth token once per test | `setup()` + `@patterns/auth-pattern` |
| Pagination | `@patterns/pagination-pattern` |
| Fault injection | `@patterns/chaos-injection` (see chaos-resilience) |

## Done checklist

- [ ] File in the right bucket; name is kebab-case.
- [ ] `pnpm typecheck`, `pnpm lint` and `pnpm build` pass.
- [ ] Generation gate passes: `node <repo>/bin/validate-generated.js --kind=scenario <file>`
      when that validator exists in the repo (see guardrails-gate).
- [ ] Smoke run via run-operations exits 0 before anyone runs load.
- [ ] No secrets: `<repo>/bin/detect-secrets.sh` on the client directory exits 0.
