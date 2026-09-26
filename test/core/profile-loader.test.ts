import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  loadProfile,
  listProfiles,
  mergeThresholds,
  profileToOptions,
} from "../../src/core/profile-loader";

describe("ProfileLoader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── loadProfile ───────────────────────────────────────────────────────────

  describe("loadProfile", () => {
    it("should load the smoke profile", () => {
      const profile = loadProfile("smoke");
      expect(profile.name).toBe("smoke");
      expect(profile.stages).toBeDefined();
      expect(profile.thresholds).toBeDefined();
    });

    it("should load the load profile", () => {
      const profile = loadProfile("load");
      expect(profile.name).toBe("load");
      expect(profile.description).toContain("Normal expected load");
    });

    it("should load the stress profile", () => {
      const profile = loadProfile("stress");
      expect(profile.name).toBe("stress");
      expect(profile.stages!.length).toBeGreaterThan(0);
    });

    it("should load the spike profile", () => {
      const profile = loadProfile("spike");
      expect(profile.name).toBe("spike");
    });

    it("should load the soak profile", () => {
      const profile = loadProfile("soak");
      expect(profile.name).toBe("soak");
    });

    it("should load the breakpoint profile", () => {
      const profile = loadProfile("breakpoint");
      expect(profile.name).toBe("breakpoint");
    });

    it("should load the capacity profile", () => {
      const profile = loadProfile("capacity");
      expect(profile.name).toBe("capacity");
    });

    it("should load the rampup profile", () => {
      const profile = loadProfile("rampup");
      expect(profile.name).toBe("rampup");
    });

    it("should load the quick profile", () => {
      const profile = loadProfile("quick");
      expect(profile.name).toBe("quick");
    });

    it("should load throughput-low (arrival-rate) profile", () => {
      const profile = loadProfile("throughput-low");
      expect(profile.name).toBe("throughput-low");
      expect(profile.executor).toBe("constant-arrival-rate");
    });

    it("should load throughput-medium profile", () => {
      const profile = loadProfile("throughput-medium");
      expect(profile.name).toBe("throughput-medium");
      expect(profile.executor).toBe("constant-arrival-rate");
    });

    it("should load throughput-high profile", () => {
      const profile = loadProfile("throughput-high");
      expect(profile.name).toBe("throughput-high");
      expect(profile.executor).toBe("constant-arrival-rate");
    });

    it("should load throughput-ramp (ramping-arrival-rate) profile", () => {
      const profile = loadProfile("throughput-ramp");
      expect(profile.name).toBe("throughput-ramp");
      expect(profile.executor).toBe("ramping-arrival-rate");
    });

    it("should throw for unknown profile name", () => {
      expect(() => loadProfile("nonexistent" as never)).toThrow(
        "ProfileLoader: unknown profile 'nonexistent'"
      );
    });

    it("should include available profile names in error message", () => {
      try {
        loadProfile("invalid" as never);
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).toContain("smoke");
        expect(msg).toContain("load");
        expect(msg).toContain("stress");
        expect(msg).toContain("Available:");
      }
    });

    it("should have thresholds for every profile", () => {
      const profiles = listProfiles();
      for (const name of profiles) {
        const profile = loadProfile(name);
        expect(profile.thresholds).toBeDefined();
        expect(Object.keys(profile.thresholds).length).toBeGreaterThan(0);
      }
    });

    it("should have maxDuration for every profile", () => {
      const profiles = listProfiles();
      for (const name of profiles) {
        const profile = loadProfile(name);
        expect(profile.maxDuration).toBeDefined();
      }
    });

    it("should have descriptions for every profile", () => {
      const profiles = listProfiles();
      for (const name of profiles) {
        const profile = loadProfile(name);
        expect(profile.description).toBeDefined();
        expect(profile.description.length).toBeGreaterThan(0);
      }
    });
  });

  // ── listProfiles ──────────────────────────────────────────────────────────

  describe("listProfiles", () => {
    it("should return all profile names", () => {
      const profiles = listProfiles();
      expect(profiles).toContain("smoke");
      expect(profiles).toContain("quick");
      expect(profiles).toContain("load");
      expect(profiles).toContain("rampup");
      expect(profiles).toContain("capacity");
      expect(profiles).toContain("stress");
      expect(profiles).toContain("spike");
      expect(profiles).toContain("breakpoint");
      expect(profiles).toContain("soak");
      expect(profiles).toContain("throughput-low");
      expect(profiles).toContain("throughput-medium");
      expect(profiles).toContain("throughput-high");
      expect(profiles).toContain("throughput-ramp");
    });

    it("should return exactly 17 profiles", () => {
      const profiles = listProfiles();
      expect(profiles).toHaveLength(17);
    });

    it("should include VU-based closed-model variants", () => {
      const profiles = listProfiles();
      expect(profiles).toContain("load-vu");
      expect(profiles).toContain("stress-vu");
      expect(profiles).toContain("spike-vu");
      expect(profiles).toContain("soak-vu");
    });
  });

  // ── mergeThresholds ───────────────────────────────────────────────────────

  describe("mergeThresholds", () => {
    it("should return profile thresholds when no overrides provided", () => {
      const profile = loadProfile("smoke");
      const result = mergeThresholds(profile);
      expect(result).toEqual(profile.thresholds);
    });

    it("should merge overrides on top of profile thresholds", () => {
      const profile = loadProfile("smoke");
      const overrides = {
        http_req_duration: ["p(95)<3000"],
        custom_metric: ["count>100"],
      };

      const result = mergeThresholds(profile, overrides);
      expect(result.http_req_duration).toEqual(["p(95)<3000"]); // overridden
      expect(result.http_req_failed).toEqual(profile.thresholds.http_req_failed); // preserved
      expect(result.custom_metric).toEqual(["count>100"]); // added
    });

    it("should not mutate the original profile thresholds", () => {
      const profile = loadProfile("smoke");
      const originalThresholds = { ...profile.thresholds };
      mergeThresholds(profile, { http_req_duration: ["p(95)<9999"] });
      expect(profile.thresholds).toEqual(originalThresholds);
    });

    it("should handle empty overrides object", () => {
      const profile = loadProfile("smoke");
      const result = mergeThresholds(profile, {});
      expect(result).toEqual(profile.thresholds);
    });
  });

  // ── profileToOptions ──────────────────────────────────────────────────────

  describe("profileToOptions", () => {
    it("should generate VU-based options for smoke profile", () => {
      const options = profileToOptions("smoke");

      expect(options.stages).toBeDefined();
      expect(options.thresholds).toBeDefined();
      expect(options.maxDuration).toBeDefined();
      expect(options.scenarios).toBeUndefined(); // VU-based, no scenarios
    });

    it("should generate arrival-rate options for load profile (open model)", () => {
      const options = profileToOptions("load");

      expect(options.scenarios).toBeDefined();
      expect(options.stages).toBeUndefined();
      expect(options.thresholds).toBeDefined();

      const scenario = (options.scenarios as Record<string, Record<string, unknown>>).default;
      expect(scenario.executor).toBe("ramping-arrival-rate");
      expect(scenario.stages).toBeDefined();
      expect(scenario.preAllocatedVUs).toBeDefined();
      expect(scenario.maxVUs).toBeDefined();
    });

    it("should generate VU-based options for load-vu profile (closed model)", () => {
      const options = profileToOptions("load-vu");

      expect(options.stages).toBeDefined();
      expect(options.thresholds).toBeDefined();
      expect(options.scenarios).toBeUndefined();
    });

    it("should generate arrival-rate options for throughput-low", () => {
      const options = profileToOptions("throughput-low");

      expect(options.scenarios).toBeDefined();
      expect(options.stages).toBeUndefined(); // arrival-rate, no stages at top level
      expect(options.thresholds).toBeDefined();

      const scenario = (options.scenarios as Record<string, Record<string, unknown>>).default;
      expect(scenario.executor).toBe("constant-arrival-rate");
      expect(scenario.rate).toBe(10);
      expect(scenario.timeUnit).toBe("1s");
      expect(scenario.duration).toBe("5m");
      expect(scenario.preAllocatedVUs).toBe(20);
      expect(scenario.maxVUs).toBe(50);
    });

    it("should generate arrival-rate options for throughput-ramp", () => {
      const options = profileToOptions("throughput-ramp");

      const scenario = (options.scenarios as Record<string, Record<string, unknown>>).default;
      expect(scenario.executor).toBe("ramping-arrival-rate");
      expect(scenario.stages).toBeDefined();
      expect(scenario.preAllocatedVUs).toBeDefined();
      expect(scenario.maxVUs).toBeDefined();
      // ramping-arrival-rate should NOT have rate/timeUnit/duration
      expect(scenario.rate).toBeUndefined();
    });

    it("should include maxDuration in options", () => {
      const options = profileToOptions("smoke");
      expect(options.maxDuration).toBe("2m");
    });

    it("should apply threshold overrides in options", () => {
      const overrides = {
        http_req_duration: ["p(95)<9999"],
      };
      const options = profileToOptions("smoke", overrides);
      const thresholds = options.thresholds as Record<string, string[]>;
      expect(thresholds.http_req_duration).toEqual(["p(95)<9999"]);
    });

    it("should throw for unknown profile name", () => {
      expect(() => profileToOptions("nonexistent" as never)).toThrow(
        "ProfileLoader: unknown profile"
      );
    });

    it("should set default scenario name to 'default'", () => {
      const options = profileToOptions("throughput-high");
      const scenarios = options.scenarios as Record<string, unknown>;
      expect(scenarios.default).toBeDefined();
    });

    it("should include maxDuration for arrival-rate profiles", () => {
      const options = profileToOptions("throughput-low");
      expect(options.maxDuration).toBeDefined();
    });
  });

  // ── K6_ARRIVAL_RATE / K6_STEP_DURATION overrides (bin/find-capacity.js) ────

  describe("arrival-rate overrides", () => {
    const env = () => (globalThis as unknown as { __ENV: Record<string, string> }).__ENV;
    const scenarioOf = (name: Parameters<typeof profileToOptions>[0]) =>
      (profileToOptions(name).scenarios as Record<string, Record<string, unknown>>).default;

    beforeEach(() => {
      delete env()["K6_ARRIVAL_RATE"];
      delete env()["K6_STEP_DURATION"];
    });

    it("uses the profile's own rate when nothing is set", () => {
      expect(scenarioOf("throughput-low").rate).toBe(10);
    });

    it("overrides the rate and the step duration", () => {
      env()["K6_ARRIVAL_RATE"] = "137";
      env()["K6_STEP_DURATION"] = "30s";
      const scenario = scenarioOf("throughput-low");
      expect(scenario.rate).toBe(137);
      expect(scenario.duration).toBe("30s");
    });

    it("raises the VU pool so the generator can keep up with the rate", () => {
      env()["K6_ARRIVAL_RATE"] = "500";
      const scenario = scenarioOf("throughput-low");
      expect(scenario.preAllocatedVUs).toBeGreaterThanOrEqual(1000);
      expect(scenario.maxVUs).toBeGreaterThanOrEqual(2000);
    });

    it("never lowers the VU pool below the profile's own", () => {
      env()["K6_ARRIVAL_RATE"] = "1";
      const scenario = scenarioOf("throughput-high");
      expect(scenario.preAllocatedVUs).toBe(120);
      expect(scenario.maxVUs).toBe(300);
    });

    it("ignores a rate that is not a positive number", () => {
      for (const bad of ["0", "-5", "abc", ""]) {
        env()["K6_ARRIVAL_RATE"] = bad;
        expect(scenarioOf("throughput-low").rate).toBe(10);
      }
    });

    it("leaves VU-based profiles untouched", () => {
      env()["K6_ARRIVAL_RATE"] = "137";
      const options = profileToOptions("smoke");
      expect(options.scenarios).toBeUndefined();
      expect(options.stages).toBeDefined();
    });
  });
});

// The inline PROFILES (bundled for k6, the runtime source of truth) and
// shared/profiles/*.json (copied into standalone exports) must generate the same
// load. Descriptions and threshold sets are not compared.
describe("shared/profiles/*.json load-shape parity", () => {
  const dir = path.resolve(__dirname, "../../shared/profiles");
  const names = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
  const SHAPE_KEYS = ["executor", "stages", "rate", "timeUnit", "duration", "preAllocatedVUs", "maxVUs", "maxDuration"];
  const shape = (p: Record<string, unknown>) =>
    Object.fromEntries(SHAPE_KEYS.filter((k) => p[k] !== undefined).map((k) => [k, p[k]]));

  it.each(names)("%s.json generates the same load as the inline profile", (name) => {
    const json = JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf-8"));
    const inline = loadProfile(name as Parameters<typeof loadProfile>[0]) as unknown as Record<string, unknown>;
    expect(shape(json)).toEqual(shape(inline));
  });
});
