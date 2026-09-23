# Load testing tool selection guide

When the user hasn't decided on a tool, or when the default (k6) isn't the right fit. Pick based on protocol coverage, team skills, integration needs, and scale — not preference.

> Sources synthesized: rcampos09 (k6/Gatling/Locust best-practices), khanntm (JMeter enterprise patterns).

---

## Quick decision matrix

| Need | Recommendation |
|------|---------------|
| API + CI/CD pipeline integration | **k6** (default) |
| Multi-protocol (HTTP, JDBC, JMS, SOAP, FTP) at enterprise scale | **JMeter** |
| Highest sustainable throughput per generator (millions RPS) | **Gatling** |
| Test logic in Python, simple to extend | **Locust** |
| Lowest-overhead HTTP benchmarking, single-machine | **wrk2** |
| Browser-driven (real Web Vitals) | **k6/browser** or **Playwright + custom telemetry** |
| Recording from real user traffic, replay | **Vegeta** (replay), **GoReplay** (capture) |

---

## Detailed comparison

### k6 — default for modern API + CI/CD

**Strengths:**
- JavaScript/TypeScript scripting — familiar to most teams
- Native CI/CD integration (CLI exit codes, JSON output, HTML dashboard)
- Built-in support for HTTP, gRPC, WebSocket, browser
- Open-model executors (`constant-arrival-rate`) handle coordinated omission correctly
- Low resource footprint per VU (~hundreds of KB)
- Cloud version (Grafana Cloud k6) for distributed runs without ops overhead

**Limitations:**
- Not ideal for JDBC, JMS, FTP, SOAP — possible via custom modules but awkward
- Browser tests are heavier than headless API tests (chromium per VU)
- JS event loop bound — not as throughput-dense as Gatling for raw HTTP

**Use when:** API perf testing, CI/CD perf gates, cloud-native services, teams comfortable with JS.

### JMeter — enterprise multi-protocol

**Strengths:**
- Broadest protocol support: HTTP, HTTPS, JDBC, JMS, SOAP, FTP, LDAP, SMTP, TCP
- Mature ecosystem (plugins, Taurus wrapper, distributed mode)
- GUI for scenario design — accessible to non-developers
- Strong reporting (HTML dashboard, integration with Grafana via Backend Listener)

**Limitations:**
- XML-based test plans are painful to diff/review in Git
- GUI tempts non-CLI use; production runs MUST be CLI/non-GUI mode
- Higher resource cost per thread than k6/Gatling
- Harder to integrate cleanly with modern CI/CD (verbose output, large artifacts)

**Use when:** legacy enterprise stacks, JDBC/JMS/SOAP testing, regulated environments where mature tooling matters more than developer ergonomics.

**JMeter best practices** (when you must use it):
- Always run non-GUI mode in production: `jmeter -n -t plan.jmx -l results.jtl`
- Use CSV Data Set Config for parameterization, never hardcode
- Use Concurrency Thread Group (plugin) instead of standard Thread Group for arrival-rate models
- Disable View Results Tree and listeners during the test — output to JTL only, render after
- Distributed mode: master coordinates, slaves generate load; never run from a single jmeter on a laptop for serious tests

### Gatling — highest throughput, Scala/Java/Kotlin DSL

**Strengths:**
- Akka-based, async, very high RPS per generator (10× JMeter typical)
- Strong DSL in Scala/Java/Kotlin — code-reviewable test plans
- Beautiful HTML reports out of the box
- Native CI/CD support via Gatling Enterprise

**Limitations:**
- JVM warmup time — not great for smoke tests
- Scala learning curve (Java/Kotlin DSL helps but has fewer examples)
- Smaller community than k6 or JMeter

**Use when:** very high RPS targets (>50k RPS per generator), JVM-heavy organizations, teams comfortable with Scala/Kotlin/Java.

**Gatling key patterns:**
- Use `Injection.constantUsersPerSec(N).during(D)` for open-model load.
- `feeder` is the data source — supports CSV, JSON, JDBC.
- `forAll().on(...)` instead of `forEach` for randomization.
- Always pin checks: `.check(status.is(200))` — without it, errors are silent.

### Locust — Python-native, simple to extend

**Strengths:**
- Pure Python — easy for data/ML teams to write tests
- Distributed mode is straightforward
- Web UI for live monitoring
- Excellent for custom protocols where you write the client

**Limitations:**
- Lower throughput per worker than k6 or Gatling (Python GIL)
- Default closed-model only; open-model needs `LoadTestShape` work
- Web UI is a feature, but production runs should still be `--headless`

**Use when:** Python-heavy organizations, custom protocol clients (SDKs only available in Python), data/ML pipelines that test their own services.

**Locust patterns:**
- Inherit from `HttpUser`; set `wait_time = between(1, 3)`.
- Use `@task(weight)` decorators to model journey distribution.
- For arrival-rate models, implement `LoadTestShape` with `tick()` returning `(target_users, spawn_rate)` over time.
- Run distributed: `locust --master` + N workers `locust --worker --master-host=...`.

### wrk2 — minimum-overhead HTTP benchmarking

**Strengths:**
- C-based, extremely low overhead — single machine can saturate 1Gb+ links
- Constant throughput mode (`-R`) — coordinated-omission-aware
- Lua scripting for request customization

**Limitations:**
- HTTP only
- No assertions / SLO gates — you compute results yourself
- Single-machine focus (no native distributed)

**Use when:** raw HTTP latency benchmarking, comparing infra setups (kernel, NIC, JVM tunings), pre-production smoke at high RPS without infrastructure overhead.

```bash
wrk2 -t 8 -c 100 -d 60s -R 1000 https://api.example.com/health
# 8 threads, 100 connections, 60s, 1000 RPS constant-arrival-rate
```

### Vegeta — Go-based, replay-friendly

**Strengths:**
- Constant rate by default (open-model)
- Plain-text target format — easy to replay from logs
- Pipes well in shell (`vegeta attack | vegeta report`)

**Use when:** replaying captured production traffic shapes, simple HTTP-only benchmarking, Go-comfortable teams.

---

## Multi-tool combinations (common in mature orgs)

A mature performance engineering practice often uses **two or three** tools intentionally:

- **k6 in CI/CD** for every PR (fast, code-reviewable, JSON gate output)
- **JMeter or Gatling** for full enterprise scenarios (multi-protocol, scheduled weekly)
- **wrk2 or Vegeta** for ad-hoc deep-dive on a single hot endpoint
- **k6/browser or Playwright** for Web Vitals and full user journeys

Don't pick one tool and force it everywhere. Each has a sweet spot.

---

## Tools to avoid for serious work

- **ab (Apache Bench)** — single-threaded, no constant-arrival-rate, suffers heavily from coordinated omission. OK for smoke checks of a single endpoint, never for SLO validation.
- **siege** — same issues as ab, plus reporting is weaker.
- **JMeter GUI in production** — only ever for authoring. Run CLI/non-GUI.

---

## Coordinated omission — the universal correctness check

Regardless of tool: if your tool measures latency only when it has capacity to issue the next request, every result is wrong under load. Verify each tool handles this:

| Tool | Coordinated-omission-safe mode |
|------|-------------------------------|
| k6 | `constant-arrival-rate` / `ramping-arrival-rate` |
| JMeter | Concurrency Thread Group (plugin) + Constant Throughput Timer |
| Gatling | `constantUsersPerSec`, `rampUsersPerSec` |
| Locust | `LoadTestShape` with explicit RPS targeting |
| wrk2 | `-R <rate>` flag |
| Vegeta | `-rate <N>` (default behavior) |

If the chosen tool can't be put in this mode, results above ~30% saturation should be treated as suspect.

### Cross-check pattern (catches CO that slipped through)

Even with the right executor, run this cross-check before trusting tail percentiles:

> Compare load-generator-reported P99/P99.9 against server-side histograms (Prometheus, Istio, span-derived). **Large divergence is a coordinated-omission red flag** — usually the load generator is hiding the worst latencies that the server itself recorded.

If the load gen says P99 = 400ms and the server-side histogram says P99 = 1.2s, trust the server side. The load gen is missing samples.

### Related trap — histogram bucket saturation

A subtler measurement lie. If your histogram's highest bucket is `+Inf` (the "overflow" bucket) and **a non-trivial fraction of samples land there**, the P99 / P99.9 computed from that histogram is a **lower bound, not a measurement**:

- The percentile calculation linear-interpolates within the bucket containing the percentile rank.
- If the rank falls in `+Inf`, there's no upper edge to interpolate against — implementations return the lower edge of the bucket, silently truncating the actual tail.
- A SUT that genuinely has P99 = 8s but whose histogram's last finite bucket is at 2s will report P99 ≈ 2s. The 6s of real latency is invisible.

**How to detect:**
- Inspect bucket distribution: if `bucket{le="+Inf"} - bucket{le="<highest-finite>"}` is more than ~0.1% of the total count, the tail is saturated.
- In Prometheus: `histogram_quantile()` returning a value suspiciously close to the highest finite bucket boundary is a red flag.

**How to fix:**
- Add more buckets with higher upper bounds (e.g., extend the schema from `[5ms, 10, 25, 50, 100, 250, 500, 1000, +Inf]` to `[..., 1000, 2500, 5000, 10000, +Inf]`).
- Or migrate to **native histograms** (Prometheus 2.40+) — exponential buckets without fixed schema, no saturation possible by design.

This trap is especially common when comparing metrics across observability stacks (e.g., Istio service-mesh metrics vs APM vs span-derived) — different schemas → different saturation behavior → different reported P99 for the same underlying traffic.
