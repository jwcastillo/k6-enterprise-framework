# Performance Engagement Brief — Acme Corp checkout, 2026-05-12

> Sample artifact — fictional client. Style/format reference.

## Scope

Diagnose and remediate the p99 latency regression in Acme Corp's `checkout-service`. Current p99 = 1,180ms; target = < 500ms sustained for 14 consecutive days. Scope is limited to the checkout request flow (cart → payment → confirmation) and its direct dependencies (Aurora, Redis, Stripe, PDF Maker, ShipEngine).

**Out of scope**: payment gateway migration, frontend Web Vitals, multi-region expansion, broader e-commerce platform refactor.

## Stakeholders

| Role | Person | Decisions they own | Cadence |
|------|--------|--------------------|---------|
| Exec sponsor | VP Engineering, Acme Corp | Scope, budget, "go" / "no-go" on architectural changes | Weekly digest, ad-hoc escalations |
| Engineering lead (client) | Sarah Chen, Acme | Technical sign-off on changes, code review approval | Daily standup, async Slack |
| Platform/SRE lead (client) | Marcus Reyes, Acme | Resource limits, Istio config, observability changes | Weekly sync |
| PE consultant lead (Globant) | Jose | Engagement plan, technical recommendations | Daily standup |
| Globant PM | Carolina Pérez | Stakeholder comms, scope changes, deliverable acceptance | Weekly digest |

## Success criteria

Primary SLO sentence:

> **"Min 1,000 txns/s with ≤ 500 ms at p99 on current Aurora db.r6g.2xlarge primary."**

- Primary: p99 < 500ms sustained for 14 consecutive days, validated by k6 campaign at 1,000 RPS hitting all critical paths
- Secondary: p99.9 < 1500ms (currently 4,200ms — gap closure is a stretch goal)
- Secondary: SLO error budget burn rate < 1.0× sustained (currently 3.2×, exhausting in 9 days)

## Constraints

- **Budget**: 5 sprints × 80h = 400h Globant; client team 0.4 FTE allocated
- **Timeline**: 2026-05-15 start, 2026-06-19 end (3 weeks active + 2 weeks soak/validation)
- **Freeze windows**: 2026-06-15 → 2026-06-30 (Black Friday prep blackout) — all production changes paused
- **Compliance**: PCI DSS — payment-handling code changes require PCI-trained reviewer (Carolina has SLA 24h)
- **No PII out of prod VPC**: all log analysis stays inside the customer's environment
- **No infra cost increase > 15%** without VP Engineering approval (current monthly spend: $42k/mo on EKS + Aurora)

## Initial risk register

| # | Risk | Probability | Impact | Mitigation owner |
|---|------|-------------|--------|------------------|
| 1 | PDF Maker bottleneck cannot be fully addressed in scope | High | Medium | TL — propose async PDF generation as out-of-scope follow-up |
| 2 | Aurora replica lag during write spikes causes read-after-write inconsistency | Medium | High | SRE — propose read-from-primary for checkout reads |
| 3 | k6 staging environment data cardinality doesn't match prod | High | Medium | SRE — request anonymized prod sample; deadline week 1 |
| 4 | Stripe API external latency contributes ≥ 200ms p99 | Medium | High | TL — measure exact contribution; if confirmed, scope reduction conversation |
| 5 | Compact Object Headers (Java 25 JEP 519) incompatible with current ZGC setup | Low | Low | Engineer — already on G1, but document for future Java 25 migration |

## Sprint zero deliverables (week 1)

- [ ] This Engagement Brief — sign-off by EOW
- [ ] Context document update (already drafted; see `context-document.md`)
- [ ] Baseline measurement campaign: 1-hour soak test at production traffic shape, k6 against staging with anonymized data
- [ ] Initial backlog: 5-8 vertical-slice tickets drafted by TL, prioritized by impact × confidence ÷ effort × risk
- [ ] Standup cadence + Slack channel + weekly digest schedule established

## Communication plan

- **Daily standup**: 09:00 EST, 15 min, async-first in Slack `#checkout-perf-engagement` for written, sync if needed
- **Weekly digest to exec sponsor**: Friday 14:00 EST, 1-page format (use `references/deliverable-templates.md`)
- **Slack channel**: `#checkout-perf-engagement` (mixed client + Globant)
- **Escalation path**: Scrum Master → Tech Lead → Globant PM → VP Engineering (Acme)
- **Mid-engagement review**: end of sprint 2, 30-min call with exec sponsor, deliverable: progress digest + ask for any scope adjustments

## Methodology declaration

This engagement will use:
- **Top-Down Performance Analysis** (Beckwith) as the primary diagnostic framework — start at the application SLO (p99 < 500ms), drill down through stack layers
- **USE method** (Gregg) for infrastructure layer triage
- **RED method** (Wilkie) for service-level dashboards

Explicit methodology naming protects scope from drift and is defensible to stakeholders.
