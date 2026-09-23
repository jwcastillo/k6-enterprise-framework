# Sample tickets — Acme Corp checkout perf engagement

> Sample artifacts. Three vertical-slice tickets generated from the diagnosis. Linear-compatible format. Each slice ships independently and moves p99 measurably.

---

## ACME-1240: Batch shipping rate lookup in CartEnricher

### What to build

Refactor `CartEnricher.java:142` to batch shipping-rate lookups across all cart items into a single ShipEngine API call instead of one per item. The current implementation does N sequential calls for an N-item cart.

### Acceptance criteria

- [ ] `CartEnricher.enrichShippingRates()` accepts the full cart and returns a Map<itemId, ShippingRate> from a single ShipEngine batch call
- [ ] Unit test verifies single API call regardless of cart size
- [ ] Integration test against ShipEngine sandbox passes with 1-item, 5-item, and 25-item carts
- [ ] Regression test: k6 scenario `checkout-with-25-items` passes p99 < 600ms threshold (was 1,800ms baseline)
- [ ] Code review by client TL (Sarah Chen) — PCI scope unchanged so no PCI reviewer needed
- [ ] Deployed to staging, observed 1 hour with no error rate regression
- [ ] Deployed to canary (5% traffic), observed 24h with stable p99 improvement
- [ ] Full rollout

### Expected impact

- p99 (checkout end-to-end): 1,180ms → ~700ms (480ms savings, 41% improvement)
- p99 for 25-item carts: 1,800ms → ~600ms (1,200ms savings, 67% improvement)

### Blocked by

None — can start immediately.

### Estimate

3 points (~2 dev days)

### Verification plan

```
k6 scenario: checkout-with-25-items.js, constant-arrival-rate 50/s, 5 min
Compare baseline (main branch) vs PR branch
Threshold: p99 < 600ms on PR branch, baseline at 1,800ms
```

### Rollback criteria

If p99 regresses on canary > 5% or error rate > 0.5%, revert and re-diagnose. Rollback is a single deployment.

---

## ACME-1241: Cache product catalog reads with Redis (5-min TTL, jittered)

### What to build

Add Redis caching layer for product catalog reads in `ProductCatalogService.fetchProducts()`. Currently every cart enrichment hits Postgres for product data; product catalog changes < 10× / day.

### Acceptance criteria

- [ ] Cache-aside pattern: read from Redis first, fall back to Postgres on miss, populate Redis on success
- [ ] TTL: 5 minutes base + 0-60s jitter (prevents cache stampede on synchronized expiry)
- [ ] Cache invalidation hook in `ProductCatalogAdminService.updateProduct()` — invalidates affected keys on write
- [ ] Singleflight pattern: only one Postgres query for a given product ID even if 100 concurrent requests miss simultaneously
- [ ] Metrics: cache hit rate, cache miss rate, cache stampede prevention rate exposed via Actuator
- [ ] Regression test: k6 scenario `checkout-baseline` passes p99 < 600ms with cache hit rate > 90%
- [ ] Documentation update in runbook: how to manually invalidate cache, how to read hit-rate metrics

### Expected impact

- p99 (catalog fetch sub-stage): 380ms → 75ms (305ms savings)
- p99 (checkout end-to-end): combined with ACME-1240, expected ~400-450ms
- Aurora read replica load: estimated 60% reduction during peak

### Blocked by

ACME-1240 (ships first — independent improvements compound cleanly when ordered)

### Estimate

5 points (~3.5 dev days)

### Verification plan

```
k6 scenario: checkout-baseline.js, ramping-arrival-rate 100→500 RPS over 15 min
Compare canary (5% traffic) vs main fleet over 24h
Threshold: p99 < 500ms on canary, hit rate > 90% post-warmup (skip first 5 min)
```

### Rollback criteria

If cache hit rate < 80% sustained (suggests invalidation bug), or if any read returns stale data (verified via DB diff job), revert. Feature-flagged so rollback is config change, not redeploy.

---

## ACME-1242: Hedged requests for ShipEngine rate lookups

### What to build

Add hedged-request pattern to ShipEngine API calls — if the primary request hasn't completed in 200ms, send a parallel duplicate and use whichever returns first. Cancel the slower one on completion of the faster.

### Acceptance criteria

- [ ] `ShipEngineClient.fetchRates()` uses hedged request via custom `HedgedHttpClient` wrapper
- [ ] Hedge threshold: 200ms (configurable via `application.yml`)
- [ ] Maximum 2 in-flight requests per logical call (no unbounded escalation)
- [ ] Metrics: hedge-fired rate, hedge-won rate, dropped-duplicate rate exposed via Actuator
- [ ] Smoke test: regression scenario passes p99 < 500ms with hedge enabled
- [ ] Cost-impact check: ShipEngine API spend projected increase < 10% (acceptable per finance)

### Expected impact

- p99.9 (ShipEngine call): 1,800ms → ~500ms (tail latency capped by hedge)
- p99 (checkout end-to-end): minor (already at ~400ms post ACME-1240/1241); p99.9 is the target

### Blocked by

ACME-1241 (ordering decision: independent improvements ship sequentially to isolate impact)

### Estimate

8 points (~5.5 dev days — includes new HedgedHttpClient utility class for reuse)

### Verification plan

```
k6 scenario: checkout-tail-latency.js, constant-arrival-rate 200/s, 30 min soak
Measure p99.9 on ShipEngine sub-stage
Threshold: p99.9 < 600ms (was 1,800ms baseline)
```

### Rollback criteria

If hedge-fired rate > 30% sustained (suggests systemic ShipEngine slowness, not tail spikes), revert and re-investigate root cause upstream. Feature-flagged.

---

## Notes for the engineering team

These three tickets are **vertical slices**, not horizontal layers. Each one:
- Ships independently
- Moves a specific metric (with explicit baseline → target numbers)
- Is independently revertable (canary first, then full rollout)
- Has explicit success criteria and rollback criteria

The order matters — ACME-1240 first because it's the cheapest (lowest effort, highest confidence in impact). ACME-1241 second because its impact is cleaner to attribute once ACME-1240 ships. ACME-1242 last because it targets p99.9, which only matters when p99 is already under control.

This is the "vertical slice / tracer bullet" pattern from `references/ticket-generation.md`.
