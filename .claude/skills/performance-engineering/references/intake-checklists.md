# Intake checklists

Use these as a menu of artifact-specific asks, not as a script. Pick the 3-5 items most decision-relevant for the user's task. Always ask for *artifacts* (charts, traces, files), not just verbal descriptions.

When the user shares images, analyze axis labels, time windows, percentile curves, and visual artifacts (clipping, missing data, suspicious aggregation).

---

## Diagnosis (incident, regression, slowness)

**Symptom & scope**
- When did it start? (timestamp, time zone — this matters for change correlation)
- Who reports it / how was it detected? (user reports, alerting, dashboard, SLO burn)
- Which endpoints, journeys, or operations are affected?
- What % of traffic / users are affected?
- Is it constant, intermittent, or only at peak?

**Quantified baseline**
- Pre-regression p50, p95, p99, p99.9 (request the histogram if available, not just the percentiles)
- Current p50, p95, p99, p99.9
- Throughput (RPS) before vs now
- Error rate before vs now

**Artifacts to request**
- Grafana / Datadog / Dynatrace panel screenshot covering at least 24h before and 24h after the regression onset
- 1-2 slow trace IDs from the affected endpoint (Jaeger / Tempo / Datadog APM / Honeycomb)
- Flame graph from the affected process during the regression window (async-profiler, pprof, py-spy, perf)
- Application logs around the onset (with correlation IDs if available)

**Recent changes (the highest-yield question in 90% of incidents)**
- Deployments in the last 14 days for the affected service and its direct dependencies
- Config / feature-flag changes
- Traffic pattern shifts (new client, marketing campaign, geographic shift)
- Infrastructure changes (k8s upgrade, node pool change, DB version, network policy)

**Constraints**
- Is rollback feasible? Window?
- Blast radius if we change something now
- Is there a freeze in effect

---

## Design (preventive, architectural, pre-launch)

**Target & rationale**
- Target SLO: latency percentiles + availability + error budget
- Why this target? (user research, competitive benchmark, business commitment)
- What happens if we miss it by 2x? By 10x?

**Scale**
- Expected peak RPS / concurrent users
- Steady-state RPS
- Peak-to-trough ratio
- Growth trajectory (12-month projection)
- Data volume: rows, GB, cardinality

**Stack constraints**
- Languages and runtimes
- Datastores (and version, replication topology)
- Messaging (Kafka, SQS, RabbitMQ, etc.)
- Cloud / on-prem / hybrid
- Existing systems to integrate with

**Non-functional constraints**
- Budget (cost ceiling per RPS or per transaction)
- Compliance / regulatory (data residency, encryption, audit)
- Operational (on-call coverage, deploy cadence)

**Artifacts to request**
- Existing architecture diagram (or your sketch)
- Sample of the data model
- Traffic profile if any history exists (RPS by hour, journey distribution)

---

## Performance testing campaign

**Scope**
- Endpoints and journeys to cover (be explicit — "checkout flow" is too vague; need the actual sequence)
- SLOs to validate against
- Out-of-scope explicitly listed

**Production traffic profile**
- Peak RPS, average RPS
- Think-time distribution (real users have variable pauses; bots don't)
- Geographic distribution
- Authenticated vs anonymous mix
- Mobile vs web vs API mix

**Test environment**
- Parity with production: hardware, replicas, datastore size, network topology
- Differences must be enumerated
- Cache state at start (cold, warm, pre-populated)
- Test data: synthetic, anonymized prod, prod replay

**Tooling**
- Preferred tool (k6 unless reason to differ)
- CI/CD integration needed?
- Result storage (Grafana, k6 Cloud, custom)

**Risk window**
- When can we run it? (off-hours, maintenance window)
- Who needs to be on standby

**Success criteria**
- SLO compliance thresholds
- Capacity headroom target (e.g., system must handle 2x peak before SLO breach)

---

## Analysis of existing data (the user already has data, wants interpretation)

**The data**
- Charts, exports, dashboards, traces — request the actual artifacts
- Time window of interest, with timezone
- What was different about that window vs a baseline window

**Hypotheses already on the table**
- What does the team already think is happening? (so you can validate or refute, not duplicate)
- What have they already ruled out, with what evidence?

**Decision being made**
- What action depends on this analysis?
- Who is the audience for the conclusion?

---

## Study or paper

**Question being answered**
- One-sentence research question
- Why does it matter (decision, publication, internal alignment)

**Audience and venue**
- Internal engineering, internal exec, external customers, conference, industry publication
- Length expectation
- Citations / formality level

**Existing material**
- Prior studies, prior measurements, related literature
- Constraints on what data can be shared externally

**Reproducibility expectation**
- Is this a one-shot study or must others be able to re-run it?
- Where will scripts and data live

---

## Ticket generation

**Findings input**
- The analysis or recommendations to convert (or pointer to a previous turn)
- Severity / priority signal: what's broken vs what's an improvement

**Template**
- Does the user have a ticket template? (Linear, Jira, GitHub Issues, internal custom)
- If yes — request a sample or the field structure
- If no — confirm default template is OK

**Ticket organization preferences**
- One ticket per recommendation, or grouped by theme?
- Parent epic / project to link under
- Labels / tags conventions
- Assignee logic (round-robin, by component owner, leave unassigned)

**Estimate guidance**
- Does the team use story points, t-shirt sizes, hours?
- Calibration anchors (what's a 1-pointer, what's a 5-pointer)
