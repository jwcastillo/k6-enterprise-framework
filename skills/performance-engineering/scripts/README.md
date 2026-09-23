# scripts/ — executable code for deterministic tasks

This directory is for **executable code** that the skill can invoke for deterministic, repetitive, or computationally heavy tasks. Currently empty (the skill ships as documentation-first), but the structure is here for future tooling.

## What goes here

Scripts that automate specific perf engineering tasks where deterministic execution beats LLM reasoning:

| Future script candidate | Purpose |
|-------------------------|---------|
| `validate_promql.py` | Parse and validate a PromQL query, catch common bugs (missing `rate()` wrapper on counters, label mismatches, histogram quantile pitfalls) |
| `k6_from_openapi.py` | Generate a k6 scenario from an OpenAPI spec with sensible defaults (constant-arrival-rate executor, percentile thresholds) |
| `flamegraph_diff.py` | Diff two flame graphs (before/after fix) and highlight the biggest changes |
| `gc_log_analyzer.py` | Parse JVM GC logs (G1, ZGC, Shenandoah) and produce active-data-size + promotion-rate calculations from the Alibaba methodology |
| `slo_burn_rate.py` | Compute multi-window multi-burn-rate alert thresholds from an SLO target |
| `histogram_saturation_check.py` | Given a Prometheus histogram metric, check what fraction of samples land in `+Inf` (the histogram bucket saturation diagnostic) |
| `coordinated_omission_check.py` | Compare load-gen-reported percentiles vs server-side histogram percentiles and flag divergence |
| `lighthouse_budget_diff.py` | Diff two Lighthouse runs and check against `lighthouserc.json` budgets |
| `jvm_flag_recommender.py` | Given pod memory + CPU limits + Java version + GC choice, output validated JVM flag set |

## How the skill invokes scripts

When SKILL.md or a reference points to a script:

1. **Discover**: `ls scripts/` to see what's available in the current installation
2. **Read**: `view scripts/<name>.py` to confirm signature and behavior before invoking
3. **Invoke**: `bash_tool` with `python scripts/<name>.py <args>` or similar
4. **Interpret**: parse output, integrate into response, attribute the script

Example pattern in a reference file:

```markdown
## PromQL validation

For any PromQL query that goes into a production alert rule or dashboard panel, run:

\`\`\`bash
python scripts/validate_promql.py "<your-query>"
\`\`\`

The script catches counter-without-rate, histogram-quantile-on-non-bucket, and missing-label-matchers bugs that are otherwise expensive to discover in production.
```

## Naming conventions

- Snake case: `validate_promql.py`, not `validatePromql.py`
- Verb-first: `analyze_*`, `validate_*`, `generate_*`, `check_*`
- Output JSON to stdout where possible (parseable by Claude); human-readable to stderr
- Exit code 0 on success, non-zero on validation failure

## Dependencies

- Python 3.10+ preferred (stdlib-first; minimize external deps)
- If a script needs external libraries, declare them at the top of the file with a comment AND add a `requirements.txt` alongside
- Avoid heavy dependencies (no pandas just to parse a CSV — use stdlib `csv` module)

## Contributing a new script

When adding a new script:

1. Add the script file with a clear docstring describing inputs, outputs, exit codes
2. Add a usage example to this README
3. Update the relevant reference in `references/` to point to the script
4. If the script changes existing skill behavior significantly, update CHANGELOG.md

## Why this is empty for v1.0.0

The skill ships as documentation-first because:
- Perf engineering judgment is the value; deterministic scripts are accelerators, not substitutes
- Each script adds a maintenance burden — they must work across user environments
- Most perf tasks benefit more from human-readable advice than from script automation

Future versions will add scripts where the deterministic-vs-judgment trade-off favors automation.
