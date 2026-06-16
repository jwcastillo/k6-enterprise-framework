/** T-022: Load profile resolver — loads from shared/profiles/<name>.json */

import { LoadProfile, ArrivalRateProfile, ProfileName } from "../types/profile.d";

// Inline profile definitions (webpack bundles these; no fs access at k6 runtime)
// These mirror shared/profiles/*.json exactly for k6 in-process use.

const PROFILES: Record<ProfileName, LoadProfile> = {
  smoke: {
    name: "smoke",
    description: "Minimal load (1-2 VUs, 1 min) — verify system is operational",
    stages: [
      { duration: "30s", target: 1 },
      { duration: "30s", target: 0 },
    ],
    thresholds: {
      http_req_duration: ["p(95)<2000", "p(99)<5000", "p(99.9)<10000"],
      http_req_failed: ["rate<0.01"],
      checks: ["rate>=0.99"],
    },
    maxDuration: "2m",
  },
  quick: {
    name: "quick",
    description: "Quick load (5 VUs, 3 min) — fast feedback for CI/CD",
    stages: [
      { duration: "30s", target: 5 },
      { duration: "2m", target: 5 },
      { duration: "30s", target: 0 },
    ],
    thresholds: {
      http_req_duration: ["p(95)<1500", "p(99)<3000", "p(99.9)<6000"],
      http_req_failed: ["rate<0.05"],
      checks: ["rate>=0.95"],
    },
    maxDuration: "5m",
  },
  load: {
    name: "load",
    description: "Normal expected load (50 req/s for 10 min) — arrival-rate open model",
    executor: "ramping-arrival-rate",
    stages: [
      { duration: "2m", target: 50 },
      { duration: "10m", target: 50 },
      { duration: "2m", target: 0 },
    ],
    preAllocatedVUs: 30,
    maxVUs: 150,
    thresholds: {
      http_req_duration: ["p(95)<1000", "p(99)<2000", "p(99.9)<4000"],
      http_req_failed: ["rate<0.05"],
      checks: ["rate>=0.95"],
    },
    maxDuration: "15m",
  },
  rampup: {
    name: "rampup",
    description: "Gradual ramp-up — increases load incrementally",
    stages: [
      { duration: "2m", target: 10 },
      { duration: "2m", target: 20 },
      { duration: "2m", target: 30 },
      { duration: "2m", target: 40 },
      { duration: "2m", target: 50 },
      { duration: "3m", target: 0 },
    ],
    thresholds: {
      http_req_duration: ["p(95)<1500", "p(99)<3000", "p(99.9)<6000"],
      http_req_failed: ["rate<0.10"],
      checks: ["rate>=0.90"],
    },
    maxDuration: "20m",
  },
  capacity: {
    name: "capacity",
    description: "Capacity testing — finds maximum sustainable throughput",
    stages: [
      { duration: "3m", target: 50 },
      { duration: "3m", target: 100 },
      { duration: "3m", target: 150 },
      { duration: "3m", target: 200 },
      { duration: "5m", target: 200 },
      { duration: "3m", target: 0 },
    ],
    thresholds: {
      http_req_duration: ["p(95)<2000", "p(99)<5000", "p(99.9)<10000"],
      http_req_failed: ["rate<0.15"],
      checks: ["rate>=0.85"],
    },
    maxDuration: "25m",
  },
  stress: {
    name: "stress",
    description: "Stress testing — arrival-rate open model, ramps to find breaking RPS",
    executor: "ramping-arrival-rate",
    stages: [
      { duration: "2m", target: 100 },
      { duration: "5m", target: 200 },
      { duration: "5m", target: 400 },
      { duration: "5m", target: 600 },
      { duration: "5m", target: 400 },
      { duration: "3m", target: 0 },
    ],
    preAllocatedVUs: 100,
    maxVUs: 800,
    thresholds: {
      http_req_duration: ["p(95)<5000", "p(99)<10000"],
      http_req_failed: ["rate<0.30"],
      checks: ["rate>=0.70"],
    },
    maxDuration: "30m",
  },
  spike: {
    name: "spike",
    description: "Spike testing — arrival-rate open model, sudden RPS surge",
    executor: "ramping-arrival-rate",
    stages: [
      { duration: "1m", target: 20 },
      { duration: "30s", target: 500 },
      { duration: "3m", target: 500 },
      { duration: "30s", target: 20 },
      { duration: "2m", target: 20 },
      { duration: "1m", target: 0 },
    ],
    preAllocatedVUs: 50,
    maxVUs: 1000,
    thresholds: {
      http_req_duration: ["p(95)<5000", "p(99)<10000"],
      http_req_failed: ["rate<0.25"],
      checks: ["rate>=0.75"],
    },
    maxDuration: "10m",
  },
  breakpoint: {
    name: "breakpoint",
    description: "Breakpoint testing — ramps until system breaks (manual stop expected)",
    stages: [{ duration: "1h", target: 1000 }],
    thresholds: {
      http_req_duration: ["p(95)<60000"],
      http_req_failed: ["rate<0.50"],
    },
    maxDuration: "1h10m",
  },
  soak: {
    name: "soak",
    description: "Soak testing (50 req/s for 4h) — arrival-rate open model, leak detection",
    executor: "constant-arrival-rate",
    rate: 50,
    timeUnit: "1s",
    duration: "4h",
    preAllocatedVUs: 30,
    maxVUs: 200,
    thresholds: {
      http_req_duration: ["p(95)<1500", "p(99)<3000", "p(99.9)<6000"],
      http_req_failed: ["rate<0.05"],
      checks: ["rate>=0.95"],
    },
    maxDuration: "4h30m",
  },

  // ── VU-based variants (closed model — preserved for special cases) ───────
  "load-vu": {
    name: "load-vu",
    description:
      "Closed-model load (20 VUs, 10m). Prefer 'load' unless VU concurrency is the metric.",
    stages: [
      { duration: "2m", target: 20 },
      { duration: "10m", target: 20 },
      { duration: "2m", target: 0 },
    ],
    thresholds: {
      http_req_duration: ["p(95)<1000", "p(99)<2000", "p(99.9)<4000"],
      http_req_failed: ["rate<0.05"],
      checks: ["rate>=0.95"],
    },
    maxDuration: "15m",
  },
  "stress-vu": {
    name: "stress-vu",
    description:
      "Closed-model stress (ramps 100→400 VUs). Prefer 'stress' for production-realistic load.",
    stages: [
      { duration: "2m", target: 100 },
      { duration: "5m", target: 200 },
      { duration: "5m", target: 300 },
      { duration: "5m", target: 400 },
      { duration: "5m", target: 300 },
      { duration: "3m", target: 0 },
    ],
    thresholds: {
      http_req_duration: ["p(95)<5000", "p(99)<10000"],
      http_req_failed: ["rate<0.30"],
      checks: ["rate>=0.70"],
    },
    maxDuration: "30m",
  },
  "spike-vu": {
    name: "spike-vu",
    description:
      "Closed-model spike (sudden VU surge 10→300). Prefer 'spike' for arrival-rate semantics.",
    stages: [
      { duration: "1m", target: 10 },
      { duration: "30s", target: 300 },
      { duration: "3m", target: 300 },
      { duration: "30s", target: 10 },
      { duration: "2m", target: 10 },
      { duration: "1m", target: 0 },
    ],
    thresholds: {
      http_req_duration: ["p(95)<5000", "p(99)<10000"],
      http_req_failed: ["rate<0.25"],
      checks: ["rate>=0.75"],
    },
    maxDuration: "10m",
  },
  "soak-vu": {
    name: "soak-vu",
    description:
      "Closed-model soak (20 VUs, 4h). Prefer 'soak' to avoid coordinated omission over long runs.",
    stages: [
      { duration: "5m", target: 20 },
      { duration: "4h", target: 20 },
      { duration: "5m", target: 0 },
    ],
    thresholds: {
      http_req_duration: ["p(95)<1500", "p(99)<3000", "p(99.9)<6000"],
      http_req_failed: ["rate<0.05"],
      checks: ["rate>=0.95"],
    },
    maxDuration: "4h30m",
  },

  // ── Arrival-rate profiles (open model) ───────────────────────────────────
  "throughput-low": {
    name: "throughput-low",
    description: "Low constant throughput (10 req/s) — arrival-rate open model",
    executor: "constant-arrival-rate",
    rate: 10,
    timeUnit: "1s",
    duration: "5m",
    preAllocatedVUs: 20,
    maxVUs: 50,
    thresholds: {
      http_req_duration: ["p(95)<2000", "p(99)<5000", "p(99.9)<10000"],
      http_req_failed: ["rate<0.05"],
      checks: ["rate>=0.95"],
    },
    maxDuration: "6m",
  },
  "throughput-medium": {
    name: "throughput-medium",
    description: "Medium constant throughput (50 req/s) — arrival-rate open model",
    executor: "constant-arrival-rate",
    rate: 50,
    timeUnit: "1s",
    duration: "5m",
    preAllocatedVUs: 60,
    maxVUs: 150,
    thresholds: {
      http_req_duration: ["p(95)<1500", "p(99)<3000", "p(99.9)<6000"],
      http_req_failed: ["rate<0.05"],
      checks: ["rate>=0.95"],
    },
    maxDuration: "6m",
  },
  "throughput-high": {
    name: "throughput-high",
    description: "High constant throughput (100 req/s) — arrival-rate open model",
    executor: "constant-arrival-rate",
    rate: 100,
    timeUnit: "1s",
    duration: "5m",
    preAllocatedVUs: 120,
    maxVUs: 300,
    thresholds: {
      http_req_duration: ["p(95)<1000", "p(99)<2000", "p(99.9)<4000"],
      http_req_failed: ["rate<0.05"],
      checks: ["rate>=0.95"],
    },
    maxDuration: "6m",
  },
  "throughput-ramp": {
    name: "throughput-ramp",
    description:
      "Ramping throughput (10→100 req/s) — arrival-rate open model with gradual increase",
    executor: "ramping-arrival-rate",
    stages: [
      { duration: "2m", target: 10 },
      { duration: "3m", target: 50 },
      { duration: "3m", target: 100 },
      { duration: "2m", target: 100 },
      { duration: "2m", target: 0 },
    ],
    preAllocatedVUs: 120,
    maxVUs: 300,
    thresholds: {
      http_req_duration: ["p(95)<2000", "p(99)<5000", "p(99.9)<10000"],
      http_req_failed: ["rate<0.10"],
      checks: ["rate>=0.90"],
    },
    maxDuration: "15m",
  },
};

/** Type guard: check if profile uses arrival-rate executor */
function isArrivalRate(profile: LoadProfile): profile is ArrivalRateProfile {
  return profile.executor !== undefined;
}

/** Resolve a named load profile */
export function loadProfile(name: ProfileName): LoadProfile {
  const profile = PROFILES[name];
  if (!profile) {
    const available = Object.keys(PROFILES).join(", ");
    throw new Error(`ProfileLoader: unknown profile '${name}'. Available: ${available}`);
  }
  return profile;
}

/** List all available profile names */
export function listProfiles(): ProfileName[] {
  return Object.keys(PROFILES) as ProfileName[];
}

/**
 * Merge a profile's thresholds with scenario-specific overrides.
 * Scenario thresholds take precedence over profile defaults.
 */
export function mergeThresholds(
  profile: LoadProfile,
  overrides: Record<string, string[]> = {}
): Record<string, string[]> {
  return { ...profile.thresholds, ...overrides };
}

/**
 * Build k6 options from a profile.
 * For VU-based profiles, returns `stages`.
 * For arrival-rate profiles, returns `scenarios` with the appropriate executor config.
 */
export function profileToOptions(
  name: ProfileName,
  thresholdOverrides: Record<string, string[]> = {}
): Record<string, unknown> {
  const profile = loadProfile(name);
  const thresholds = mergeThresholds(profile, thresholdOverrides);

  if (isArrivalRate(profile)) {
    const scenario: Record<string, unknown> = {
      executor: profile.executor,
      preAllocatedVUs: profile.preAllocatedVUs,
      maxVUs: profile.maxVUs,
    };

    if (profile.executor === "constant-arrival-rate") {
      scenario.rate = profile.rate;
      scenario.timeUnit = profile.timeUnit ?? "1s";
      scenario.duration = profile.duration;
    } else {
      // ramping-arrival-rate
      scenario.stages = profile.stages;
    }

    // NOTE: maxDuration is NOT a valid field for arrival-rate executors in k6
    // (rejected with "unknown field maxDuration", aborting the run). Only set it
    // at the options root below, where k6 tolerates it (VU-based path relies on that).

    return {
      scenarios: { default: scenario },
      thresholds,
      ...(profile.maxDuration ? { maxDuration: profile.maxDuration } : {}),
    };
  }

  // VU-based profile
  return {
    stages: profile.stages,
    thresholds,
    ...(profile.maxDuration ? { maxDuration: profile.maxDuration } : {}),
  };
}
