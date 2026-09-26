---
name: results-analysis
description: Analyze k6 run artifacts produced by this framework — summary JSON, analysis and comparison markdown, metrics CSV, k6 log, JUnit — using the deterministic tools first (compare-results, compare.sh / k6-compare, trend-analysis, slo-report, generated anomaly analysis) and optional failure triage, without introducing numbers that are not in the artifacts. Use when asked to "analyze the last run of <scenario>", "compare this run against the baseline", "is there a regression", "why did the thresholds fail", or "who owns these errors". Not for building the client deliverable (performance-report) or for running tests (run-operations).
---

# Results analysis

`<repo>` means the repository root.

## Deterministic-first rule

Every number you state (latency, rate, error %, VUs, RPS, deltas) must be copied from
an artifact or from the output of a deterministic tool below, with its source path.
LLM narrative may explain and prioritise; it must not compute, round differently,
extrapolate, or introduce numbers absent from the artifacts. If a number is missing,
say "not measured".

## Artifact map (one run)

Directory: `reports/<client>/<scenario_with_underscores>/` (standalone:
`reports/<scenario>/`). Files are `<type>-YYYYMMDD-HHMMSS.<ext>`:

| Type | Content | Read for |
|------|---------|----------|
| `summary` (json) | k6 summary export + framework enrichment | All metrics and threshold pass/fail |
| `analysis` (md) | Deterministic analysis incl. anomaly flags | Findings list |
| `comparison` (md) | Auto-comparison vs previous runs | Regressions |
| `metrics` (csv) | Flat metric table | Tables, spreadsheets |
| `k6-execution` (log) | Raw k6 log | Errors, warnings |
| `junit` (xml) | One testcase per threshold/check | CI view |
| `message` (md) | Short status message | Chat/status update |
| `triage` (txt) | Failure owner classification (only if triage ran) | Error ownership |
| `html-report` (html) | Offline dashboard | Humans |

Always check the run's exit code first (see run-operations): 99 means thresholds failed
on a valid run; 107/1 means the numbers may be meaningless.

## Tools

```bash
# Baseline vs current (deltas; --threshold=<pct> for tolerance)
node <repo>/bin/compare-results.js --baseline=<summary.json> --current=<summary.json>

# Regression gate with k6-compare when available (exit 0 ok, 3 regression,
# 5 load-model mismatch, 1 error), falls back to compare-results
<repo>/bin/compare.sh <baseline.json> <current.json>

# Trend across runs of one scenario
node <repo>/bin/trend-analysis.js --client=<c> --test=<scenario-slug> [--limit=20]

# Monthly SLO compliance
node <repo>/bin/slo-report.js --client=<c> --month=<YYYY-MM> [--format=json]
```

Exit 5 from k6-compare means the two runs used different load models (open vs closed):
do not compare them; report the mismatch.

## Triage of failures

When `TYPESAFE_API_KEY` is set (see jev-typesafe), classify error lines into owner
(system under test / test / environment):

```bash
node <repo>/bin/triage-failures.js <k6-execution log>
```

Signatures are redacted before leaving the machine; add `TRIAGE_REDACT=<terms>` for
extra names. Answers below the confidence threshold are marked "(review)": treat them
as unknown. Without the key the tool does nothing; say triage was not run.

## Reading order

1. Exit code and threshold results in the summary.
2. Error rate and error types (log, triage).
3. Latency percentiles per `name` tag / group; compare p95 and p99, not averages.
4. Throughput achieved vs intended (open-model runs: dropped iterations).
5. Comparison / trend: only against runs with the same profile and load model.
6. Correlate with server-side telemetry when available (observability-setup, promql).

## Output

```
RUN: <path to summary json>  exit=<code>
VERDICT: PASS | FAIL (thresholds) | INVALID (script/env error)
KEY NUMBERS: <metric>=<value> (source: <file>)
REGRESSIONS: <metric> <baseline> -> <current> (source: <tool output>)
TRIAGE: <owner shares or "not run">
OPEN QUESTIONS: <what the data cannot answer>
```
