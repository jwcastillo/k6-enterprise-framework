# Deliverable templates

Use these templates when producing formal performance engineering deliverables. Adapt content but keep the structure.

---

## Executive 1-pager

```markdown
# [System/Service] Performance — [Date]

**Headline (quantified):** [e.g., "Checkout p99 latency degraded 4.3x (280ms → 1.2s) over the last 14 days, exposing ~$X/day in revenue at risk and consuming 67% of the quarterly error budget."]

## Findings (top 3)
1. [Finding with magnitude and source of evidence]
2. [Finding with magnitude and source of evidence]
3. [Finding with magnitude and source of evidence]

## Recommendations
1. [Action] — [expected impact, effort, owner, ETA]
2. [Action] — [expected impact, effort, owner, ETA]
3. [Action] — [expected impact, effort, owner, ETA]

## Decision requested
[The one explicit decision the executive needs to make.]

## Single chart
[Insert one high-impact chart — typically the SLO trendline with the regression highlighted, or a percentile distribution before/after.]
```

**Rules**: one page max. No jargon. No more than three of anything. The headline must be quantified — if you can't quantify, you don't have a headline yet.

---

## Technical diagnosis (Tech Lead / Staff)

```markdown
# [Issue] — Technical diagnosis

## Symptom
[Observable behavior. Include: when it started, who/what is affected, magnitude in percentiles.]

## Hypotheses considered
| # | Hypothesis | Status | Evidence |
|---|-----------|--------|----------|
| 1 | ... | Refuted | [link to chart/trace] |
| 2 | ... | Confirmed | [link to chart/trace] |
| 3 | ... | Partial | [link to chart/trace] |

## Root cause
[Specific cause with mechanism explained. Include the flame graph / trace / profile that proves it.]

## Quantified impact
- Users affected: [count or %]
- Latency degradation: p50 [old → new], p99 [old → new], p99.9 [old → new]
- Error budget consumed: [%]
- Estimated business impact: [$ or qualitative if numbers unavailable]

## Proposed fixes (ranked)
| Option | Approach | Impact | Effort | Risk | Tradeoffs |
|--------|----------|--------|--------|------|-----------|
| A | ... | High | Days | Low | ... |
| B | ... | High | Weeks | Medium | ... |
| C | ... | Structural | Quarters | High | ... |

## Verification plan
- Success criteria: [specific metric thresholds]
- Rollback trigger: [specific metric thresholds]
- Monitoring: [dashboards / alerts to watch]

## Appendix
- Queries used (PromQL / LogQL / SQL)
- Trace IDs investigated
- Profile artifacts
```

---

## Performance testing campaign report

```markdown
# [Campaign name] — Performance Test Report

## 1. Executive summary
[One paragraph + SLO compliance table.]

| SLO | Target | Observed | Status |
|-----|--------|----------|--------|
| Checkout p99 | < 500ms | 412ms | ✅ |
| Login p95 | < 300ms | 380ms | ❌ |
| Error rate | < 0.1% | 0.04% | ✅ |

## 2. Scope
- **Endpoints / journeys tested**: [list]
- **Scenarios**: smoke / average / stress / spike / soak / breakpoint — which ones and why
- **Load model**: ramp profile, peak concurrent users, peak RPS, think-time distribution
- **Test window**: [date/time, duration]
- **Tooling**: [k6 / Gatling / JMeter version + relevant config]
- **Environment**: [parity vs production — explicit list of differences]
- **Data**: [synthetic / anonymized prod / cardinality match]

## 3. Results per scenario

For each scenario:

### [Scenario name]

**Load profile**: [VUs / RPS over time — chart]

**Latency distribution**:
| Percentile | Endpoint A | Endpoint B | ... |
|------------|-----------|-----------|-----|
| p50 | ... | ... | |
| p95 | ... | ... | |
| p99 | ... | ... | |
| p99.9 | ... | ... | |

**Throughput**: sustained RPS achieved
**Error rate**: % and breakdown by error class
**Resource saturation** (USE method): CPU, memory, disk I/O, network, lock contention

## 4. Bottleneck identified

[Component, mechanism, evidence — saturation chart + trace + profile]

## 5. Capacity headroom

- System tolerates **[N] additional RPS** before SLO degradation.
- Margin against expected peak: **[%]**
- First component to saturate beyond current capacity: [name]

## 6. Risks and assumptions

- [Assumption made about prod behavior that was approximated in test]
- [Risk that wasn't fully tested]
- [Coordinated omission status]
- [Cache state during test]

## 7. Recommendations (prioritized)

| # | Recommendation | Impact | Effort | Risk | Owner |
|---|----------------|--------|--------|------|-------|
| 1 | ... | ... | ... | ... | ... |

## 8. Appendix
- Test scripts (link)
- Raw result artifacts (link)
- Grafana dashboards consulted (links with time range)
- Re-run instructions
```
