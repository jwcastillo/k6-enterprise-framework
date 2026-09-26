# Skill self-maintenance — audit, research, model-change review

How to keep this skill current as the underlying domains evolve. The skill is documentation; the documentation can drift out of date. This reference describes the workflows for **detecting drift and proposing updates** — using the same atomic-commit + user-authorization discipline as the code-review workflow.

---

## Honest framing — what this is and isn't

**This is NOT**: autonomous editing of the skill. The skill does not run by itself, modify files without invocation, or update via background process.

**This IS**: a documented workflow Claude follows when the user invokes a maintenance task. Claude:
1. Reads the current skill content
2. Researches current best practices (web_search + reading authoritative sources)
3. Identifies specific gaps / staleness
4. Proposes updates as a series of commits using `code-review-commit-workflow.md`
5. Requests explicit user authorization for each commit
6. Applies the changes only after approval

The user invokes this with phrases like:
- *"Audit this skill against current best practices"*
- *"What's stale in this skill?"*
- *"Research what's new in <topic> and update the relevant reference"*
- *"We just moved to <new Claude model>, review the model-related content"*
- *"Update the FinOps reference for FinOps Foundation 2027 framework"*

Treat this as a high-value but explicitly-bounded workflow.

---

## Three maintenance modes

### Mode 1 — Periodic audit (staleness detection)

When the user asks for a general audit, scan the skill for known staleness vectors. Produce a report **before** proposing changes. The report categorizes findings; the user decides which to address.

**Audit checklist:**

#### A. Version-specific content

Check each reference for content tied to specific versions, dates, or product names:

- [ ] **Java JEP numbers** in `runtime-perf-tuning.md` — current LTS, deprecation status of mentioned JEPs
- [ ] **JVM distribution coverage** in `java-frameworks-and-distributions.md` — vendor changes, license changes, new distributions
- [ ] **Kubernetes version-specific behavior** in `runtimes-on-kubernetes.md` — Go 1.25 GOMAXPROCS fix referenced; verify current Go version
- [ ] **Anthropic API features** in `llm-perf-and-tokens.md` — prompt caching TTLs, Batch API SLA, model names + tiers, Compact Object Headers status
- [ ] **Tool versions** mentioned anywhere — RTK version, k6 version, Grafana version, Lighthouse version, etc.
- [ ] **Cloud provider features** in `finops-cloud-cost.md` — pricing models, Savings Plans terms, new services
- [ ] **FinOps Framework version** — the State of FinOps report and Framework updates annually
- [ ] **Date-anchored claims** — "as of 2026", current year references

#### B. Link rot

Check that referenced URLs still resolve:

- [ ] All GitHub repos cited in `INTEGRATION-NOTES.md` and README acknowledgments
- [ ] All blog posts and documentation pages referenced
- [ ] FinOps Foundation links (data.finops.org, finops.org/wg/...)
- [ ] Cloud provider doc URLs (these move frequently)

Use `web_fetch` to spot-check the highest-value ones. Full link audit is the user's call — automate via script in `scripts/` if it becomes routine.

#### C. Outdated claims

Watch for content that may no longer hold:

- [ ] Synchronous pinning in Java virtual threads — pre-Java 24 advice. Verify version-aware framing is still accurate as Java 25 / 26 ship.
- [ ] Go GOMAXPROCS issues — Go 1.25+ fixes them. Pre-1.25 advice still valid for legacy fleets.
- [ ] "ZGC is generational by default" — Java 25 reality. Future versions may shift.
- [ ] LLM provider feature flags — prompt caching, Batch API behavior change subtly across versions.

#### D. Missing emerging topics

Watch for gaps the skill doesn't cover but should:

- [ ] New runtime versions (Java 26 LTS pre-release, Node.js 24 LTS, Go 1.26, Python 3.14)
- [ ] New deployment patterns (e.g., a new mesh, new GitOps tool gaining momentum)
- [ ] New observability primitives (e.g., OpenTelemetry semantic convention updates)
- [ ] New benchmark / load test tools achieving meaningful adoption
- [ ] New AI/LLM optimization patterns

#### E. Internal consistency

Check that updates to one reference haven't created inconsistency with others:

- [ ] Does `expert-profiles.md` list every reference that exists?
- [ ] Are all profiles in the catalog table in SKILL.md also in `expert-profiles.md`?
- [ ] Do cross-references between files resolve (e.g., "see `bottleneck-patterns.md`")?
- [ ] Does `examples/sample-engagement-acme-corp/` still reflect the current SKILL.md modes table?

### Audit output format

```markdown
# Skill audit — <date>

## Summary

- N findings total
- M categorized as **stale** (content is wrong now)
- K categorized as **gap** (something missing)
- L categorized as **link rot** (URLs not resolving)
- J categorized as **inconsistency** (cross-file mismatch)

## Findings

### [STALE] <topic>
**Location**: `references/<file>.md` lines X-Y
**Current content**: <quote>
**Issue**: <what's wrong now>
**Source**: <how I verified — search query, URL>
**Proposed update**: <high-level direction; full diff comes in Mode 2 if user approves>

### [GAP] <topic>
**Where it should go**: `references/<file>.md` or new file
**Why**: <evidence of importance — adoption, recent reference in user's domain, etc.>
**Source**: <citations>

### [LINK ROT] <URL>
**Location**: `references/<file>.md`
**Status**: 404 / redirect / dead
**Replacement candidate**: <new URL>

### [INCONSISTENCY] <topic>
**File A says**: <quote>
**File B says**: <quote>
**Resolution**: <which is right; which should change>

## Recommended next steps

1. Address [STALE] findings — these may produce wrong advice
2. Address [LINK ROT] — credibility issue
3. Consider [GAP] findings — strategic addition
4. Address [INCONSISTENCY] — pick a side, propagate
```

Present this to the user. Ask which findings to address. **Do not proceed to make changes without explicit approval of which findings to act on.**

---

### Mode 2 — Research and propose updates

When the user identifies a topic (or approves a finding from Mode 1) and asks to research + draft updates:

#### Step 1 — Establish scope

Confirm with the user:
- Which reference(s) to modify
- What level of update (typo fix vs subsection rewrite vs new section)
- What sources are authoritative for this topic

Don't guess scope. A "small update" can balloon if the topic has changed substantially.

#### Step 2 — Research

Use `web_search` and `web_fetch` to gather current information:

```
1. Identify 3-5 authoritative sources (official docs, primary research, recognized experts)
2. Verify currency (publication / last-updated date)
3. Cross-check claims across sources — multiple-source confirmation for non-obvious claims
4. Note any contested or evolving positions — don't pretend certainty where the field has none
```

**Source preference hierarchy** for this skill's topics:

| Topic | Top sources |
|-------|-------------|
| Java / JVM | OpenJDK JEPs, Inside.java, JEP announcements, Brian Goetz / Stuart Marks / Cay Horstmann |
| Kubernetes | kubernetes.io official docs, CNCF blog, k8s SIG announcements |
| Anthropic API | docs.claude.com, Anthropic engineering blog |
| Cloud providers | Official AWS/Azure/GCP docs, re:Invent / Ignite / Cloud Next announcements |
| FinOps | finops.org Working Group papers, State of FinOps reports |
| LLM patterns | OpenAI / Anthropic / Google blog posts; arXiv for novel techniques |
| Observability | OpenTelemetry spec, Grafana Labs / Datadog / Honeycomb blogs |
| Load testing | Tool vendors' docs (k6, JMeter, Gatling); Brendan Gregg / Gil Tene for methodology |
| Performance methodology | USE / RED / Golden Signals canonical sources; Brendan Gregg's site |

#### Step 3 — Draft

Write the proposed update **in the same voice, format, and structure** as the existing skill content:

- Tables for comparison content
- Code blocks for examples
- "Honest scope notes" section if the topic has limits
- Concrete numbers where possible (cite source for each)
- No bluffing on specifics ("approximately 30%" is fine; "exactly 30%" needs a source)
- Cross-references to other parts of the skill where relevant

#### Step 4 — Propose as commit(s)

Use the workflow from `code-review-commit-workflow.md`:

For each proposed change:
1. Show file + line range
2. Show diff
3. Explain what changed and why
4. Show proposed commit message (Conventional Commits format with `docs:` or `refactor:` prefix for skill updates)
5. Ask for approval

**Commit message templates for skill maintenance:**

```
docs(<reference>): update for <topic> (current as of <date>)

The previous content reflected <old state>. Current state per
<source> is <new state>.

Sources:
- <URL 1>
- <URL 2>

Refs: skill-audit-<date>
```

```
docs(<reference>): add coverage of <new topic>

<New topic> has emerged as relevant for <profile/use case>. Added
section under <location> covering:
- <point 1>
- <point 2>

Sources:
- <URL 1>

Refs: skill-audit-<date>
```

```
fix(<reference>): correct outdated claim about <topic>

Previously asserted <wrong claim>. Verified against <source>; correct
position is <right claim>.

Refs: skill-audit-<date>
```

#### Step 5 — Validate

After applying changes, run the skill validation:

```bash
python -m scripts.quick_validate /path/to/skill
```

Update `CHANGELOG.md` with a new minor or patch version entry.

---

### Mode 3 — Model-upgrade review

When the user signals a Claude model change ("we're moving to Claude Opus 5.0", "new Sonnet released", "Haiku 5.0 is out"), review skill content tied to model selection:

#### Affected sections

- `SKILL.md` Step 0 mentions specific model names (Opus 4.7, Sonnet 4.6, Haiku 4.5)
- `references/agent-team-orchestration.md` — model tier mapping by role
- `references/llm-perf-and-tokens.md` — current model snapshot, two-stage pipeline examples
- `references/expert-profiles.md` — `llm-perf` profile triggers may need updating

#### Review steps

1. **Read Anthropic release notes** for the new model — context window changes, pricing changes, capability changes
2. **Update model name references** throughout the skill (the names propagate to several files)
3. **Re-evaluate tier mapping**: does the new model shift the tier definitions? (e.g., if Sonnet 5.0 is significantly faster/cheaper, is it still "Mid" or does it absorb some "Light" workloads?)
4. **Update two-stage pipeline examples** with current model recommendations
5. **Check pricing assumptions** in `llm-perf-and-tokens.md` — Batch API discount, prompt caching ratios — verify still accurate
6. **Add changelog entry** noting the model update and what changed

The model-change review is typically small (a handful of files, a dozen edits) but high-leverage — wrong model recommendations propagate to every engagement.

---

## What makes a skill update worth adopting

Not every potential change is worth making. Apply this filter:

| Criterion | Adopt | Skip |
|-----------|-------|------|
| **Materially changes recommendations** | Yes | No |
| **Specific factual claim is wrong** | Yes | No |
| **Adoption-level: now widely used** | Yes | Niche only |
| **Source quality: official / recognized expert** | Higher confidence adoption | Lower confidence — flag uncertainty |
| **Stability: established for ≥6 months** | Yes | Wait if churning |
| **Breaks something else in the skill** | Carefully reconcile | Skip if no good resolution |

**Anti-pattern**: "this new tool exists, let me add a paragraph." Without adoption evidence + concrete value-add, additions inflate the skill without improving outcomes.

**Pro pattern**: "this previous claim is now wrong, here's what's correct, here's the source." Corrections > additions.

---

## Workflow for the user

The expected interaction:

**User**: *"Audit this skill. What's stale?"*

**Claude** (with this skill active):
1. Reads `references/expert-profiles.md` to know the catalog
2. Reads `SKILL.md` for current modes / structure
3. Spot-checks 3-5 references most likely to have drifted (`llm-perf-and-tokens.md`, `runtime-perf-tuning.md`, `finops-cloud-cost.md` — high-evolution topics)
4. Uses `web_search` for the topics with newest movement (Java releases, Anthropic features, Kubernetes versions, FinOps Foundation framework)
5. Produces the audit report in the format above
6. Asks user which findings to address

**User**: *"Address findings 1, 3, and 5"*

**Claude**:
1. For each finding, executes the research-and-propose workflow (Mode 2)
2. Shows each proposed commit one at a time, asks for approval
3. After all commits, validates the skill structure
4. Updates `CHANGELOG.md`
5. Offers to repackage the skill

---

## Frequency recommendations

| Maintenance | Frequency | Trigger |
|-------------|-----------|---------|
| Periodic full audit | Quarterly | Calendar — schedule it |
| Topic-specific research | As-needed | New release announced in user's stack (Java LTS, K8s minor, etc.) |
| Model-upgrade review | Per new Anthropic model | Anthropic announces new model |
| Link rot check | Annually | Calendar — easy to defer; do it |
| Internal consistency check | After any large addition | Before packaging a new version |
| Major framework changes | As-needed | State of FinOps annual report, OpenTelemetry semconv major update, etc. |

---

## Quality gates for proposed updates

Before approving any proposed update, verify:

- [ ] **Source citation** — every non-trivial claim has a source
- [ ] **Currency** — the source is current (within 6 months for fast-moving topics, 12+ for stable ones)
- [ ] **Cross-source confirmation** for surprising claims
- [ ] **Doesn't break other references** — cross-reference still valid
- [ ] **Voice consistency** — reads like the rest of the skill (imperative, concrete, honest about scope)
- [ ] **No bluffing on specifics** — exact numbers cited; ranges or "approximately" when uncertain
- [ ] **Honest scope notes** added if the new content has limits

If a proposed update fails any of these, push back. The skill's credibility is its value; sloppy updates erode it faster than gaps.

---

## Tools that may help

| Tool | Purpose |
|------|---------|
| `web_search` | Research current state of any topic |
| `web_fetch` | Pull full content from authoritative source for accurate quoting |
| `view` (skill files) | Read current skill content for audit |
| `str_replace`, `create_file` | Apply proposed updates |
| `bash_tool` for `python -m scripts.quick_validate` | Verify skill structure |
| `bash_tool` for `python -m scripts.package_skill` | Repackage after updates |
| Future scripts in `scripts/` | Automate routine audit tasks (link checking, JEP citation verification, etc.) |

---

## What this skill does not auto-update

Important boundaries:

- **No autonomous edits** — every change requires user authorization
- **No git push** — repackaging happens locally, user decides distribution
- **No version bump without user consent** — semantic versioning decisions are user calls
- **No license changes** without explicit user instruction
- **No edits to `INTEGRATION-NOTES.md`** without documenting *why* — that file is the transparency record

---

## When to retire content vs update it

Some content becomes obsolete in a way that update can't fix. Examples:

- A tool the skill recommended has been deprecated or abandoned
- A library cited as best-practice has known security issues unaddressed for > 1 year
- A pattern the skill described is now considered an anti-pattern by the community
- A vendor whose product is documented has exited the market

For obsolete content:

1. Don't silently delete — confusing to anyone who saw the previous version
2. Replace with brief note in INTEGRATION-NOTES.md or CHANGELOG.md: "Removed coverage of X — deprecated by community circa <date>"
3. Add a replacement recommendation where one exists
4. Add the deprecation to the audit report so it's tracked

---

## Honest scope notes

- **Not a substitute for original expertise** — this maintenance workflow keeps the skill current, but the strategic direction (what topics matter, what to deprecate, what to add) requires human judgment
- **Web search has limits** — paywalls, blog drift, contested claims. Triangulate; if you can't, say so in the proposed update
- **Sources go stale too** — the authoritative sources today may not be tomorrow. Re-evaluate the source hierarchy in `Step 2 — Research` periodically
- **Model-change reviews are mostly mechanical** — but watch for capability shifts that change recommendations qualitatively (e.g., if Haiku gains coding ability comparable to Sonnet, the two-stage pipeline patterns need rethink)
- **Avoid update churn** — small frequent updates lose more value (cognitive load, version proliferation) than they add. Batch updates into versioned releases.
