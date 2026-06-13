import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock profile-loader before importing the module under test
vi.mock("../../src/core/profile-loader", () => ({
  profileToOptions: vi.fn((profile: string, overrides: Record<string, string[]> = {}) => ({
    stages: [{ duration: "30s", target: 1 }],
    thresholds: { http_req_duration: ["p(95)<2000"], ...overrides },
    maxDuration: "2m",
  })),
}));

import { createClientConfig, THINK } from "../../src/core/client-config";
import { profileToOptions } from "../../src/core/profile-loader";

describe("client-config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as Record<string, unknown>).__ENV = {};
  });

  describe("THINK constants", () => {
    it("should export think-time constants with correct values", () => {
      expect(THINK.AGGRESSIVE).toBe(0.1);
      expect(THINK.FAST).toBe(0.2);
      expect(THINK.NORMAL).toBe(0.3);
      expect(THINK.REALISTIC).toBe(0.5);
      expect(THINK.LONG).toBe(1.0);
    });

    it("should be a readonly object", () => {
      expect(Object.keys(THINK)).toEqual(["AGGRESSIVE", "FAST", "NORMAL", "REALISTIC", "LONG"]);
    });
  });

  describe("createClientConfig()", () => {
    it("should return an object with BASE_URL, scenarioOptions, scenarioTags, and THINK", () => {
      const helpers = createClientConfig({
        baseUrl: "https://api.example.com",
        baseTags: { client: "test-client", service: "api" },
      });

      expect(helpers.BASE_URL).toBe("https://api.example.com");
      expect(typeof helpers.scenarioOptions).toBe("function");
      expect(typeof helpers.scenarioTags).toBe("function");
      expect(helpers.THINK).toEqual(THINK);
    });

    it("should use the provided baseUrl", () => {
      const helpers = createClientConfig({
        baseUrl: "https://staging.example.com/v2",
        baseTags: { client: "acme" },
      });

      expect(helpers.BASE_URL).toBe("https://staging.example.com/v2");
    });
  });

  describe("scenarioTags()", () => {
    it("should merge base tags with scenario name", () => {
      const helpers = createClientConfig({
        baseUrl: "https://api.example.com",
        baseTags: { client: "acme", service: "payments" },
      });

      const tags = helpers.scenarioTags("login-flow");

      expect(tags).toEqual({
        client: "acme",
        service: "payments",
        scenario: "login-flow",
      });
    });

    it("should overwrite base tag if scenario key exists", () => {
      const helpers = createClientConfig({
        baseUrl: "https://api.example.com",
        baseTags: { scenario: "default" },
      });

      const tags = helpers.scenarioTags("custom-scenario");
      expect(tags.scenario).toBe("custom-scenario");
    });
  });

  describe("scenarioOptions()", () => {
    it("should call profileToOptions with the resolved profile", () => {
      const helpers = createClientConfig({
        baseUrl: "https://api.example.com",
        baseTags: { client: "test" },
        profileName: "load",
      });

      helpers.scenarioOptions("my-scenario");

      expect(profileToOptions).toHaveBeenCalledWith("load", {});
    });

    it("should pass threshold overrides to profileToOptions", () => {
      const helpers = createClientConfig({
        baseUrl: "https://api.example.com",
        baseTags: { client: "test" },
        profileName: "smoke",
      });

      const overrides = { http_req_duration: ["p(95)<500"] };
      helpers.scenarioOptions("my-scenario", overrides);

      expect(profileToOptions).toHaveBeenCalledWith("smoke", overrides);
    });

    it("should include tags in the returned options", () => {
      const helpers = createClientConfig({
        baseUrl: "https://api.example.com",
        baseTags: { client: "acme", service: "api" },
      });

      const opts = helpers.scenarioOptions("checkout");

      expect(opts.tags).toEqual({
        client: "acme",
        service: "api",
        scenario: "checkout",
      });
    });

    it("should spread profile options alongside tags", () => {
      const helpers = createClientConfig({
        baseUrl: "https://api.example.com",
        baseTags: { client: "test" },
      });

      const opts = helpers.scenarioOptions("test-scenario");

      expect(opts.stages).toBeDefined();
      expect(opts.thresholds).toBeDefined();
      expect(opts.tags).toBeDefined();
    });

    it("should default profile to 'smoke' if none provided", () => {
      const helpers = createClientConfig({
        baseUrl: "https://api.example.com",
        baseTags: { client: "test" },
      });

      helpers.scenarioOptions("s1");

      expect(profileToOptions).toHaveBeenCalledWith("smoke", {});
    });

    it("should use K6_PROFILE env var when profileName is not provided", () => {
      (globalThis as Record<string, unknown>).__ENV = { K6_PROFILE: "stress" };

      const helpers = createClientConfig({
        baseUrl: "https://api.example.com",
        baseTags: { client: "test" },
      });

      helpers.scenarioOptions("s1");

      expect(profileToOptions).toHaveBeenCalledWith("stress", {});
    });

    it("should prefer profileName over K6_PROFILE env var", () => {
      (globalThis as Record<string, unknown>).__ENV = { K6_PROFILE: "stress" };

      const helpers = createClientConfig({
        baseUrl: "https://api.example.com",
        baseTags: { client: "test" },
        profileName: "load",
      });

      helpers.scenarioOptions("s1");

      expect(profileToOptions).toHaveBeenCalledWith("load", {});
    });
  });
});
