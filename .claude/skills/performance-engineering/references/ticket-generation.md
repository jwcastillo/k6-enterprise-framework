# Ticket generation

How to convert performance findings into actionable tickets. Works with any tracker (Linear, Jira, GitHub Issues, Azure DevOps, custom Markdown). The principles are the same; the field names change.

---

## Workflow

1. **Inputs**: findings/recommendations from the analysis + (optional) user-provided ticket template + (optional) ticket organization preferences.
2. **If user provided a template**: parse its field structure (Title, Description, Acceptance Criteria, Priority, etc.) and follow it verbatim. Don't add fields the user didn't include; don't drop fields they did.
3. **If no template provided**: use the **default template** below (Linear-compatible).
4. **Generate one ticket per actionable recommendation**, unless the user asked for grouping.
5. **Quantify priority** based on impact + error budget burn + risk, not gut feeling.
6. **Always link evidence**: every ticket must reference the dashboard, trace, profile, or report that proves the problem exists.

If the user has Linear (or another tracker) connected via MCP, offer to create the tickets directly after they review the drafts. Don't create tickets without explicit confirmation.

---

## Default ticket template (Linear-compatible Markdown)

```markdown
**Title**: [Component] [Quantified problem or improvement] — [direction, e.g., "reduce p99 by 60%"]

**Priority**: [Urgent / High / Medium / Low] — [one-sentence reasoning anchored in error budget or business impact]

**Labels**: performance, [component], [type: bug | improvement | tech-debt | observability]

**Estimate**: [team's unit — points or t-shirt size] — [one-sentence reasoning]

**Description**:

## Context
[1-2 sentences: which system, which journey, why this matters now.]

## Evidence
- Dashboard: [Grafana link, time range pinned]
- Trace example: [trace ID + link, with the slow span highlighted]
- Profile: [link to flame graph or attached file]
- Related metric: [PromQL/LogQL query + observed value]

## Current state
- [Metric] is [value], target is [SLO value], gap is [%/x].
- Affected: [users, RPS, journeys].
- Error budget consumed: [%].

## Root cause (hypothesis or confirmed)
[Mechanism, with evidence link. Mark explicitly as "hypothesis" or "confirmed".]

## Proposed fix
[Specific change, file/component if known, alternative options if relevant.]

**Tradeoffs considered**:
- Option A: [approach] — pros / cons
- Option B: [approach] — pros / cons
- Recommendation: [chosen option] because [reasoning].

## Acceptance criteria
- [ ] [Metric] is ≤ [target] sustained over [window] under [load condition].
- [ ] No regression in [related metric] beyond [threshold].
- [ ] Regression test added: [description].
- [ ] Runbook / dashboard updated if behavior class changed.

## Verification plan
- How we'll measure success post-deploy: [specific dashboard / query / test].
- Rollback trigger: [specific metric threshold].

## Out of scope
[Explicit list of related work that is *not* part of this ticket — links to follow-up tickets if applicable.]

## Links
- Source analysis: [link to study/report]
- Related tickets: [links]
- Parent epic / project: [link]
```

---

## Title patterns

Good titles are scannable in a long backlog. Use this shape:

`[Component] Quantified problem — direction of fix`

Examples:
- ✅ `[Checkout API] p99 latency 4.3x SLO due to N+1 in cart enrichment — collapse to single batched query`
- ✅ `[Payment Gateway] Connection pool exhaustion under spike load — increase pool + add backpressure`
- ✅ `[Web App] LCP regressed from 2.1s to 4.8s on mobile — defer hero image preload`
- ❌ `Fix slow checkout` (no component, no quantification, no direction)
- ❌ `Performance issue` (says nothing)

---

## Priority calibration

Tie priority to error budget, not vibes.

| Priority | Trigger |
|----------|---------|
| **Urgent** | SLO is being actively violated; error budget burn rate would exhaust quarterly budget in <7 days; customer escalation in flight. |
| **High** | SLO at risk within 30 days at current burn rate; structural problem that compounds; blocking a launch. |
| **Medium** | SLO not at immediate risk but degradation is real and quantified; improvement that unlocks capacity headroom. |
| **Low** | Cosmetic / nice-to-have; tech debt without measured impact; observability improvement with no current pain. |

Always include the *reasoning*, not just the level. "High — at current burn rate, error budget exhausts in 18 days" is useful. "High — important" is not.

---

## Acceptance criteria — make them measurable

Bad: `Make checkout faster.`
Better: `Reduce p99 latency.`
**Good**: `p99 latency for POST /checkout ≤ 350ms sustained for 24h under production load (>= average daily peak RPS).`

Every acceptance criterion should be:
- **Measurable**: a specific metric, source, threshold, and window.
- **Falsifiable**: someone can definitively say it passed or failed.
- **Tied to a dashboard or test**: name the artifact that will verify it.

Always include a **regression criterion**: "no degradation in [related metric] beyond [threshold]". Performance fixes often shift cost elsewhere.

---

## Estimate guidance

If the team uses **story points** without a calibration anchor, suggest one:
- **1 point**: well-understood, change is localized to one service, no infra coordination needed (e.g., add an index, change a query, raise a config limit).
- **3 points**: change touches 2-3 services or requires a new dashboard/alert; some load testing needed before merge.
- **5 points**: structural — new caching layer, async migration, schema change requiring backfill.
- **8 points**: cross-team work, new component, multi-week with sequencing dependencies.
- **13+**: should be split.

If the team uses **t-shirt sizes**, the same logic maps to S / M / L / XL / XXL.

If the user hasn't told you what unit they use, ask once. Don't invent a unit.

---

## Multi-ticket projects — vertical slices, not horizontal layers

When the analysis produces a multi-ticket optimization project (e.g., a campaign with 8 recommendations spanning DB, app, and frontend), structure the tickets as **vertical slices**, not by layer.

A **vertical slice** (sometimes called a "tracer bullet") is a thin, end-to-end change that delivers measurable improvement on its own. A **horizontal slice** is "do all the DB changes, then all the app changes, then all the frontend changes" — which delivers nothing demonstrable until the very end.

### Rules for vertical slices in a perf project

- Each slice delivers a **narrow but complete path** through every layer needed to move the metric.
- A completed slice is **independently measurable** — you can re-run the campaign or a smoke test and see the SLO improve by some quantified amount.
- Prefer **many thin slices** over few thick ones. Thin slices unblock parallel work, ship sooner, and let the team learn between slices.
- Each slice is independently **revertable** — if one slice degrades a different metric, roll just that one back.

### Example — N+1 + cache + index project

Bad (horizontal slices, blocks demonstrable progress for weeks):

| Issue | Layer |
|-------|-------|
| #1 | Add Redis caching layer infra |
| #2 | Update all services to use new cache |
| #3 | Add all DB indexes |
| #4 | Refactor all N+1 queries |

Good (vertical slices, each delivers measurable improvement):

| Issue | Slice | Expected impact |
|-------|-------|-----------------|
| #1 | Fix N+1 in checkout shipping lookup (single batched query, no infra changes) | p99 checkout: 1.2s → ~700ms |
| #2 | Add covering index on `orders(customer_id, status, created_at)` | Order list p99: 450ms → 180ms |
| #3 | Cache product catalog reads in Redis with 5-min TTL | Catalog p99: 380ms → 80ms |
| #4 | Cache user session reads in Redis with explicit invalidation | Session p99: 200ms → 30ms |
| #5 | Add hedged requests to recommendations dependency | Recs p99: 800ms → 250ms |

Each one is shipable independently. The team can pick up #3 and #5 in parallel. Each is independently measurable. If #4's invalidation is buggy, you only revert #4 — #1, #2, #3, and #5 keep their wins.

### When a slice naturally must be wider

Some changes genuinely span layers (e.g., a schema migration that requires app deploys in a specific order). For these:

- Mark the slice as **HITL** (human-in-the-loop) — requires coordination, not autonomous AFK execution.
- Specify the deploy sequence in the ticket explicitly.
- Note the rollback complexity (often these can't be cleanly rolled back; surface that).
- Document the blocking relationship to upstream/downstream slices.

### Issue field — `Blocked by`

For multi-slice projects, every ticket must have a `Blocked by` field listing which other slices (if any) must complete first. Use issue references, not free text. If nothing blocks: "None — can start immediately."

---

## Adapting to user-provided templates

When the user passes their own template (paste, file, or link), follow this process:

1. **Identify the structure**: extract the field list, required vs optional, the format expected for each field.
2. **Map findings to fields**: most analyses map cleanly:
   - Title → ticket title
   - Context + evidence → description
   - Recommendation → proposed fix or solution
   - Verification metrics → acceptance criteria / DoD
3. **Match the user's tone**: formal corporate templates use complete sentences and headings; lightweight team templates may use bullets and informal language. Match it.
4. **Don't add fields**: if the template has no "Acceptance Criteria" field, don't invent one — fold the criteria into the description or the field that's closest in intent.
5. **Don't drop fields**: if the template has fields you don't have data for, ask the user or mark explicitly `[TBD: ask <person>]`.
6. **Preserve the template's metadata syntax**: Linear uses `priority: 1`, Jira uses `Priority: High`, GitHub uses labels. Match what the user uses.

---

## Example: ticket from a finding

**Finding** (input):
> Diagnosis identified that the checkout service's p99 latency is 1.2s vs SLO of 500ms, caused by an N+1 query loading shipping options for each cart item. ~6.8M users/day affected during peak. Quick fix: batch shipping option lookups into a single query keyed by item IDs.

**Generated ticket** (default template):

```markdown
**Title**: [Checkout Service] p99 latency 2.4x SLO from N+1 shipping option lookup — batch into single query

**Priority**: Urgent — current p99 (1.2s) is 2.4x the 500ms SLO, error budget burn rate exhausts quarterly budget in ~9 days.

**Labels**: performance, checkout, bug, database

**Estimate**: 3 points — change is localized to the cart enrichment service but requires a new batch endpoint on the shipping API and load testing before merge.

**Description**:

## Context
The checkout service's p99 response time has been at 1.2s since [date], against a 500ms SLO. Affects ~6.8M users/day during the 12:00–18:00 UTC peak window.

## Evidence
- Dashboard: [Grafana panel link, time range Apr 22–28]
- Trace example: trace ID `abc123def456` shows 47 sequential `GET /shipping-options/{itemId}` calls totaling 890ms within a single checkout request
- Flame graph: [link] — 73% of on-CPU time in HTTP client serialization for shipping calls
- PromQL: `histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket{service="checkout"}[5m])) by (le))` returns 1.18s

## Current state
- p99 latency: 1.18s, target 500ms (gap: 2.4x)
- Affected: ~6.8M users/day during peak
- Error budget consumed: 67% of monthly budget in 9 days

## Root cause (confirmed)
Cart enrichment loop calls `shipping-options-service` once per cart item. Average cart has 8.3 items; each call takes ~22ms; total ~180ms added to checkout. Root span shows 47 sequential HTTP calls in the worst case (large carts).

## Proposed fix
Introduce a batch endpoint `POST /shipping-options/batch` accepting an array of item IDs, return a map of `itemId → options`. Replace the loop in `CartEnricher.java:142` with a single batched call.

**Tradeoffs considered**:
- Option A: client-side parallelism (no API change) — reduces wall time but doesn't reduce load on shipping service; rejected.
- Option B: batch API (chosen) — requires shipping team coordination but solves both latency and load issues.
- Option C: cache shipping options at edge — orthogonal, separate ticket.

## Acceptance criteria
- [ ] p99 latency for POST /checkout ≤ 400ms sustained for 24h under production load (≥ avg daily peak RPS)
- [ ] Shipping-options-service load reduced by ≥ 80% vs current
- [ ] No regression in checkout error rate (must remain < 0.1%)
- [ ] Regression test added: k6 scenario with 10-item cart asserting p99 < 400ms
- [ ] Grafana dashboard `checkout-service-overview` updated with new SLI

## Verification plan
- Post-deploy: monitor `checkout-service-overview` for 72h
- Rollback trigger: p99 > 700ms for 10 consecutive minutes, OR error rate > 0.5%

## Out of scope
- Edge caching of shipping options — see [follow-up ticket]
- Cart abandonment dashboard — see [follow-up ticket]

## Links
- Source analysis: [link to diagnosis report]
- Parent epic: [Checkout Performance Q2]
```
