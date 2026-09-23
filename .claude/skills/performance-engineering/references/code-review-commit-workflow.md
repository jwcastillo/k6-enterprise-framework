# Code review for performance — atomic commit workflow

How to review code for performance issues and ship the findings as **individual, well-documented commits** with explicit user authorization at every step. Use when the user shares code (a file, a PR, a repo path) and asks for perf review, or when an engagement reaches the "fix the findings" phase.

This combines the diagnostic discipline of `bottleneck-patterns.md` with the vertical-slice ticket discipline of `ticket-generation.md`, applied at the commit level.

---

## The workflow loop

```
1. Read code → identify perf issues
2. Group issues by independence (vertical slices — can each be shipped alone)
3. Order by ROI: lowest-effort + highest-impact first
4. For each issue, in order:
   a. Show the user: WHAT is the issue, WHERE is it, WHY it matters
   b. Show the proposed diff
   c. Show the expected impact (numbers, not adjectives)
   d. Show the proposed commit message (Conventional Commits format)
   e. Ask: approve / reject / modify
   f. After approval: stage + commit
   g. Move to next issue (do NOT batch commits without re-asking)
5. After all commits: show summary, ask about push / PR
```

**Critical**: every commit is its own authorization checkpoint. The user can:
- **Approve** → make the commit
- **Reject** → skip this issue (drop it from the plan)
- **Modify** → adjust the diff or message, then re-show, re-ask
- **Pause** → stop here, resume later

Never batch multiple commits under a single "approve all" gate. Each commit is a separate decision.

---

## Step 1 — Identify perf issues

Use the diagnostic patterns from `bottleneck-patterns.md` adapted to static code review. The signal-to-noise checklist below covers the perf-relevant smells that show up in a code review:

### Universal perf smells (any language)

- [ ] **N+1 queries** — loop containing a DB call. Especially common in ORM code (Hibernate, ActiveRecord, Sequelize, Django ORM, SQLAlchemy)
- [ ] **Synchronous I/O on a hot path** — blocking external calls without timeout / async
- [ ] **Missing timeouts** — any HTTP / DB / cache call without an explicit timeout (default `Infinity` is unsafe)
- [ ] **Unbounded retries** — retry loops without exponential backoff or max attempts
- [ ] **Cache without invalidation strategy** — cache writes with no plan for stale data
- [ ] **Allocation in hot loops** — object/string creation inside a tight loop (especially in GC'd languages)
- [ ] **String concatenation in loops** — use builders / format strings / array+join
- [ ] **Unindexed query columns** — `WHERE`, `JOIN`, `ORDER BY` on columns without indices
- [ ] **`SELECT *`** — fetches more columns than needed; especially bad with BLOB/TEXT columns
- [ ] **Repeated computation** — same expensive call in multiple places that could be memoized
- [ ] **Synchronous logging** in hot paths — async logger, or buffered, or sample
- [ ] **Reflection / dynamic dispatch in hot loops** — cache resolved Method/Field references
- [ ] **Eager loading where lazy would suffice** (or vice versa — both are bugs)
- [ ] **Connection pool too small** for the workload concurrency
- [ ] **No connection pool** (creating connections per request)
- [ ] **Resource leak risk** — file handles, DB connections, listeners not closed; no `try-with-resources` / `defer` / `finally`
- [ ] **Missing pagination** on list endpoints — full table dump
- [ ] **Large response payloads** with no compression, no field filtering
- [ ] **Inefficient algorithms** — O(n²) where O(n log n) is feasible

### Language-specific smells

**Java / JVM:**
- [ ] `synchronized` block on a virtual thread (pre-Java 24 only; see `runtime-perf-tuning.md`)
- [ ] `String.intern()` on user input — String table fills, eventual OOM
- [ ] `Optional` chains where simple null check is clearer + cheaper
- [ ] Anonymous inner classes capturing `this` unnecessarily — memory leak risk
- [ ] `Stream` for trivial operations where a simple for-loop is faster + clearer

**Node.js:**
- [ ] Blocking the event loop with sync I/O (`readFileSync` in a request handler)
- [ ] `for await` over an array when `Promise.all` would parallelize
- [ ] CPU-bound work without `worker_threads`
- [ ] Express middleware without `next()` — request hangs
- [ ] Memory leaks via closures capturing large objects

**Go:**
- [ ] Goroutine leaks (started, never terminated, no cleanup signal)
- [ ] Channel buffer = 0 when buffering would prevent goroutine pile-up
- [ ] Mutex held across I/O operations
- [ ] `defer` in a tight loop (allocates on each iteration)
- [ ] Escape to heap via interface boxing in hot paths

**Python:**
- [ ] Sync I/O in `async def` (defeats asyncio purpose)
- [ ] `pandas.iterrows()` instead of vectorized operations
- [ ] List comprehensions over generators when items aren't all needed
- [ ] Global state mutation across threads (GIL doesn't help with race conditions, just with corruption)
- [ ] String concatenation with `+` instead of `''.join()`

### Output of Step 1

A **ranked list** of issues, each with:
- Location (file:line range)
- Type (which smell from above)
- Estimated impact (high / medium / low) — based on hot-path likelihood
- Estimated effort (S / M / L)
- Dependencies on other issues (which must ship first)

Show the user this list **before** drafting any diffs. Let them re-prioritize, drop items, or add ones you missed.

---

## Step 2 — Group into vertical slices

Each commit must be:
- **Independent** — could be reverted without breaking other commits
- **Coherent** — addresses one perf concern, not a grab-bag
- **Measurable** — has a specific metric impact (or explicit rationale if pre-emptive)

**Anti-patterns to avoid in slicing:**
- Mixing perf fix with unrelated refactor in same commit
- Splitting one logical fix across two commits because "I want to commit half now"
- Bundling 5 small perf fixes into one commit because they're each "tiny"

Each commit's diff should answer "what is this perf change?" without needing context from other commits.

---

## Step 3 — Order by ROI

Process commits in this order:

1. **Cheapest + highest confidence first** — wins build credibility
2. **Independent improvements** before dependent ones
3. **Reversible** before semi-reversible
4. **Local refactors** before architectural changes
5. **The single biggest win** if it's blocking everything else (sometimes you must do the hard thing first)

For each commit, the priority score (from `runtime-perf-tuning.md`):

```
score = (frequency × blast_radius × expected_gain) / (risk × effort)
```

Surface the score in the user-facing plan. Lets them adjust ordering with confidence.

---

## Step 4 — Per-commit authorization protocol

For each commit, the message to the user follows this template:

```markdown
## Commit N of M: <perf:|refactor:|fix:> short subject

**File**: `path/to/file.ext` (lines X-Y)
**Issue**: <one-line description of the perf problem>

**Why it matters under load**:
<concrete explanation: rate × cost per call × who feels it. Numbers if known.>

**Proposed diff**:
```diff
- old code
+ new code
```

**Expected impact**:
- <metric>: <baseline> → <expected> (<%>)
- <other metric if applicable>

**Proposed commit message**:
```
perf(scope): subject under 72 chars in imperative mood

Body explaining what changed and why, wrapped at 72 chars per line.
Reference the perf problem, the fix approach, and any measurement
that justifies the change.

Before: <baseline metric>
After:  <expected or measured metric>

Refs: <ticket if applicable>
```

**Risk**: <what could go wrong; rollback plan>

**Approve this commit?** [yes / no / modify the diff / modify the message]
```

Wait for explicit `yes` (or `sí`, `approve`, `apruébalo`, `dale`, etc.) before running git.

---

## Conventional Commits for performance work

Use [Conventional Commits](https://www.conventionalcommits.org/) format. Type prefix rules for perf engineering:

| Type | When |
|------|------|
| `perf:` | Code change improves performance — measured or strongly expected gain |
| `refactor:` | Restructuring with no behavior change; sometimes precursor to perf change |
| `fix:` | Performance regression being fixed |
| `feat:` | A perf-relevant feature added (e.g., new caching layer); use sparingly for perf work |
| `test:` | Added or modified perf test (k6 scenario, JMH benchmark) |
| `docs:` | Documentation for perf decisions (ADR, runbook update) |
| `chore:` | Build / dependency / tooling change with perf relevance (e.g., Java version bump for JIT improvements) |

**Scope** is optional but useful: `perf(checkout):`, `perf(db):`, `perf(jvm):`.

### Subject line discipline (the first line)

- **≤ 72 characters total** including type + scope + colon + subject
- **Imperative mood**: "add index", not "added index" or "adds index"
- **No period at the end**
- **Lowercase first word after the colon** (except proper nouns)
- **Describe what, briefly** — not why; that goes in the body

**Examples (good):**
```
perf(checkout): batch ShipEngine rate lookups
perf(db): add composite index on orders(user_id, created_at)
perf(cache): introduce Redis cache for product catalog reads
perf(jvm): enable Compact Object Headers
refactor(orders): extract repository pattern to enable lazy loading
fix(events): remove unbounded retry loop in webhook handler
```

**Examples (bad):**
```
Fixed it.                                              # too vague
perf: I made the checkout faster by adding caching     # too long, first-person
PERF: ADD INDEX                                        # caps abuse
perf(db): adds an index on the orders table.          # tense + period
```

### Body — what, why, and measurement

After the subject, leave one blank line, then the body. Body should answer:

1. **What changed** (a sentence or two)
2. **Why it matters** (the perf problem this addresses)
3. **Measurement** (baseline vs result, or expected if not yet measured)
4. **Trade-offs** (if any — cost increase, complexity, breaking changes)

```
perf(checkout): batch ShipEngine rate lookups

CartEnricher.enrichShippingRates was calling the ShipEngine API once
per cart item. For a 25-item cart this resulted in 25 sequential
network calls, dominating checkout p99.

Refactored to issue a single batch request with all item IDs, parsing
the response into a Map<itemId, Rate>.

Before: p99 1,800ms (25-item cart)
After:  p99 600ms   (25-item cart, expected based on similar batch fix
                     in shippping-quotes service)

The batch endpoint has been available in ShipEngine API v3 since 2024;
no provider-side change required.

Refs: ACME-1240
```

### Footer — refs and metadata

- `Refs: ACME-1240` — link to ticket
- `Co-authored-by: Name <email>` — pair / mob coding
- `BREAKING CHANGE: description` — if applicable
- `Reviewed-by: Name <email>` — only if you actually have approvals

---

## Commit message templates by change type

### N+1 query fix

```
perf(<service>): batch <resource> fetches in <method>

<Method> was issuing N <resource> queries when N could be served by a
single batched call. Replaced with <batch_method>.

Before: N+1 queries, ~<N>×<query_ms>ms total under load
After:  1 query, ~<query_ms>ms total

Verified via <test or measurement reference>.

Refs: <ticket>
```

### Index addition

```
perf(db): add <index_type> index on <table>(<columns>)

The <query> query was performing a sequential scan on <table> due to
no index on <column>. Under <load_condition>, this contributed
<latency>ms p99 to <endpoint>.

EXPLAIN ANALYZE before:
  Seq Scan on <table>  (cost=... rows=<N> width=<W>)
EXPLAIN ANALYZE after:
  Index Scan using <new_index>  (cost=... rows=<N> width=<W>)

Index size: ~<MB>MB. Negligible impact on write throughput per our
benchmarks (1.2% slowdown on bulk inserts; acceptable).

Refs: <ticket>
```

### Cache introduction

```
perf(cache): cache <resource> reads in Redis with <TTL> TTL

<Resource> reads were hitting the database on every request despite
the data changing < N×/day. Introduced cache-aside pattern with
<TTL> base TTL + jitter to prevent stampede on synchronized expiry.

Invalidation: <strategy — e.g., explicit invalidation in admin service
on writes; OR TTL-only, accepting <max_stale_seconds>s staleness>.

Before: <DB queries per second / latency contribution>
After:  <expected hit rate, latency at cache>

Trade-off: <max_stale_seconds>s of staleness accepted on writes. Audit
trail confirms this is within product tolerance (<reference>).

Refs: <ticket>
```

### Async conversion (sync → async)

```
perf(<scope>): convert <operation> to async

<Operation> was synchronous and blocked the <event loop / virtual
thread carrier / request thread> for ~<ms>ms per call. Converted
to async/await with <library> to free the thread for other work.

Before: <p99 latency under load> / <throughput limit>
After:  <expected p99 / throughput>

Note: the API contract is unchanged. Callers see the same return
type; the implementation just doesn't block under the hood.

Refs: <ticket>
```

### Algorithm improvement

```
perf(<scope>): replace O(N²) <operation> with O(N log N) algorithm

<Operation> in <function> used a nested loop for <task>. For <N>
typical input size, this is O(<N²>) = ~<ops> operations. Replaced
with <better_algorithm>, reducing to O(<N log N>).

Before: <ms or ops> for N=<typical>; <ms> for N=<peak>
After:  <ms> for N=<typical>; <ms> for N=<peak>

The new algorithm uses <data_structure / approach>. Memory overhead
~<MB>MB negligible at our scale.

Refs: <ticket>
```

### JVM / GC tuning

```
perf(jvm): tune <flag> for <reason>

The application was experiencing <symptom — e.g., long Full GC pauses,
high heap usage>. Investigation via <GC log analysis / JFR> showed
<root cause>.

Changed:
- <flag1>: <before> → <after>
- <flag2>: <before> → <after>

Before: <metric — pause time, throughput, etc.>
After:  <expected or measured>

Aligned with the systematic JVM tuning methodology: <which step / which
principle from runtime-perf-tuning.md>.

Refs: <ticket>
```

### Resource limit / pool sizing

```
perf(infra): increase <resource> from <before> to <after>

Under load testing at <RPS>, <resource> was the limiting factor.
<Evidence — pool exhaustion, OOM, timeout cascade>.

Sized via <formula / measurement>:
  <calculation>

Before: <limit>, saturating at <load>
After:  <new limit>, headroom to <load>

Cost impact: ~$<delta>/month at current usage; reviewed and approved.

Refs: <ticket>
```

---

## Authorization checkpoints — the hard rules

Beyond per-commit approval, these are non-negotiable:

### Never do without explicit per-instance authorization

- `git push` — even to a personal branch
- `git push --force` (or `--force-with-lease`) — even if "safer"
- `git merge` — onto any branch, especially main
- `git rebase` — destructive history rewrite
- `git reset --hard` — discards work
- Creating a PR (via `gh pr create` or equivalent)
- Tagging / releasing
- Deploying anything
- Modifying production config or data

### Always do

- Show the full plan before any git operation
- Show each commit's diff and message before staging
- Show each commit's result after creation (`git log -1`)
- Show the summary at the end (`git log <first>..<last> --oneline`)
- Offer rollback instructions for each commit

### Pre-flight checklist before starting any commit work

- [ ] Confirm git status is clean (no uncommitted changes that would be swept in)
- [ ] Confirm correct branch (`git branch --show-current`)
- [ ] Confirm user knows what branch they want commits on
- [ ] If a new branch should be created (`perf/<area>-<change>`), ask
- [ ] If commits should be signed (`-S`), confirm signing is set up

---

## Multi-commit projects

For an engagement with many perf fixes, structure as a perf-focused PR with multiple commits:

### Branch convention

```
perf/<area>-<short-description>

Examples:
  perf/checkout-n-plus-one
  perf/jvm-gc-tuning
  perf/redis-caching-layer
```

### PR description template

```markdown
## Performance improvements: <area>

### Summary

Addresses the p99 latency regression in <area>, currently <baseline>,
target <goal>.

### Commits in this PR

1. `perf(...): ...` — <one-line impact>
2. `perf(...): ...` — <one-line impact>
3. `perf(...): ...` — <one-line impact>

Each commit is independently revertable (see rollback section below).

### Verification

Load test scenario: <k6 / JMeter scenario file>
Pre-deploy run: <baseline numbers>
Post-deploy run: <expected after each commit>

### Rollback

Each commit can be reverted independently:
```bash
git revert <sha1>          # rollback commit 1 only
git revert <sha2>          # rollback commit 2 only
```

If multiple commits need rollback, revert in **reverse order** to
minimize merge conflicts.

### Risk register

| Commit | Risk | Mitigation |
|--------|------|-----------|
| 1 | <risk> | <mitigation> |
| 2 | <risk> | <mitigation> |
```

---

## Feature flags for risky changes

Some perf changes benefit from feature-flag rollout instead of all-or-nothing deployment:

| Change type | Feature flag? |
|-------------|---------------|
| Cache introduction | Yes — toggle off if invalidation bug appears |
| Algorithm replacement | Yes — A/B compare or rollback fast |
| Hedged requests (parallel duplicate) | Yes — kill switch for cost runaway |
| Query plan changes via hint | Yes — DB behavior can surprise |
| Connection pool size increase | Usually no (low risk, config change) |
| Index addition | No (additive, low risk) |
| Async conversion (preserves API) | Maybe — if downstream sees timing differences |

When using a flag, commit message should mention it:

```
perf(checkout): cache product catalog reads (feature-flag: redis_cache_v1)

[...rest of message...]

Rollout plan: enable in canary (5% traffic) for 24h, then full.
Flag definition: in feature-flags repo, key `redis_cache_v1`,
default `false` in prod, `true` in staging.

Refs: <ticket>
```

---

## Code review checklist — perf-relevant red flags

When invited to review a PR (not write commits), use this fast-scan checklist:

- [ ] **New loop with DB / API call inside it** — N+1 candidate
- [ ] **Missing timeout** on a new HTTP/DB/cache call
- [ ] **Retry loop without max attempts or backoff**
- [ ] **New cache without invalidation discussion**
- [ ] **Allocation inside a hot loop** — string concat, new object per iteration
- [ ] **`synchronized` or mutex held across I/O**
- [ ] **Sync I/O on an async / event-loop path**
- [ ] **New query without confirming index** — ask reviewer to share `EXPLAIN`
- [ ] **`SELECT *` or fetching all columns**
- [ ] **No pagination on a list endpoint**
- [ ] **Unbounded resource (list, queue, cache)**
- [ ] **No measurement** — PR claims perf improvement but shows no numbers
- [ ] **Mixing concerns** — perf fix bundled with unrelated refactor
- [ ] **Commits not atomic** — multiple unrelated changes in one commit

Use as a **fast scan**, then dive deeper on whatever pattern hits.

---

## When the user just wants the review, no commits

Sometimes the user wants a perf review without ever touching git. Honor that:

1. Skip the per-commit authorization protocol entirely
2. Deliver findings in a structured doc (use `references/deliverable-templates.md` short-form technical diagnosis template)
3. Each finding still gets: location, why, fix, expected impact, risk
4. End with a prioritized action list, but no commits

The user can take the list and implement themselves, or come back later for the commit workflow.

---

## Honest scope notes

- **Git-centric** — this workflow assumes git. For Mercurial / SVN / Perforce, the principles transfer; the exact commands don't.
- **Single-author flow** — pairing / mob / trunk-based dev have additional considerations (commit squashing, rebase discipline) not covered here.
- **No auto-merge or auto-push** — ever, even with user permission. Those are infrastructure-level actions that need separate approval rituals.
- **Not a tutorial on git** — assumes the user can read a diff, knows what a commit is. If they can't, slow down and check before proceeding.
