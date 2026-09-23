# Context document — Acme Corp checkout service

> **Note**: this is a **fictional sample** for skill calibration. Acme Corp does not exist. Details are realistic but invented. Use as a template / style reference when producing real context documents.

## System overview

**Service**: `checkout-service` — the synchronous purchase flow for Acme Corp's B2C e-commerce platform.

**Stack**:
- Java 21 (Eclipse Temurin)
- Spring Boot 3.2 with virtual threads enabled (`spring.threads.virtual.enabled=true`)
- PostgreSQL 15 (Aurora, primary + 2 read replicas)
- Redis 7 (ElastiCache, cluster mode disabled, single primary + 2 replicas)
- Stripe API (payments), ShipEngine API (shipping rates), Avalara (tax)

**Runtime topology**:
- EKS cluster, region us-east-1
- 12 pods, `cpu: 2, memory: 4Gi` per pod (Burstable QoS)
- Horizontal Pod Autoscaler, target CPU 60%, min 8 / max 30 pods
- Istio 1.20 service mesh with mTLS strict
- Application Load Balancer → Istio ingress gateway → service

**Traffic profile**:
- Steady state: ~150 RPS
- Daily peak (US Eastern lunch): ~450 RPS
- Weekly peak (Sunday evening): ~700 RPS
- BFCM peak (historical): ~3,500 RPS — requires planned scale-out

## SLOs

Primary SLO sentence (engagement target):

> "Min 1,000 txns/s with ≤ 500 ms at p99 on current Aurora db.r6g.2xlarge primary."

| SLI | Target | Window | Current state |
|-----|--------|--------|---------------|
| Checkout p99 latency | < 500ms | 28-day rolling | ⚠️ Currently 1,180ms — primary engagement target |
| Checkout p99.9 latency | < 1500ms | 28-day rolling | ❌ Currently 4,200ms |
| Availability | 99.95% | 28-day rolling | ✅ Currently 99.98% |
| Error rate (5xx) | < 0.5% | 5m | ✅ Currently 0.12% |

## Known issues (do not re-diagnose)

1. **N+1 in cart enrichment** — `CartEnricher.java:142` queries shipping rates per item instead of batching. Documented in ticket ACME-1234. Fix in progress, ETA next sprint.
2. **PDF Maker service is the historical bottleneck for checkout receipt flow** — separate service, runs on smaller pods, capped at ~17 TPS in production. Synchronous call from checkout. Discussed in ADR-007.
3. **Stripe webhook callbacks occasionally cause p99 spikes** when retry storms hit. Stripe-side issue; mitigated with circuit breaker in `stripe-client` module since v3.4.0.

## ADRs (constraints)

- **ADR-005**: Synchronous payment confirmation (no async via webhook). Required for legal hold-and-capture flow. Cannot change without legal sign-off.
- **ADR-007**: PDF Maker service stays as a separate deployment (separate scaling, separate failure domain). Do not propose merging back into checkout.
- **ADR-012**: All inter-service communication through Istio with mTLS. Adds ~1-2ms per hop p99; this is acceptable cost of compliance posture.

## Available diagnostic tools

- **Grafana** (URL: `grafana.acme.internal`) — connected via Grafana MCP server; data sources: Prometheus (Mimir), Loki, Tempo, Faro RUM
- **Dynatrace** (URL: `acme.dynatrace.com`) — APM with code-level profiling; read-only access via web UI (no MCP integration)
- **AWS Console** — limited (read-only on RDS, full on EKS workloads)
- **Linear** — connected via Linear MCP server; project `Checkout Performance` for ticket creation
- **GitHub** — repo `acme/checkout-service` accessible; PRs OK; merge needs reviewer approval
- **Slack** — `#checkout-perf-engagement` channel for sync comms
- **Stripe Dashboard** — read-only access; useful for debugging payment-related latency
- **k6 Cloud** — Globant team account; load test runs against staging environment

## Access boundaries

- Read-only on production Aurora (no schema changes; query analysis via `EXPLAIN` allowed)
- Read-only on production Redis (no `FLUSH*` commands)
- Cannot modify pod resource limits without SRE team approval
- All Istio config changes require Platform team review (24h SLA)
- Cannot expose new public endpoints (security review required, 1-week SLA)
- No PII may leave the production VPC

## Glossary

- **PDF Maker** — internal service for receipt generation, not a public product name
- **Cart Enricher** — `CartEnricher.java` class that hydrates cart items with shipping + tax estimates
- **Lock-and-capture** — Stripe payment flow that holds funds at checkout and captures on shipment

## Engagement-specific context

- **Engagement window**: 2026-05-15 → 2026-06-19 (3 sprints, 5 weeks)
- **Primary stakeholders**:
  - **Exec sponsor**: VP Engineering, Acme Corp
  - **Tech Lead**: Sarah Chen (Acme), reports on technical sign-off
  - **Engineering lead from Globant**: Jose (you)
- **Comm cadence**: weekly digest to exec sponsor (Friday), daily Slack standup, ad-hoc as needed
- **Out of scope (explicit)**: payment gateway migration, frontend Web Vitals, multi-region expansion. All deferred to subsequent engagements.

## Profile activation hint for Claude

When working from this context, activate: **`spring-boot` + `java-k8s` + `observability` + `engagement-mode`**

(The skill should detect this from the stack signals, but if it doesn't, the user can activate explicitly.)
