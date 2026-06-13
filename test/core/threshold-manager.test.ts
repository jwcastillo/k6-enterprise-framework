import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import type { ClientContext } from "../../src/types/client.d";

// Spy on fs and path before importing the module under test
const existsSyncSpy = vi.spyOn(fs, "existsSync");
const readFileSyncSpy = vi.spyOn(fs, "readFileSync");
vi.spyOn(path, "join").mockImplementation((...parts: string[]) => parts.join("/"));

// Mock the profile-loader dependency (used by mergeThresholdHierarchy)
vi.mock("../../src/core/profile-loader", () => ({
  loadProfile: vi.fn((name: string) => ({
    name,
    description: `${name} profile`,
    stages: [{ duration: "1m", target: 1 }],
    thresholds: {
      http_req_duration: ["p(95)<2000"],
      http_req_failed: ["rate<0.01"],
    },
    maxDuration: "2m",
  })),
}));

import {
  loadThresholdOverrides,
  mergeThresholdHierarchy,
  buildClientThresholds,
  diffThresholds,
} from "../../src/core/threshold-manager";

function makeClientContext(overrides: Partial<ClientContext> = {}): ClientContext {
  return {
    clientId: "test-client",
    rootDir: "/clients/test-client",
    configDir: "/clients/test-client/config",
    dataDir: "/clients/test-client/data",
    libDir: "/clients/test-client/lib",
    scenariosDir: "/clients/test-client/scenarios",
    reportsDir: "/clients/test-client/reports",
    envFile: "/clients/test-client/.env",
    mocksDir: "/clients/test-client/mocks",
    brandingDir: "/clients/test-client/branding",
    isSubmodule: false,
    isSymlink: false,
    ...overrides,
  };
}

describe("ThresholdManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── loadThresholdOverrides ────────────────────────────────────────────────

  describe("loadThresholdOverrides", () => {
    it("should return null when thresholds.json does not exist", () => {
      existsSyncSpy.mockReturnValue(false);
      const result = loadThresholdOverrides(makeClientContext());
      expect(result).toBeNull();
    });

    it("should load and parse valid thresholds.json", () => {
      const config = {
        global: {
          http_req_duration: ["p(95)<1500"],
        },
      };
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(config));

      const result = loadThresholdOverrides(makeClientContext());
      expect(result).toEqual(config);
    });

    it("should throw when thresholds.json is invalid JSON", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue("{bad json");

      expect(() => loadThresholdOverrides(makeClientContext())).toThrow(
        "ThresholdManager: failed to parse thresholds.json"
      );
    });

    it("should load config with global, services, and profiles sections", () => {
      const config = {
        global: { http_req_duration: ["p(95)<1000"] },
        services: {
          "users-api": { http_req_duration: ["p(95)<500"] },
        },
        profiles: {
          stress: { http_req_failed: ["rate<0.10"] },
        },
      };
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(config));

      const result = loadThresholdOverrides(makeClientContext());
      expect(result).toEqual(config);
    });

    it("should throw on non-array threshold conditions", () => {
      const config = {
        global: {
          http_req_duration: "p(95)<1500", // should be array
        },
      };
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(config));

      expect(() => loadThresholdOverrides(makeClientContext())).toThrow(
        "ThresholdManager: global.http_req_duration must be an array"
      );
    });

    it("should throw on empty string in threshold conditions", () => {
      const config = {
        global: {
          http_req_duration: ["p(95)<1500", ""],
        },
      };
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(config));

      expect(() => loadThresholdOverrides(makeClientContext())).toThrow(
        "ThresholdManager: global.http_req_duration contains invalid condition"
      );
    });

    it("should throw on non-string condition in array", () => {
      const config = {
        global: {
          http_req_duration: [123],
        },
      };
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(config));

      expect(() => loadThresholdOverrides(makeClientContext())).toThrow(
        "ThresholdManager: global.http_req_duration contains invalid condition"
      );
    });

    it("should validate service-level threshold overrides", () => {
      const config = {
        services: {
          "users-api": {
            http_req_duration: "not-an-array",
          },
        },
      };
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(config));

      expect(() => loadThresholdOverrides(makeClientContext())).toThrow(
        "ThresholdManager: services.users-api.http_req_duration must be an array"
      );
    });

    it("should validate profile-level threshold overrides", () => {
      const config = {
        profiles: {
          stress: {
            http_req_failed: 42,
          },
        },
      };
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(config));

      expect(() => loadThresholdOverrides(makeClientContext())).toThrow(
        "ThresholdManager: profiles.stress.http_req_failed must be an array"
      );
    });
  });

  // ── mergeThresholdHierarchy ───────────────────────────────────────────────

  describe("mergeThresholdHierarchy", () => {
    it("should return profile defaults when no overrides exist", () => {
      const result = mergeThresholdHierarchy("smoke", undefined, null);
      expect(result).toEqual({
        http_req_duration: ["p(95)<2000"],
        http_req_failed: ["rate<0.01"],
      });
    });

    it("should merge global overrides on top of profile defaults", () => {
      const overrides = {
        global: {
          http_req_duration: ["p(95)<1500"],
          checks: ["rate>=0.95"],
        },
      };

      const result = mergeThresholdHierarchy("smoke", undefined, overrides);
      expect(result.http_req_duration).toEqual(["p(95)<1500"]); // overridden
      expect(result.http_req_failed).toEqual(["rate<0.01"]); // preserved from profile
      expect(result.checks).toEqual(["rate>=0.95"]); // added
    });

    it("should merge per-profile overrides on top of global", () => {
      const overrides = {
        global: {
          http_req_duration: ["p(95)<1500"],
        },
        profiles: {
          smoke: {
            http_req_duration: ["p(95)<1000"],
          },
        },
      };

      const result = mergeThresholdHierarchy("smoke", undefined, overrides);
      expect(result.http_req_duration).toEqual(["p(95)<1000"]); // profile-specific wins
    });

    it("should merge per-service overrides on top of profile overrides", () => {
      const overrides = {
        global: {
          http_req_duration: ["p(95)<1500"],
        },
        profiles: {
          smoke: {
            http_req_duration: ["p(95)<1000"],
          },
        },
        services: {
          "users-api": {
            http_req_duration: ["p(95)<800"],
          },
        },
      };

      const result = mergeThresholdHierarchy("smoke", "users-api", overrides);
      expect(result.http_req_duration).toEqual(["p(95)<800"]); // service-specific wins
    });

    it("should not apply service overrides when serviceName is undefined", () => {
      const overrides = {
        services: {
          "users-api": {
            http_req_duration: ["p(95)<800"],
          },
        },
      };

      const result = mergeThresholdHierarchy("smoke", undefined, overrides);
      expect(result.http_req_duration).toEqual(["p(95)<2000"]); // profile default
    });

    it("should not apply service overrides when service name does not match", () => {
      const overrides = {
        services: {
          "users-api": {
            http_req_duration: ["p(95)<800"],
          },
        },
      };

      const result = mergeThresholdHierarchy("smoke", "orders-api", overrides);
      expect(result.http_req_duration).toEqual(["p(95)<2000"]); // profile default
    });

    it("should apply CLI overrides with highest priority", () => {
      const overrides = {
        global: {
          http_req_duration: ["p(95)<1500"],
        },
        services: {
          "users-api": {
            http_req_duration: ["p(95)<800"],
          },
        },
      };
      const cliOverrides = {
        http_req_duration: ["p(95)<3000"],
      };

      const result = mergeThresholdHierarchy("smoke", "users-api", overrides, cliOverrides);
      expect(result.http_req_duration).toEqual(["p(95)<3000"]); // CLI wins over everything
    });

    it("should not apply empty CLI overrides", () => {
      const result = mergeThresholdHierarchy("smoke", undefined, null, {});
      expect(result.http_req_duration).toEqual(["p(95)<2000"]); // profile default
    });

    it("should not apply profile overrides for a different profile", () => {
      const overrides = {
        profiles: {
          stress: {
            http_req_duration: ["p(95)<5000"],
          },
        },
      };

      const result = mergeThresholdHierarchy("smoke", undefined, overrides);
      expect(result.http_req_duration).toEqual(["p(95)<2000"]); // smoke profile default
    });
  });

  // ── buildClientThresholds ─────────────────────────────────────────────────

  describe("buildClientThresholds", () => {
    it("should return profile defaults when no thresholds.json exists", () => {
      existsSyncSpy.mockReturnValue(false);

      const result = buildClientThresholds(makeClientContext(), "smoke");
      expect(result.http_req_duration).toEqual(["p(95)<2000"]);
      expect(result.http_req_failed).toEqual(["rate<0.01"]);
    });

    it("should merge client overrides with profile defaults", () => {
      const config = {
        global: {
          checks: ["rate>=0.99"],
        },
      };
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(config));

      const result = buildClientThresholds(makeClientContext(), "smoke");
      expect(result.checks).toEqual(["rate>=0.99"]);
      expect(result.http_req_duration).toEqual(["p(95)<2000"]);
    });

    it("should apply CLI overrides on top of everything", () => {
      existsSyncSpy.mockReturnValue(false);

      const result = buildClientThresholds(
        makeClientContext(),
        "smoke",
        undefined,
        { http_req_duration: ["p(95)<5000"] }
      );
      expect(result.http_req_duration).toEqual(["p(95)<5000"]);
    });
  });

  // ── diffThresholds ────────────────────────────────────────────────────────

  describe("diffThresholds", () => {
    it("should return empty array when thresholds are identical", () => {
      const t = { http_req_duration: ["p(95)<2000"], http_req_failed: ["rate<0.01"] };
      const result = diffThresholds(t, t);
      expect(result).toEqual([]);
    });

    it("should detect changed threshold conditions", () => {
      const old = { http_req_duration: ["p(95)<2000"] };
      const updated = { http_req_duration: ["p(95)<1500"] };

      const result = diffThresholds(old, updated);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        metric: "http_req_duration",
        oldConditions: ["p(95)<2000"],
        newConditions: ["p(95)<1500"],
      });
    });

    it("should detect added metrics", () => {
      const old = { http_req_duration: ["p(95)<2000"] };
      const updated = {
        http_req_duration: ["p(95)<2000"],
        checks: ["rate>=0.95"],
      };

      const result = diffThresholds(old, updated);
      expect(result).toHaveLength(1);
      expect(result[0].metric).toBe("checks");
      expect(result[0].oldConditions).toEqual([]);
      expect(result[0].newConditions).toEqual(["rate>=0.95"]);
    });

    it("should detect removed metrics", () => {
      const old = {
        http_req_duration: ["p(95)<2000"],
        checks: ["rate>=0.95"],
      };
      const updated = { http_req_duration: ["p(95)<2000"] };

      const result = diffThresholds(old, updated);
      expect(result).toHaveLength(1);
      expect(result[0].metric).toBe("checks");
      expect(result[0].oldConditions).toEqual(["rate>=0.95"]);
      expect(result[0].newConditions).toEqual([]);
    });

    it("should handle empty threshold maps", () => {
      const result = diffThresholds({}, {});
      expect(result).toEqual([]);
    });

    it("should detect multiple changes", () => {
      const old = {
        http_req_duration: ["p(95)<2000"],
        http_req_failed: ["rate<0.01"],
      };
      const updated = {
        http_req_duration: ["p(95)<1500"],
        http_req_failed: ["rate<0.05"],
      };

      const result = diffThresholds(old, updated);
      expect(result).toHaveLength(2);
    });
  });
});
