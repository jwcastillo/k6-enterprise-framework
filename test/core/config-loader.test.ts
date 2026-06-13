import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getActiveConfig,
  buildOptions,
  buildClientConfig,
  validateEnvConfig,
  getSecret,
  buildTestConfig,
} from "../../src/core/config-loader";

// Access the global __ENV mock provided by setup.ts
declare const __ENV: Record<string, string>;

// Mock the profile-loader dependency
vi.mock("../../src/core/profile-loader", () => ({
  profileToOptions: vi.fn((profile: string, overrides: Record<string, string[]>) => ({
    stages: [{ duration: "30s", target: 1 }],
    thresholds: {
      http_req_duration: ["p(95)<2000"],
      ...overrides,
    },
    maxDuration: "2m",
  })),
}));

// Mock the secrets-manager dependency
vi.mock("../../src/core/secrets-manager", () => ({
  resolveSecretOr: vi.fn((key: string, fallback: string) => {
    const envVal = (globalThis as Record<string, unknown>).__ENV as Record<string, string>;
    return envVal[key] ?? fallback;
  }),
}));

describe("ConfigLoader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset __ENV to a clean state
    for (const key of Object.keys(__ENV)) {
      delete __ENV[key];
    }
  });

  // ── getActiveConfig ─────────────────────────────────────────────────────

  describe("getActiveConfig()", () => {
    it("should return defaults when no env vars are set", () => {
      const config = getActiveConfig();
      expect(config.client).toBe("_reference");
      expect(config.env).toBe("default");
      expect(config.profile).toBe("smoke");
    });

    it("should read client from K6_CLIENT env var", () => {
      __ENV["K6_CLIENT"] = "my-team";
      const config = getActiveConfig();
      expect(config.client).toBe("my-team");
    });

    it("should read environment from K6_ENV env var", () => {
      __ENV["K6_ENV"] = "production";
      const config = getActiveConfig();
      expect(config.env).toBe("production");
    });

    it("should read profile from K6_PROFILE env var", () => {
      __ENV["K6_PROFILE"] = "load";
      const config = getActiveConfig();
      expect(config.profile).toBe("load");
    });

    it("should handle all env vars set simultaneously", () => {
      __ENV["K6_CLIENT"] = "acme";
      __ENV["K6_ENV"] = "staging";
      __ENV["K6_PROFILE"] = "stress";
      const config = getActiveConfig();
      expect(config.client).toBe("acme");
      expect(config.env).toBe("staging");
      expect(config.profile).toBe("stress");
    });
  });

  // ── buildOptions ────────────────────────────────────────────────────────

  describe("buildOptions()", () => {
    it("should return options with tags from active config", () => {
      __ENV["K6_CLIENT"] = "my-team";
      __ENV["K6_ENV"] = "staging";
      __ENV["K6_PROFILE"] = "smoke";

      const options = buildOptions();
      expect(options.tags).toBeDefined();

      const tags = options.tags as Record<string, string>;
      expect(tags.client).toBe("my-team");
      expect(tags.environment).toBe("staging");
      expect(tags.profile).toBe("smoke");
      expect(tags.test_timestamp).toBeDefined();
    });

    it("should include profile options from profileToOptions", () => {
      const options = buildOptions();
      expect(options.stages).toBeDefined();
      expect(options.thresholds).toBeDefined();
    });

    it("should pass threshold overrides through", () => {
      const overrides = { custom_metric: ["p(95)<100"] };
      const options = buildOptions(overrides);
      const thresholds = options.thresholds as Record<string, string[]>;
      expect(thresholds.custom_metric).toEqual(["p(95)<100"]);
    });

    it("should use default values when env vars not set", () => {
      const options = buildOptions();
      const tags = options.tags as Record<string, string>;
      expect(tags.client).toBe("_reference");
      expect(tags.environment).toBe("default");
      expect(tags.profile).toBe("smoke");
    });
  });

  // ── buildClientConfig ───────────────────────────────────────────────────

  describe("buildClientConfig()", () => {
    it("should build a config with the provided baseUrl", () => {
      __ENV["K6_CLIENT"] = "my-team";
      __ENV["K6_ENV"] = "staging";

      const config = buildClientConfig("https://api.example.com");
      expect(config.client).toBe("my-team");
      expect(config.version).toBe("0.1.0");
      expect(config.environment).toBe("staging");
      expect(config.endpoints.api.baseUrl).toBe("https://api.example.com");
      expect(config.tags).toEqual({
        client: "my-team",
        environment: "staging",
      });
    });

    it("should apply overrides", () => {
      const config = buildClientConfig("https://api.example.com", {
        version: "2.0.0",
      });
      expect(config.version).toBe("2.0.0");
    });

    it("should use default client and env when not set", () => {
      const config = buildClientConfig("https://api.example.com");
      expect(config.client).toBe("_reference");
      expect(config.environment).toBe("default");
    });

    it("should allow overriding endpoints", () => {
      const config = buildClientConfig("https://api.example.com", {
        endpoints: {
          custom: { baseUrl: "https://custom.example.com" },
        },
      });
      expect(config.endpoints.custom.baseUrl).toBe("https://custom.example.com");
    });
  });

  // ── validateEnvConfig ────────────────────────────────────────────────────

  describe("validateEnvConfig()", () => {
    it("should warn when required env vars are missing", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      validateEnvConfig();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("missing recommended env vars"),
      );
      warnSpy.mockRestore();
    });

    it("should warn listing all missing vars", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      validateEnvConfig();

      const message = warnSpy.mock.calls[0]?.[0] as string;
      expect(message).toContain("K6_CLIENT");
      expect(message).toContain("K6_PROFILE");
      expect(message).toContain("K6_ENV");
      warnSpy.mockRestore();
    });

    it("should not warn when all env vars are set", () => {
      __ENV["K6_CLIENT"] = "my-team";
      __ENV["K6_PROFILE"] = "smoke";
      __ENV["K6_ENV"] = "staging";

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      validateEnvConfig();

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("should warn when only some env vars are missing", () => {
      __ENV["K6_CLIENT"] = "my-team";
      // K6_PROFILE and K6_ENV are missing

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      validateEnvConfig();

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const message = warnSpy.mock.calls[0]?.[0] as string;
      expect(message).not.toContain("K6_CLIENT");
      expect(message).toContain("K6_PROFILE");
      expect(message).toContain("K6_ENV");
      warnSpy.mockRestore();
    });
  });

  // ── getSecret ──────────────────────────────────────────────────────────

  describe("getSecret()", () => {
    it("should resolve a secret from env", () => {
      __ENV["MY_TOKEN"] = "token-value";
      const result = getSecret("MY_TOKEN");
      expect(result).toBe("token-value");
    });

    it("should return fallback when secret is not found", () => {
      const result = getSecret("MISSING_KEY", "fallback-val");
      expect(result).toBe("fallback-val");
    });

    it("should return empty string as default fallback", () => {
      const result = getSecret("MISSING_KEY");
      expect(result).toBe("");
    });
  });

  // ── buildTestConfig ────────────────────────────────────────────────────

  describe("buildTestConfig()", () => {
    it("should build test config from env and script name", () => {
      __ENV["K6_CLIENT"] = "my-team";
      __ENV["K6_ENV"] = "staging";
      __ENV["K6_PROFILE"] = "load";

      const config = buildTestConfig("scenarios/auth/login.ts");
      expect(config.name).toBe("scenarios/auth/login.ts");
      expect(config.script).toBe("scenarios/auth/login.ts");
      expect(config.client).toBe("my-team");
      expect(config.environment).toBe("staging");
      expect(config.profile).toBe("load");
      expect(config.tags).toEqual({
        client: "my-team",
        environment: "staging",
        profile: "load",
      });
    });

    it("should use K6_TEST_NAME when set", () => {
      __ENV["K6_TEST_NAME"] = "Custom Test Name";

      const config = buildTestConfig("script.ts");
      expect(config.name).toBe("Custom Test Name");
      expect(config.script).toBe("script.ts");
    });

    it("should fall back to script name when K6_TEST_NAME not set", () => {
      const config = buildTestConfig("my-script.ts");
      expect(config.name).toBe("my-script.ts");
    });

    it("should apply overrides", () => {
      const config = buildTestConfig("script.ts", {
        description: "A custom test",
        thresholds: { http_req_duration: ["p(95)<500"] },
      });
      expect(config.description).toBe("A custom test");
      expect(config.thresholds).toEqual({ http_req_duration: ["p(95)<500"] });
    });

    it("should use defaults when no env vars set", () => {
      const config = buildTestConfig("test.ts");
      expect(config.client).toBe("_reference");
      expect(config.environment).toBe("default");
      expect(config.profile).toBe("smoke");
    });
  });
});
