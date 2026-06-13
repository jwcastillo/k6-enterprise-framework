import { describe, it, expect, vi, beforeEach } from "vitest";

// Track the last-created mock post function so we can control per-test
let mockPostFn: ReturnType<typeof vi.fn>;

// Mock the RequestHelper and StructuredLogger dependencies
vi.mock("../../src/helpers/request-helper", () => {
  class MockRequestHelper {
    get = vi.fn();
    post: ReturnType<typeof vi.fn>;
    put = vi.fn();
    patch = vi.fn();
    delete = vi.fn();
    constructor(_baseUrl: string, _opts?: unknown) {
      // Each instance gets the current mockPostFn
      this.post = mockPostFn;
    }
  }
  return {
    RequestHelper: MockRequestHelper,
  };
});

vi.mock("../../src/helpers/structured-logger", () => {
  class MockStructuredLogger {
    logEvent = vi.fn();
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
    constructor(_opts?: unknown) {}
  }
  return {
    StructuredLogger: MockStructuredLogger,
  };
});

import {
  authenticate,
  isSessionValid,
  sessionRequestOptions,
  AuthSession,
} from "../../src/patterns/auth-pattern";

function makeMockResponse(status: number, body: Record<string, unknown>) {
  const bodyStr = JSON.stringify(body);
  return {
    status,
    body: bodyStr,
    headers: {},
    timings: { duration: 50, waiting: 40, receiving: 5, sending: 5 },
    json: vi.fn((selector?: string) => {
      if (!selector) return body;
      const parts = selector.split(".");
      let val: unknown = body;
      for (const part of parts) {
        if (val == null || typeof val !== "object") return null;
        val = (val as Record<string, unknown>)[part];
      }
      return val ?? null;
    }),
  };
}

describe("auth-pattern", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to a default mock post
    mockPostFn = vi.fn();
  });

  // ── authenticate: bearer ──────────────────────────────────────────────

  describe("authenticate - bearer", () => {
    it("performs login and returns session with token", () => {
      const mockResponse = makeMockResponse(200, {
        access_token: "jwt-token-123",
      });
      mockPostFn = vi.fn(() => mockResponse);

      const session = authenticate({
        type: "bearer",
        loginUrl: "/auth/login",
        username: "user",
        password: "pass",
        baseUrl: "http://api.test",
      });

      expect(session.type).toBe("bearer");
      expect(session.token).toBe("jwt-token-123");
      expect(session.credentials).toEqual({ token: "jwt-token-123" });
      expect(session.client).toBeDefined();
    });

    it("uses custom tokenPath", () => {
      const mockResponse = makeMockResponse(200, {
        auth: { jwt: "custom-path-token" },
      });
      mockPostFn = vi.fn(() => mockResponse);

      const session = authenticate({
        type: "bearer",
        loginUrl: "/auth/login",
        username: "user",
        password: "pass",
        tokenPath: "auth.jwt",
        baseUrl: "http://api.test",
      });

      expect(session.token).toBe("custom-path-token");
    });

    it("throws when login returns non-200/201 status", () => {
      const mockResponse = makeMockResponse(401, { error: "Unauthorized" });
      mockPostFn = vi.fn(() => mockResponse);

      expect(() =>
        authenticate({
          type: "bearer",
          loginUrl: "/auth/login",
          username: "user",
          password: "pass",
          baseUrl: "http://api.test",
        })
      ).toThrow("AuthPattern[bearer]: login failed");
    });

    it("throws when token not found at path", () => {
      const mockResponse = makeMockResponse(200, { other_field: "value" });
      mockPostFn = vi.fn(() => mockResponse);

      expect(() =>
        authenticate({
          type: "bearer",
          loginUrl: "/auth/login",
          username: "user",
          password: "pass",
          baseUrl: "http://api.test",
        })
      ).toThrow("AuthPattern[bearer]: token not found at path 'access_token'");
    });

    it("accepts 201 status as successful login", () => {
      const mockResponse = makeMockResponse(201, {
        access_token: "token-201",
      });
      mockPostFn = vi.fn(() => mockResponse);

      const session = authenticate({
        type: "bearer",
        loginUrl: "/auth/login",
        username: "user",
        password: "pass",
        baseUrl: "http://api.test",
      });

      expect(session.token).toBe("token-201");
    });
  });

  // ── authenticate: basic ──────────────────────────────────────────────

  describe("authenticate - basic", () => {
    it("returns session with credentials, no login request", () => {
      const session = authenticate({
        type: "basic",
        username: "admin",
        password: "secret",
        baseUrl: "http://api.test",
      });

      expect(session.type).toBe("basic");
      expect(session.token).toBeUndefined();
      expect(session.credentials).toEqual({
        username: "admin",
        password: "secret",
      });
      expect(session.client).toBeDefined();
    });
  });

  // ── authenticate: oauth2 ──────────────────────────────────────────────

  describe("authenticate - oauth2", () => {
    it("performs client credentials flow and returns session", () => {
      const mockResponse = makeMockResponse(200, {
        access_token: "oauth-token-xyz",
        expires_in: 3600,
      });
      mockPostFn = vi.fn(() => mockResponse);

      const session = authenticate({
        type: "oauth2",
        tokenUrl: "http://auth.test/token",
        clientId: "my-client",
        clientSecret: "my-secret",
        scope: "read write",
        baseUrl: "http://api.test",
      });

      expect(session.type).toBe("oauth2");
      expect(session.token).toBe("oauth-token-xyz");
      expect(session.credentials).toEqual({ accessToken: "oauth-token-xyz" });
      expect(session.expiresAt).toBeDefined();
      expect(session.expiresAt!).toBeGreaterThan(Date.now());
    });

    it("throws when token endpoint returns non-200", () => {
      const mockResponse = makeMockResponse(400, {
        error: "invalid_client",
      });
      mockPostFn = vi.fn(() => mockResponse);

      expect(() =>
        authenticate({
          type: "oauth2",
          tokenUrl: "http://auth.test/token",
          clientId: "bad-client",
          clientSecret: "bad-secret",
          baseUrl: "http://api.test",
        })
      ).toThrow("AuthPattern[oauth2]: token request failed");
    });

    it("throws when access_token is missing from response", () => {
      const mockResponse = makeMockResponse(200, {
        token_type: "bearer",
      });
      mockPostFn = vi.fn(() => mockResponse);

      expect(() =>
        authenticate({
          type: "oauth2",
          tokenUrl: "http://auth.test/token",
          clientId: "client",
          clientSecret: "secret",
          baseUrl: "http://api.test",
        })
      ).toThrow("AuthPattern[oauth2]: access_token not found in response");
    });

    it("defaults expires_in to 3600 when not in response", () => {
      const mockResponse = makeMockResponse(200, {
        access_token: "token-no-exp",
      });
      mockPostFn = vi.fn(() => mockResponse);

      const before = Date.now();
      const session = authenticate({
        type: "oauth2",
        tokenUrl: "http://auth.test/token",
        clientId: "client",
        clientSecret: "secret",
        baseUrl: "http://api.test",
      });

      expect(session.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000);
    });
  });

  // ── authenticate: apikey ──────────────────────────────────────────────

  describe("authenticate - apikey", () => {
    it("returns session with API key credentials", () => {
      const session = authenticate({
        type: "apikey",
        apiKey: "key-abc-123",
        baseUrl: "http://api.test",
      });

      expect(session.type).toBe("apikey");
      expect(session.credentials).toEqual({
        key: "key-abc-123",
        header: "X-API-Key",
      });
      expect(session.client).toBeDefined();
    });

    it("uses custom header name", () => {
      const session = authenticate({
        type: "apikey",
        apiKey: "key-custom",
        header: "Authorization",
        baseUrl: "http://api.test",
      });

      expect(session.credentials).toEqual({
        key: "key-custom",
        header: "Authorization",
      });
    });
  });

  // ── authenticate: unknown type ──────────────────────────────────────

  describe("authenticate - unknown type", () => {
    it("throws for unsupported auth type", () => {
      expect(() =>
        authenticate({ type: "unknown" as "bearer", baseUrl: "http://api.test" } as never)
      ).toThrow("AuthPattern: unsupported auth type");
    });
  });

  // ── isSessionValid ──────────────────────────────────────────────────

  describe("isSessionValid", () => {
    it("returns true when no expiresAt is set", () => {
      const session: AuthSession = {
        type: "basic",
        credentials: { username: "user" },
        client: {} as never,
      };
      expect(isSessionValid(session)).toBe(true);
    });

    it("returns true when token has not expired (with 30s buffer)", () => {
      const session: AuthSession = {
        type: "bearer",
        token: "tok",
        credentials: { token: "tok" },
        expiresAt: Date.now() + 60_000, // 60s from now
        client: {} as never,
      };
      expect(isSessionValid(session)).toBe(true);
    });

    it("returns false when token is within 30s of expiry", () => {
      const session: AuthSession = {
        type: "bearer",
        token: "tok",
        credentials: { token: "tok" },
        expiresAt: Date.now() + 20_000, // 20s from now, within 30s buffer
        client: {} as never,
      };
      expect(isSessionValid(session)).toBe(false);
    });

    it("returns false when token has already expired", () => {
      const session: AuthSession = {
        type: "bearer",
        token: "tok",
        credentials: { token: "tok" },
        expiresAt: Date.now() - 1000, // already expired
        client: {} as never,
      };
      expect(isSessionValid(session)).toBe(false);
    });
  });

  // ── sessionRequestOptions ──────────────────────────────────────────

  describe("sessionRequestOptions", () => {
    it("returns RequestOptions with auth type and credentials", () => {
      const session: AuthSession = {
        type: "bearer",
        token: "my-token",
        credentials: { token: "my-token" },
        client: {} as never,
      };

      const opts = sessionRequestOptions(session);
      expect(opts).toEqual({
        authType: "bearer",
        credentials: { token: "my-token" },
      });
    });

    it("works for basic auth sessions", () => {
      const session: AuthSession = {
        type: "basic",
        credentials: { username: "admin", password: "pass" },
        client: {} as never,
      };

      const opts = sessionRequestOptions(session);
      expect(opts).toEqual({
        authType: "basic",
        credentials: { username: "admin", password: "pass" },
      });
    });
  });
});
