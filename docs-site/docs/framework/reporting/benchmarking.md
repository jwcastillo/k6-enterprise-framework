---
title: "Framework Benchmarking"
sidebar_position: 2
---
# Framework Benchmarking

Measuring framework overhead, interpreting results, load generator health monitoring, and scaling guide.

---

## Table of Contents

1. [Why Benchmark](#why-benchmark)
2. [Internal Benchmark Suite](#internal-benchmark-suite)
3. [Generator Health Monitoring](#generator-health-monitoring)
4. [Overhead Warnings](#overhead-warnings)
5. [Interpreting Results](#interpreting-results)
6. [Scaling Guide](#scaling-guide)

---

## Why Benchmark

The framework adds measurable overhead on top of base k6: configuration loading, schema validation, logging, SLO evaluation, etc. If this overhead is significant relative to the response time of the service under test, the test results could be distorted.

The `_benchmark` client measures this overhead in your specific environment so you can:

- Know the overhead baseline before running formal tests
- Detect if a new framework version increases overhead
- Make scaling decisions based on real data

---

## Internal Benchmark Suite

The `_benchmark` client (`clients/_benchmark/`) contains framework measurement scenarios.

### Running the Benchmark

```bash
# Full benchmark (5-10 minutes)
./bin/run-test.sh --client=_benchmark --service=baseline --test=load

# Quick smoke to verify everything works (~1 minute)
./bin/run-test.sh --client=_benchmark --service=baseline --test=smoke
```

### What the Benchmark Measures

The `baseline.ts` scenario measures:

| Metric                          | Description                                              |
|----------------------------------|----------------------------------------------------------|
| Framework initialization time    | Config, schema loading, and initial validation time      |
| Per-request overhead             | Overhead per VU iteration (ms)                           |
| Memory per VU                    | Additional memory consumed per VU by the framework       |
| Logging throughput               | Log entries per second without degrading the test        |
| SLO evaluation time              | Time to evaluate SLOs at test completion                 |

### Expected Output

```
Framework Benchmark — Baseline Results
────────────────────────────────────────
Init time:           45ms      (target: < 500ms)  ✓
Per-request overhead: 0.8ms    (target: < 2ms)    ✓
Memory per VU:        2.1 MB   (target: < 5 MB)   ✓
Logging throughput:  12,000/s  (target: > 5,000/s) ✓
SLO eval time:        12ms     (100 executions)   ✓
```

### Comparing Against a Previous Baseline

```bash
# Save current result
./bin/run-test.sh --client=_benchmark --service=baseline --test=load
# The JSON report is saved in reports/_benchmark/

# Compare with the previous execution (built-in auto-compare)
./bin/run-test.sh --client=_benchmark --service=baseline --test=load --compare
```

---

## Generator Health Monitoring

The `GeneratorHealthMonitor` (`src/node/generator-health.ts` — Node-only; relocated from `src/observability/` in Phase 4 / ARC-06) samples CPU and memory of the load generator every 5 seconds during test execution.

### Automatic Activation

Monitoring is automatically activated for formal profiles (`load`, `stress`, `soak`, `breakpoint`). It is disabled by default for `smoke` and `quick`.

```bash
# Force monitoring on any profile
./bin/run-test.sh --client=acme --service=users --test=smoke --monitor-health
```

### Sampled Metrics

| Metric           | Description                                              | Warning Threshold |
|------------------|----------------------------------------------------------|-------------------|
| CPU usage        | CPU percentage used by the k6 process                    | > 80%             |
| Memory RSS       | Resident memory of the process (MB)                      | > 85% of RAM      |
| Memory heap used | Node.js heap used (for the bin/ context)                 | > 90% of max heap |

### Docker Compatibility

The monitor automatically detects if it is running inside a Docker container and reads metrics from cgroups (`/sys/fs/cgroup/`) instead of `os.cpus()`.

### HTML Report Section

At test completion, the HTML report includes a **"Generator Health"** section with:

- CPU chart over time (time series of each sample)
- Memory RSS chart
- Indicators showing whether any threshold was exceeded during the test
- Total number of samples taken and monitoring duration

---

## Overhead Warnings

The `OverheadDetector` (`src/observability/overhead-detector.ts`) detects conditions that may distort results before starting execution.

### Emitted Warnings

| Code              | Condition                                              | Severity |
|-------------------|--------------------------------------------------------|----------|
| `DEBUG_IN_FORMAL` | Debug logging active in a formal profile               | warning  |
| `CHAOS_IN_FORMAL` | Chaos injection active without explicit `--no-chaos`   | warning  |
| `HIGH_VU_COUNT`   | VUs > 5,000 on a single generator                      | warning  |
| `HIGH_OVERHEAD`   | Measured overhead > 2ms per iteration                  | warning  |

### Console Warning Example

```
⚠ OVERHEAD WARNING [DEBUG_IN_FORMAL]
  Debug logging is active during a formal test profile (load).
  This may add 3-8ms per iteration and distort latency results.
  Remediation: Set LOG_LEVEL=warn or use --no-debug flag.

⚠ OVERHEAD WARNING [HIGH_VU_COUNT]
  VU count (6,000) exceeds the recommended limit for a single generator (5,000).
  Results may show artificial latency spikes due to generator saturation.
  Remediation: Use distributed execution (see docs/BENCHMARKING.md#scaling-guide).
```

### Suppressing Known Warnings

```bash
# Suppress specific warnings (not recommended in production)
./bin/run-test.sh --client=acme --service=users --test=load --suppress-warnings=DEBUG_IN_FORMAL
```

---

## Interpreting Results

### Acceptable Overhead

The framework overhead is acceptable if the **per-request overhead is less than 1% of the P95 latency of the service under test**.

Examples:

| Service P95      | Framework Overhead | Impact    | Acceptable |
|------------------|------------------------|-----------|-----------|
| 500ms            | 0.8ms                  | 0.16%     | Yes       |
| 50ms             | 0.8ms                  | 1.6%      | Borderline|
| 10ms             | 0.8ms                  | 8%        | No        |

If the service has P95 < 20ms, consider running the benchmark without logging helpers to minimize overhead.

### Generator CPU > 80%

If the monitor reports CPU > 80% for more than 20% of the test duration, the latency results are unreliable. The generator cannot send requests at the expected rate, artificially limiting measured throughput.

**Action**: reduce VUs or scale horizontally (see scaling guide).

### Difference Between Measured and Reported Overhead

The overhead reported in the benchmark is the overhead in an idealized scenario (requests to localhost). In a real scenario with requests to remote services, the framework overhead represents an even smaller fraction of total time.

---

## Scaling Guide

### When to Scale

- Required VUs > 5,000 on a single generator
- Generator CPU exceeds 80% during the test
- More than 50,000 sustained RPS are needed
- The test lasts more than 4 hours (risk of memory saturation)

### Scaling Options

**Option 1: Increase generator resources** (simplest)

```bash
# In Docker: increase CPUs and memory for the k6 container
docker run --cpus=8 --memory=16g grafana/k6 run ...
```

**Option 2: Distributed execution with k6 cloud or k6 OSS distributed**

```bash
# k6 OSS distributed (experimental)
k6 run --execution-segment="0:1/3" --execution-segment-sequence="0,1/3,2/3,1" script.js
# Run in parallel on 3 machines with the corresponding segments
```

**Option 3: Reduce framework overhead**

```bash
# Disable structured logging in high-load formal tests
LOG_LEVEL=warn ./bin/run-test.sh --client=acme --service=users --test=stress

# Disable chaos during the baseline
./bin/run-test.sh --client=acme --service=users --test=stress --no-chaos
```

### Rule of Thumb: VUs per CPU

Based on the framework's internal benchmark:

| Test Type          | VUs per vCPU (recommended) |
|--------------------|---------------------------|
| Simple HTTP REST   | 500 - 1,000               |
| Complex GraphQL    | 200 - 400                 |
| WebSocket          | 300 - 600                 |
| File upload        | 50 - 100                  |

Example: for 3,000 VUs in a REST test, at least 4 vCPUs are recommended for the generator.
