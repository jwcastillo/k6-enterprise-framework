# Long-form deliverable templates

For research-style studies, external white papers, and performance-focused post-mortems. Use when the user explicitly asks for in-depth, formal documents — not for routine reporting (use `deliverable-templates.md` for those).

Long-form deliverables should usually be created as a file (`.md` or `.docx`), not inline in the chat. Confirm format with the user; default to Markdown unless they ask for Word.

---

## Performance Study (research-style internal document)

Use when: the team wants a rigorous, defensible analysis that others can reproduce and challenge. Typical length: 8-20 pages.

```markdown
# [Study title — specific, falsifiable, no marketing language]

**Authors**: [names + roles]
**Date**: [YYYY-MM-DD]
**Status**: Draft / Reviewed / Final
**Reproducibility artifacts**: [link to scripts, raw data, dashboards]

---

## Abstract (≤ 200 words)

One paragraph covering: question, method, key finding (quantified), and the decision the study informs. No surprises later — if the abstract says "we found X", the conclusions section must too.

## 1. Background and motivation

Why this study now. What decision depends on it. Prior baselines and what changed. Cite previous studies or incident postmortems if relevant.

## 2. Research question

State as a falsifiable claim or a precise question:
- ✅ "Does enabling HTTP/3 on the edge reduce p99 TTFB by ≥ 15% for mobile clients in emerging markets?"
- ❌ "How can we improve performance?"

Define metrics precisely:
- Metric name
- Source (which exporter, which dashboard)
- Aggregation (percentile, window, group-by)
- What "improvement" means quantitatively

## 3. Hypotheses

List competing hypotheses *before* presenting results. Each should make a different prediction.

| H | Statement | Prediction if true | Prediction if false |
|---|-----------|-------------------|---------------------|

## 4. Methodology

### 4.1 Test environment
- Hardware / instances / replicas
- Network topology
- Differences from production (be exhaustive)

### 4.2 Tooling
- Load generator (tool, version, config)
- Observability stack
- Profilers used

### 4.3 Load model
- Scenarios run, ramp profile, duration
- Concurrency model (closed/open, constant-arrival-rate)
- Coordinated-omission handling

### 4.4 Data
- Synthetic / anonymized prod / replay
- Cardinality match with production
- Cache state at scenario start

### 4.5 Metrics collected
- List with source and aggregation
- How tail metrics (p99, p99.9) were computed (HdrHistogram, t-digest, native histogram)

### 4.6 Statistical approach
- Number of repetitions
- How variance was characterized (stddev, IQR, CI)
- How significance was assessed (Mann-Whitney U, KS, etc. for non-parametric distributions)
- How outliers were handled (and why)

## 5. Results

### 5.1 Per-scenario findings

For each scenario:
- Latency distribution (table + histogram)
- Throughput sustained
- Error rate and breakdown
- Resource saturation (USE method)

Use tables and embed charts (or reference figures by name).

### 5.2 Aggregate analysis
- Comparison vs hypothesis predictions
- Statistical significance of observed differences

## 6. Discussion

### 6.1 Bottleneck mechanism
What was actually limiting throughput / inflating latency, with evidence (flame graph, trace, metric).

### 6.2 Scaling behavior
Does the system follow Amdahl's Law, USL, or something else? At what point does adding capacity stop helping?

### 6.3 Comparison with prior baselines or industry benchmarks
Where applicable.

### 6.4 Threats to validity
- Internal: test design biases, instrumentation noise, sample size
- External: how representative is the test of production
- Construct: are we measuring what we claim

## 7. Conclusions

State which hypotheses were supported, which refuted, and which inconclusive. Don't overreach.

## 8. Recommendations

Ranked by (impact × confidence) ÷ (effort × risk). Each with: action, expected impact, effort, risk, owner, ETA.

## 9. Limitations

Be explicit about what this study does not answer.

## 10. References

Citations to internal docs, papers, and prior studies.

## Appendix A — Reproducibility instructions

Step-by-step to re-run. Include script versions, parameter files, dataset versions.

## Appendix B — Raw data

Or pointer to where raw data lives.

## Appendix C — Detailed traces and profiles

Embedded or linked.
```

---

## White Paper (external / strategic)

Use when: positioning your team's capability for a client, publishing externally, or producing a strategic internal document for executives. Typical length: 6-15 pages. Tone: assertive, well-cited, polished prose (not bullet-heavy).

```markdown
# [Compelling, specific title — usually 6-10 words]

**[Subtitle that quantifies or sharpens the angle]**

By [Author/Team] · [Date]

---

## Executive summary

3-4 paragraphs. The headline finding or thesis. Who should care and why. What this paper argues.

## The problem (or opportunity)

Frame the issue. Use one quantified anecdote or scenario to make it concrete. Keep paragraphs tight — this is prose, not a slide deck.

## Industry context

Where the industry is on this issue. Cite analyst reports, public benchmarks, public incidents if relevant. Avoid name-dropping vendors unless it's load-bearing for the argument.

## Our approach / thesis

Lay out the position. This is the meat of the paper. Use:
- 2-4 subsections, each anchored by a clear claim
- Diagrams to externalize complex relationships
- Concrete examples — preferably with numbers

## Methodology summary

If the paper is grounded in measurement, briefly describe how (full detail goes in appendix or a separate study). If it's a position paper without measurement, skip this and acknowledge it openly.

## Key findings (or principles)

Number them. Each with a one-sentence headline + 1-2 paragraphs of evidence and explanation.

## Strategic implications

What should the reader do differently after reading this? Distinguish:
- Implications for engineering leaders
- Implications for product
- Implications for executives

## Recommendations

Concrete, prioritized actions. Be specific enough that someone could start tomorrow.

## About the authors / team

Brief bios establishing credibility.

## References

Numbered, with links. Mix of academic, industry, and primary source.

## Appendix (optional)

Methodology detail, raw data, or extended technical sections.
```

---

## Performance-focused Post-mortem

Use when: there was an incident with a performance dimension and the team needs a learning-oriented document. Blameless. Length: 4-8 pages.

```markdown
# Post-mortem: [Service/feature] — [Date of incident]

**Severity**: [SEV1-4 with definition]
**Duration**: [start → mitigated → resolved, with timezone]
**Customer impact**: [users affected, transactions affected, revenue impact, error budget consumed]
**Authors**: [incident commander, on-call, contributors]
**Status**: Draft / Reviewed / Closed

## Summary

3-5 sentences. What happened, why, how we found out, how we fixed it.

## Impact

Quantified. By time, by user count, by revenue, by SLO consumed.

| Metric | Pre-incident | At peak impact | Post-recovery |
|--------|--------------|----------------|---------------|
| p99 latency | | | |
| Error rate | | | |
| Throughput | | | |

## Timeline (UTC unless noted)

| Time | Event | Source |
|------|-------|--------|
| T-2h | Deploy of v1.42 | CI |
| T+0 | First customer complaint | Support |
| T+4m | Alert fired: p99 > 800ms | PagerDuty |
| T+12m | IC engaged | Slack |
| T+34m | Root cause hypothesized | Trace analysis |
| T+47m | Mitigation applied (rollback) | Deploy log |
| T+52m | Metrics recovered | Grafana |

## Root cause

Mechanism, not narrative. What technically went wrong, with evidence (trace ID, flame graph, query plan, config diff).

## Detection

How was it detected and how long did it take? Was that fast enough? If not, what alert is missing?

## Mitigation

What was done to stop the bleed (rollback, kill switch, capacity increase, traffic shift). How long it took.

## Why did it take this long?

Honest assessment of detection time, diagnosis time, and mitigation time. Each gap is a learning opportunity.

## Contributing factors

Beyond the proximate cause:
- Why didn't tests catch this?
- Why did the alert fire late / not at all?
- Was there organizational context (deploy pressure, missing runbook, on-call gap)?

## What went well

Genuine positives. Don't make this performative.

## What didn't go well

Specifics. Blameless but unflinching.

## Action items

| # | Action | Type | Owner | ETA | Ticket |
|---|--------|------|-------|-----|--------|
| 1 | Add p99 alert at 600ms threshold | Detect | | | |
| 2 | Add regression test for [scenario] | Prevent | | | |
| 3 | Document rollback runbook | Respond | | | |

Tag each as **Prevent / Detect / Respond / Mitigate** so the action set is balanced.

## Lessons learned

3-5 takeaways framed as patterns the org should internalize, not as accusations.
```
