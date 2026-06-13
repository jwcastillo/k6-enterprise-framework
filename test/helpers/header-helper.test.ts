import { describe, it, expect, beforeEach } from "vitest";
import { HeaderHelper } from "../../src/helpers/header-helper";

declare const __ENV: Record<string, string>;

beforeEach(() => {
  // Reset __ENV before each test
  for (const key of Object.keys(__ENV)) {
    delete __ENV[key];
  }
});

// ── tracing ─────────────────────────────────────────────────────────────────
describe("HeaderHelper.tracing", () => {
  it("returns three unique trace headers", () => {
    const headers = HeaderHelper.tracing();
    expect(headers["X-Correlation-ID"]).toBeDefined();
    expect(headers["X-Trace-ID"]).toBeDefined();
    expect(headers["X-Request-ID"]).toBeDefined();
  });

  it("generates UUID-like format", () => {
    const headers = HeaderHelper.tracing();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(headers["X-Correlation-ID"]).toMatch(uuidRegex);
    expect(headers["X-Trace-ID"]).toMatch(uuidRegex);
    expect(headers["X-Request-ID"]).toMatch(uuidRegex);
  });

  it("all three IDs are different", () => {
    const headers = HeaderHelper.tracing();
    const ids = new Set([
      headers["X-Correlation-ID"],
      headers["X-Trace-ID"],
      headers["X-Request-ID"],
    ]);
    expect(ids.size).toBe(3);
  });
});

// ── auth ────────────────────────────────────────────────────────────────────
describe("HeaderHelper.auth", () => {
  it("builds bearer auth header", () => {
    const headers = HeaderHelper.auth("bearer", { token: "abc123" });
    expect(headers.Authorization).toBe("Bearer abc123");
  });

  it("builds basic auth header with btoa encoding", () => {
    const headers = HeaderHelper.auth("basic", { username: "user", password: "pass" });
    const expected = `Basic ${btoa("user:pass")}`;
    expect(headers.Authorization).toBe(expected);
  });

  it("builds oauth2 auth header", () => {
    const headers = HeaderHelper.auth("oauth2", { accessToken: "oauth-token" });
    expect(headers.Authorization).toBe("Bearer oauth-token");
  });

  it("builds apikey header with custom header name", () => {
    const headers = HeaderHelper.auth("apikey", { header: "X-Custom-Key", key: "mykey" });
    expect((headers as Record<string, string>)["X-Custom-Key"]).toBe("mykey");
  });

  it("builds apikey header with default header name", () => {
    const headers = HeaderHelper.auth("apikey", { key: "mykey" });
    expect((headers as Record<string, string>)["X-API-Key"]).toBe("mykey");
  });

  it("returns empty object for none auth", () => {
    expect(HeaderHelper.auth("none", {})).toEqual({});
  });
});

// ── localization ────────────────────────────────────────────────────────────
describe("HeaderHelper.localization", () => {
  it("sets Accept-Language with default", () => {
    const headers = HeaderHelper.localization();
    expect(headers["Accept-Language"]).toBe("en-US");
  });

  it("sets custom language", () => {
    const headers = HeaderHelper.localization("es-CL");
    expect(headers["Accept-Language"]).toBe("es-CL");
  });

  it("sets country when provided", () => {
    const headers = HeaderHelper.localization("es-CL", "CL");
    expect(headers["X-Country"]).toBe("CL");
  });

  it("omits country when not provided", () => {
    const headers = HeaderHelper.localization("en-US");
    expect(headers["X-Country"]).toBeUndefined();
  });
});

// ── userAgent ───────────────────────────────────────────────────────────────
describe("HeaderHelper.userAgent", () => {
  it("returns User-Agent with framework version", () => {
    const headers = HeaderHelper.userAgent();
    expect(headers["User-Agent"]).toMatch(/k6-enterprise-framework\/\d+\.\d+\.\d+ k6/);
  });
});

// ── instrumentation ─────────────────────────────────────────────────────────
describe("HeaderHelper.instrumentation", () => {
  it("returns empty when tracing is not enabled", () => {
    const headers = HeaderHelper.instrumentation();
    expect(Object.keys(headers)).toHaveLength(0);
  });

  it("generates w3c traceparent by default when enabled", () => {
    __ENV["K6_TEMPO_ENABLED"] = "true";
    const headers = HeaderHelper.instrumentation();
    expect(headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it("generates b3 header when propagation is b3", () => {
    __ENV["K6_TEMPO_ENABLED"] = "true";
    __ENV["K6_TEMPO_PROPAGATION"] = "b3";
    const headers = HeaderHelper.instrumentation();
    expect((headers as Record<string, string>)["b3"]).toMatch(/^[0-9a-f]{32}-[0-9a-f]{16}-1$/);
  });

  it("generates jaeger uber-trace-id when propagation is jaeger", () => {
    __ENV["K6_TEMPO_ENABLED"] = "true";
    __ENV["K6_TEMPO_PROPAGATION"] = "jaeger";
    const headers = HeaderHelper.instrumentation();
    expect((headers as Record<string, string>)["uber-trace-id"]).toMatch(
      /^[0-9a-f]{32}:[0-9a-f]{16}:0:1$/
    );
  });

  it("uses provided traceId", () => {
    __ENV["K6_TEMPO_ENABLED"] = "true";
    const headers = HeaderHelper.instrumentation("aabbccdd11223344");
    expect(headers.traceparent).toContain("aabbccdd11223344");
  });

  it("throws on unsupported propagation", () => {
    __ENV["K6_TEMPO_ENABLED"] = "true";
    __ENV["K6_TEMPO_PROPAGATION"] = "invalid";
    expect(() => HeaderHelper.instrumentation()).toThrow("Unsupported propagation");
  });

  it("adds Pyroscope labels when enabled", () => {
    __ENV["K6_PYROSCOPE_ENABLED"] = "true";
    const headers = HeaderHelper.instrumentation();
    expect(headers["X-Pyroscope-Labels"]).toBe("k6_test=true");
  });

  it("adds client label to Pyroscope when K6_CLIENT is set", () => {
    __ENV["K6_PYROSCOPE_ENABLED"] = "true";
    __ENV["K6_CLIENT"] = "my-client";
    const headers = HeaderHelper.instrumentation();
    expect(headers["X-Pyroscope-Labels"]).toBe("k6_test=true,client=my-client");
  });
});

// ── standard ────────────────────────────────────────────────────────────────
describe("HeaderHelper.standard", () => {
  it("merges all header types", () => {
    const headers = HeaderHelper.standard("bearer", { token: "tk" });
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Accept"]).toBe("application/json");
    expect(headers["Authorization"]).toBe("Bearer tk");
    expect(headers["User-Agent"]).toContain("k6-enterprise-framework");
    expect(headers["X-Correlation-ID"]).toBeDefined();
    expect(headers["X-Trace-ID"]).toBeDefined();
    expect(headers["X-Request-ID"]).toBeDefined();
  });
});
