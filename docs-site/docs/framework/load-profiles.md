---
title: "Load Testing Profiles (T-160)"
sidebar_position: 2
---
# Load Testing Profiles (T-160)

The framework provides **17 predefined load profiles** covering VU-based
(closed model) and arrival-rate (open model) testing patterns.

## Quick Reference

### VU-Based Profiles (Closed Model)

| Profile | Category | VUs | Duration | Purpose |
|---------|----------|-----|----------|---------|
| `smoke` | Development | 1–2 | 1 min | Verify operational |
| `quick` | Development | 5 | 3 min | CI/CD fast feedback |
| `load` | Load | 20 | 14 min | Normal sustained load |
| `rampup` | Load | 50 | 13 min | Gradual increment |
| `capacity` | Load | 200 | 20 min | Find max throughput |
| `stress` | Stress | 400 | 25 min | Find breaking point |
| `spike` | Stress | 300 burst | ~8 min | Test elasticity |
| `breakpoint` | Stress | 1000 | 1 h | Find system limit |
| `soak` | Stability | 20 | 4 h+ | Detect memory leaks |

### Arrival-Rate Profiles (Open Model)

| Profile | Executor | Rate | Duration | Pre/Max VUs |
|---------|----------|------|----------|-------------|
| `throughput-low` | constant-arrival-rate | 10/s | 5 min | 20 / 50 |
| `throughput-medium` | constant-arrival-rate | 50/s | 5 min | 60 / 150 |
| `throughput-high` | constant-arrival-rate | 100/s | 5 min | 120 / 300 |
| `throughput-ramp` | ramping-arrival-rate | 10→100/s | 12 min | 120 / 300 |

> **Open vs Closed model:** VU-based profiles use a *closed model* where throughput
> depends on server response time. Arrival-rate profiles use an *open model* where
> the framework sends requests at a fixed rate regardless of response time — this
> simulates real-world traffic more accurately.

---

## Categories

### Development
Profiles designed for fast iteration during development and CI pipelines.

#### `smoke`
- **VUs**: 1–2
- **Duration**: 1 minute
- **Purpose**: Verify the system is operational and scripts run without errors
- **When to use**: After deployments, before running heavier tests, during development
- **Thresholds**: p95 < 2000ms, error rate < 1%, checks ≥ 99%

```bash
./bin/run-test.sh --client=my-team --scenario=api/users --profile=smoke
```

#### `quick`
- **VUs**: 5
- **Duration**: 3 minutes
- **Purpose**: Fast CI/CD feedback — catches regressions without long waits
- **When to use**: Every PR, pre-merge gates
- **Thresholds**: p95 < 1500ms, p99 < 3000ms, error rate < 5%, checks ≥ 95%

```bash
./bin/run-test.sh --client=my-team --scenario=api/users --profile=quick
```

---

### Load
Profiles for normal and elevated sustained load.

#### `load`
- **VUs**: 20 (ramp 0→20 in 2m, hold 10m, ramp down 2m)
- **Duration**: ~14 minutes total
- **Purpose**: Simulate normal production traffic
- **When to use**: Weekly regression, pre-release validation
- **Thresholds**: p95 < 1000ms, p99 < 2000ms, error rate < 5%, checks ≥ 95%

#### `rampup`
- **VUs**: 10→20→30→40→50 (step ramp, 2m per step, 3m ramp down)
- **Duration**: ~13 minutes
- **Purpose**: Gradually increase load to observe degradation onset
- **When to use**: New feature validation, capacity planning baseline

#### `capacity`
- **VUs**: 50→100→150→200 (step ramp 3m per step, hold 5m at 200, ramp down 3m)
- **Duration**: ~20 minutes
- **Purpose**: Find maximum sustainable throughput
- **When to use**: Before major releases, infrastructure changes
- **Thresholds**: p95 < 2000ms, p99 < 5000ms, error rate < 15%, checks ≥ 85%

---

### Stress
Profiles that push the system beyond normal operating conditions.

#### `stress`
- **VUs**: 100→200→300→400→300→0 (step ramp up and down, 2–5m per step)
- **Duration**: ~25 minutes
- **Purpose**: Find the breaking point and observe failure modes
- **When to use**: Quarterly stress testing, pre-scale events

#### `spike`
- **VUs**: 300 burst (warm 10 VUs 1m, spike to 300 in 30s, hold 3m, drop to 10 in 30s, cool 2m, ramp down 1m)
- **Duration**: ~8 minutes
- **Purpose**: Test system elasticity under sudden traffic spikes
- **When to use**: Before promotional events, flash sale preparation
- **Thresholds**: p95 < 2000ms during spike, error rate < 5%

#### `breakpoint`
- **VUs**: 1000 (linear ramp 0→1000 over 1h)
- **Duration**: ~1 hour
- **Purpose**: Find the absolute system limit
- **When to use**: Quarterly, after infrastructure changes
- **Note**: Expect threshold failures — the goal is to find the limit, not pass

---

### Stability
Long-duration profiles for detecting memory leaks and gradual degradation.

#### `soak`
- **VUs**: 20 (ramp 0→20 in 5m, hold 4h, ramp down 5m)
- **Duration**: 4 hours+
- **Purpose**: Detect memory leaks, connection pool exhaustion, gradual performance degradation
- **When to use**: Monthly, before major releases
- **Monitor**: Memory RSS growth, heap usage, GC pauses, gradual p99 increase

```bash
./bin/run-test.sh --client=my-team --scenario=api/users --profile=soak
```

---

### Throughput (Open Model)
Arrival-rate profiles that decouple request rate from server response time.

#### `throughput-low`
- **Executor**: `constant-arrival-rate`
- **Rate**: 10 iterations/second
- **Duration**: 5 minutes
- **VUs**: 20 pre-allocated, 50 max
- **Purpose**: Low constant throughput for baseline open-model testing
- **When to use**: Validating open-model behavior, baseline throughput tests
- **Thresholds**: p95 < 2000ms, p99 < 5000ms, error rate < 5%, checks >= 95%

```bash
./bin/run-test.sh --client=my-team --scenario=api/users --profile=throughput-low
```

#### `throughput-medium`
- **Executor**: `constant-arrival-rate`
- **Rate**: 50 iterations/second
- **Duration**: 5 minutes
- **VUs**: 60 pre-allocated, 150 max
- **Purpose**: Medium constant throughput simulating typical production traffic
- **When to use**: Realistic production traffic simulation, SLA validation
- **Thresholds**: p95 < 1500ms, p99 < 3000ms, error rate < 5%, checks >= 95%

#### `throughput-high`
- **Executor**: `constant-arrival-rate`
- **Rate**: 100 iterations/second
- **Duration**: 5 minutes
- **VUs**: 120 pre-allocated, 300 max
- **Purpose**: High constant throughput for peak-traffic simulation
- **When to use**: Peak traffic validation, pre-event capacity checks
- **Thresholds**: p95 < 1000ms, p99 < 2000ms, error rate < 5%, checks >= 95%

#### `throughput-ramp`
- **Executor**: `ramping-arrival-rate`
- **Rate**: 10→50→100 iterations/second (ramped over 12 minutes)
- **Stages**: 2m → 10/s, 3m → 50/s, 3m → 100/s, 2m hold at 100/s, 2m → 0
- **VUs**: 120 pre-allocated, 300 max
- **Purpose**: Gradually increasing throughput to find throughput ceiling
- **When to use**: Capacity planning, finding maximum sustainable request rate
- **Thresholds**: p95 < 2000ms, p99 < 5000ms, error rate < 10%, checks >= 90%

```bash
./bin/run-test.sh --client=my-team --scenario=api/users --profile=throughput-ramp
```

---

### Think Time Helper

Use `ThinkTimeHelper` to add realistic user delays between requests:

```typescript
import { thinkTime, thinkTimeNormal, pace, THINK_TIME } from "../../src/helpers/think-time-helper";

export default function () {
  const iterStart = Date.now();

  // Uniform random sleep: 1-3 seconds
  thinkTime(1, 3);

  // Or use presets
  thinkTime(...THINK_TIME.NORMAL);   // [1, 3]
  thinkTime(...THINK_TIME.READING);  // [3, 8]

  // Normally-distributed think time (more realistic)
  thinkTimeNormal(2, 0.5);  // mean=2s, stddev=0.5s

  // Pace iteration to fixed duration (ensures constant throughput)
  pace(5000, iterStart);  // pad to 5s total
}
```

---

## Threshold Hierarchy

Thresholds are applied in priority order (later levels override earlier ones).
This 5-level hierarchy allows global defaults with per-service and per-run overrides.

```
1. Profile defaults          (lowest priority)
        ↓ overridden by
2. Client global thresholds  (clients/<name>/config.json → thresholds block)
        ↓ overridden by
3. SLO config targets        (clients/<name>/config/slos.json → per-metric targets)
        ↓ overridden by
4. Scenario-level options    (thresholds block inside the scenario TypeScript file)
        ↓ overridden by
5. CLI --env overrides       (K6_THRESHOLD_P95, K6_THRESHOLD_ERROR_RATE env vars)
                             (highest priority — use for one-off test runs)
```

**Resolution example:**

| Level | Source | p95 value |
|-------|--------|-----------|
| 1 Profile default | `smoke` | < 2000ms |
| 2 Client config | `config.json` | < 800ms |
| 3 SLO config | `slos.json` payment-api | < 500ms |
| 4 Scenario options | `smoke-users.ts` | < 500ms |
| 5 CLI env var | `K6_THRESHOLD_P95=300` | **< 300ms** ← applied |

Effective threshold for the run: **p95 < 300ms**

> **Tip:** The SLO config (level 3) is the recommended place for production SLOs.
> Use CLI env vars (level 5) only for temporary experiments — they are not version-controlled.

---

## ProfileHelper API

Use `ProfileHelper` in scenario scripts to apply the active profile's
thresholds programmatically:

```typescript
// clients/my-team/scenarios/api/users.ts
import { buildOptions } from "../../lib/framework";

// Apply active profile thresholds + scenario-specific overrides
export const options = buildOptions({
  // These override the profile defaults for THIS scenario only
  http_req_duration: ["p(99)<2000"],  // stricter p99 for this endpoint
});

export default function () {
  // ... test logic
}
```

### `buildOptions(overrides?)`

```typescript
function buildOptions(
  thresholdOverrides?: Record<string, string[]>
): k6.Options
```

Reads `K6_PROFILE` from `__ENV` and returns a complete k6 options object
with the profile's scenario definition and merged thresholds.

### `ProfileHelper.applyProfile(profile, overrides?)`

```typescript
import { ProfileHelper } from "../../lib/profile-loader";

const helper = new ProfileHelper("load");
export const options = helper.applyProfile({
  // Optional threshold overrides
  http_req_duration: ["p(95)<300"],
});
```

### Available profiles programmatically

```typescript
import { PROFILES, ProfileName } from "../../lib/profile-loader";

// List all profiles
const names: ProfileName[] = Object.keys(PROFILES) as ProfileName[];
// ["smoke", "quick", "load", "rampup", "capacity", "stress", "spike", "breakpoint", "soak",
//  "throughput-low", "throughput-medium", "throughput-high", "throughput-ramp"]

// Check if a profile exists
const isValid = names.includes("custom-profile" as ProfileName); // false
```

---

## Custom Profiles

Add custom profiles to `shared/profiles/`:

```json
// shared/profiles/my-custom-profile.json
{
  "name": "my-custom",
  "description": "Custom profile for payment service",
  "scenarios": {
    "default": {
      "executor": "constant-arrival-rate",
      "rate": 100,
      "timeUnit": "1s",
      "duration": "5m",
      "preAllocatedVUs": 50,
      "maxVUs": 200
    }
  },
  "thresholds": {
    "http_req_duration": ["p(95)<200", "p(99)<500"],
    "http_req_failed": ["rate<0.001"]
  }
}
```

Validate before using:

```bash
node bin/validate-config.js --file=shared/profiles/my-custom-profile.json
```

Use it:

```bash
./bin/run-test.sh --client=my-team --scenario=api/checkout --profile=my-custom
```

---

## Throughput Modeling (users → RPS)

The framework ships a GPT-inspired throughput model (`src/core/throughput-model.ts`, T-260) that
converts a target concurrent-user count into recommended RPS and max-VU values using the same
constants as the GitLab Performance Tool.

### RPS constants per 1 000 users

| Endpoint class | RPS / 1 000 users | Notes |
|----------------|-------------------|-------|
| `"api"`        | 20                | REST / JSON API calls |
| `"web"`        | 2                 | Full-page web requests |
| `"git-pull"`   | 2                 | Git clone / fetch operations |
| `"git-push"`   | 0.4               | Git push — floored to ≥ 1 when users > 0 |

Max-VU recommendation: `min(targetRps × 5, 2000)` (GPT convention).

### API

```typescript
import { targetRpsForUsers, recommendMaxVUs, buildThroughputPlan } from "../../src";
// or import { targetRpsForUsers, recommendMaxVUs, buildThroughputPlan } from "@core/throughput-model";

// Single class
const rps = targetRpsForUsers(1000, "api");      // 20
const vus = recommendMaxVUs(rps);                // 100

// Full plan for all four classes
const plan = buildThroughputPlan(500);
// plan.perClass.api      → { targetRps: 10, recommendedMaxVUs: 50 }
// plan.perClass["git-push"] → { targetRps: 1,  recommendedMaxVUs: 5  }
```

> **Tip:** Use `buildThroughputPlan()` to size your arrival-rate profiles for a known user count,
> then pass the resulting `targetRps` value as the `rate` in a `throughput-*` profile.

---

## Troubleshooting

**Profile not found:**
```
Error: Profile 'heavy' not found. Available: smoke, quick, load, ..., throughput-low, throughput-medium, throughput-high, throughput-ramp
```
→ Check spelling or add a custom profile to `shared/profiles/`.

**Thresholds too strict for smoke:**
→ Use `--profile=smoke` — it has relaxed thresholds by design.

**Soak test uses too many resources:**
→ Reduce VUs with `--env K6_SOAK_VUS=10` (if your scenario reads this env var).
