import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  resolvePyroscopeConfig,
  buildPyroscopeHeader,
  withPyroscopeLabels,
  logPyroscopeStatus,
  PyroscopeConfig,
  PyroscopeHealthResult,
} from "../../src/observability/pyroscope-instrumentation";
import { checkPyroscopeHealth } from "@node/pyroscope-node";

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<PyroscopeConfig> = {}): PyroscopeConfig {
  return {
    enabled: true,
    endpoint: "http://localhost:4040",
    appName: "k6-acme.load",
    labels: {
      client: "acme",
      profile: "load",
      environment: "staging",
      test: "checkout-flow",
    },
    ...overrides,
  };
}

function makeHealthResult(overrides: Partial<PyroscopeHealthResult> = {}): PyroscopeHealthResult {
  return {
    reachable: true,
    latencyMs: 15,
    ...overrides,
  };
}

// ── resolvePyroscopeConfig ───────────────────────────────────────────────────

describe("resolvePyroscopeConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves enabled=true from K6_PYROSCOPE_ENABLED=true", () => {
    const config = resolvePyroscopeConfig({ K6_PYROSCOPE_ENABLED: "true" });
    expect(config.enabled).toBe(true);
  });

  it("resolves enabled=false when K6_PYROSCOPE_ENABLED is not set", () => {
    const config = resolvePyroscopeConfig({});
    expect(config.enabled).toBe(false);
  });

  it("resolves enabled=false for any value other than 'true'", () => {
    const config = resolvePyroscopeConfig({ K6_PYROSCOPE_ENABLED: "false" });
    expect(config.enabled).toBe(false);
  });

  it("uses K6_PYROSCOPE_ENDPOINT when set", () => {
    const config = resolvePyroscopeConfig({
      K6_PYROSCOPE_ENDPOINT: "http://pyroscope:4040",
    });
    expect(config.endpoint).toBe("http://pyroscope:4040");
  });

  it("falls back to PYROSCOPE_ENDPOINT", () => {
    const config = resolvePyroscopeConfig({
      PYROSCOPE_ENDPOINT: "http://pyroscope-alt:4040",
    });
    expect(config.endpoint).toBe("http://pyroscope-alt:4040");
  });

  it("defaults endpoint to http://localhost:4040", () => {
    const config = resolvePyroscopeConfig({});
    expect(config.endpoint).toBe("http://localhost:4040");
  });

  it("builds appName from K6_CLIENT and K6_PROFILE", () => {
    const config = resolvePyroscopeConfig({
      K6_CLIENT: "acme",
      K6_PROFILE: "load",
    });
    expect(config.appName).toBe("k6-acme.load");
  });

  it("uses default appName when env vars not set", () => {
    const config = resolvePyroscopeConfig({});
    expect(config.appName).toBe("k6-framework.smoke");
  });

  it("builds labels from env vars", () => {
    const config = resolvePyroscopeConfig({
      K6_CLIENT: "acme",
      K6_PROFILE: "stress",
      K6_ENV: "production",
      K6_TEST_NAME: "checkout",
    });
    expect(config.labels.client).toBe("acme");
    expect(config.labels.profile).toBe("stress");
    expect(config.labels.environment).toBe("production");
    expect(config.labels.test).toBe("checkout");
  });

  it("uses 'unknown'/'default'/'smoke' defaults for labels", () => {
    const config = resolvePyroscopeConfig({});
    expect(config.labels.client).toBe("unknown");
    expect(config.labels.profile).toBe("smoke");
    expect(config.labels.environment).toBe("default");
    expect(config.labels.test).toBe("unknown");
  });

  it("prefers K6_PYROSCOPE_ENDPOINT over PYROSCOPE_ENDPOINT", () => {
    const config = resolvePyroscopeConfig({
      K6_PYROSCOPE_ENDPOINT: "http://primary:4040",
      PYROSCOPE_ENDPOINT: "http://fallback:4040",
    });
    expect(config.endpoint).toBe("http://primary:4040");
  });
});

// ── buildPyroscopeHeader ─────────────────────────────────────────────────────

describe("buildPyroscopeHeader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds header with appName and labels", () => {
    const config = makeConfig();
    const header = buildPyroscopeHeader(config);
    expect(header).toContain("k6-acme.load");
    expect(header).toContain("client=acme");
    expect(header).toContain("profile=load");
    expect(header).toContain("environment=staging");
    expect(header).toContain("test=checkout-flow");
  });

  it("formats as appName{key=value,key=value}", () => {
    const config = makeConfig({
      appName: "test-app",
      labels: { key1: "val1", key2: "val2" },
    });
    const header = buildPyroscopeHeader(config);
    expect(header).toMatch(/^test-app\{.*\}$/);
    expect(header).toContain("key1=val1");
    expect(header).toContain("key2=val2");
  });

  it("handles empty labels", () => {
    const config = makeConfig({ labels: {} });
    const header = buildPyroscopeHeader(config);
    expect(header).toContain("k6-acme.load{}");
  });

  it("handles single label", () => {
    const config = makeConfig({ labels: { env: "prod" } });
    const header = buildPyroscopeHeader(config);
    expect(header).toBe("k6-acme.load{env=prod}");
  });
});

// ── withPyroscopeLabels ──────────────────────────────────────────────────────

describe("withPyroscopeLabels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns base params unchanged when config is disabled", () => {
    const config = makeConfig({ enabled: false });
    const baseParams = { headers: { Authorization: "Bearer token" }, timeout: "30s" };
    const result = withPyroscopeLabels(baseParams, config);
    expect(result).toBe(baseParams); // exact same object
  });

  it("adds X-Pyroscope-App-Name header when enabled", () => {
    const config = makeConfig({ enabled: true });
    const result = withPyroscopeLabels({}, config);
    const headers = result.headers as Record<string, string>;
    expect(headers["X-Pyroscope-App-Name"]).toBeDefined();
    expect(headers["X-Pyroscope-App-Name"]).toContain("k6-acme.load");
  });

  it("preserves existing headers", () => {
    const config = makeConfig({ enabled: true });
    const result = withPyroscopeLabels(
      { headers: { Authorization: "Bearer test", "Content-Type": "application/json" } },
      config
    );
    const headers = result.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Pyroscope-App-Name"]).toBeDefined();
  });

  it("preserves non-header params", () => {
    const config = makeConfig({ enabled: true });
    const result = withPyroscopeLabels(
      { tags: { scenario: "checkout" }, timeout: "10s" },
      config
    );
    expect(result.tags).toEqual({ scenario: "checkout" });
    expect(result.timeout).toBe("10s");
  });

  it("handles base params with no headers", () => {
    const config = makeConfig({ enabled: true });
    const result = withPyroscopeLabels({ tags: { test: "1" } }, config);
    const headers = result.headers as Record<string, string>;
    expect(headers["X-Pyroscope-App-Name"]).toBeDefined();
  });

  it("does not modify the original params object", () => {
    const config = makeConfig({ enabled: true });
    const original = { headers: { Auth: "Bearer" } };
    const result = withPyroscopeLabels(original, config);
    expect(result).not.toBe(original);
    expect((original.headers as Record<string, string>)["X-Pyroscope-App-Name"]).toBeUndefined();
  });
});

// ── checkPyroscopeHealth ─────────────────────────────────────────────────────

describe("checkPyroscopeHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns reachable=false for invalid URL", async () => {
    const result = await checkPyroscopeHealth("not-a-url");
    expect(result.reachable).toBe(false);
    expect(result.error).toContain("Invalid endpoint URL");
  });

  it("returns reachable=false on connection error", async () => {
    // Using a port that's very unlikely to be open
    const result = await checkPyroscopeHealth("http://127.0.0.1:19999");
    expect(result.reachable).toBe(false);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("returns a latencyMs value", async () => {
    const result = await checkPyroscopeHealth("http://127.0.0.1:19999");
    expect(typeof result.latencyMs).toBe("number");
  });
});

// ── logPyroscopeStatus ───────────────────────────────────────────────────────

describe("logPyroscopeStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs disabled message when config is disabled", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const config = makeConfig({ enabled: false });
    logPyroscopeStatus(config, makeHealthResult());
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Profiling disabled")
    );
    consoleSpy.mockRestore();
  });

  it("logs connected message when reachable", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const config = makeConfig({ enabled: true });
    const health = makeHealthResult({ reachable: true, latencyMs: 10 });
    logPyroscopeStatus(config, health);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Connected to")
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("10ms")
    );
    consoleSpy.mockRestore();
  });

  it("logs warning when unreachable", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = makeConfig({ enabled: true });
    const health = makeHealthResult({ reachable: false, error: "timeout" });
    logPyroscopeStatus(config, health);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Unreachable")
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("timeout")
    );
    consoleSpy.mockRestore();
  });

  it("includes appName and labels in connected log", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const config = makeConfig({
      enabled: true,
      appName: "k6-test.smoke",
      labels: { client: "test" },
    });
    logPyroscopeStatus(config, makeHealthResult());
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("k6-test.smoke")
    );
    consoleSpy.mockRestore();
  });

  it("includes 'unknown error' fallback when no error message", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = makeConfig({ enabled: true });
    const health = makeHealthResult({ reachable: false, error: undefined });
    logPyroscopeStatus(config, health);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("unknown error")
    );
    consoleSpy.mockRestore();
  });
});
