# Checkout Performance — Week 2 digest

> Sample artifact for executive reporting. Format: 1 page, scannable in 60 seconds.

**Engagement**: Acme Corp checkout p99 reduction | **Sprint**: 2 of 5 | **Date**: 2026-05-26

## Headline

p99 latency down 41% (1,180ms → 700ms) after ACME-1240 deploy. On track for the < 500ms target by sprint 4.

## What shipped this week

| # | Change | Impact | Status |
|---|--------|--------|--------|
| ACME-1240 | Batch ShipEngine API calls in CartEnricher | p99 1,180ms → 700ms (−41%) | ✅ Deployed prod, stable 48h |
| ACME-1241 | Redis cache for product catalog | (in progress) | 🟡 Canary, 5% traffic |

## Key metrics

| Metric | Baseline | Last week | This week | Target |
|--------|----------|-----------|-----------|--------|
| Checkout p99 | 1,180ms | 1,180ms | **700ms** | < 500ms |
| Checkout p99.9 | 4,200ms | 4,200ms | 3,800ms | < 1,500ms |
| Error budget burn rate | 3.2× | 3.2× | **1.4×** | < 1.0× |
| Aurora replica CPU | 78% | 78% | 71% | < 70% |

## What's next

- **ACME-1241** (Redis catalog cache): full rollout Monday, expected to bring p99 to ~400-450ms
- **ACME-1242** (hedged ShipEngine requests): targets p99.9; sprint 3 work, ETA next Friday
- **Sprint 3 planning**: Monday 09:00 EST

## Risks

- 🟡 **PDF Maker bottleneck**: out-of-scope but worth flagging. Even with all current tickets, ~10% of requests will hit PDF Maker p99 of ~3s. Recommend follow-up engagement to convert PDF generation to async post-checkout (decoupled from purchase confirmation).
- 🟢 **Staging data cardinality**: resolved this week. Anonymized prod sample now in staging Aurora; k6 results now match prod shape.

## Ask of leadership

None this week. Continuing per plan.

---

**Prepared by**: PE team | **Channel**: `#checkout-perf-engagement` | **Next digest**: 2026-06-02
