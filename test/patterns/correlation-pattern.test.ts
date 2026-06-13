import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  extractFromResponse,
  interpolate,
  mergeWithExtracted,
} from "../../src/patterns/correlation-pattern";
import { SafeResponse } from "../../src/helpers/request-helper";

function makeSafeResponse(overrides: Partial<SafeResponse> = {}): SafeResponse {
  const body = overrides.body ?? '{"data":{"id":"abc-123","name":"test"}}';
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    // body is not JSON — parsed stays null
  }

  return {
    status: 200,
    body,
    headers: { "x-request-id": "req-456", "Content-Type": "application/json" },
    timings: { duration: 50, waiting: 40, receiving: 5, sending: 5 },
    json: vi.fn((selector?: string) => {
      if (parsed === null) return null;
      if (!selector) return parsed;
      const parts = selector.split(".");
      let val: unknown = parsed;
      for (const part of parts) {
        if (val == null || typeof val !== "object") return null;
        val = (val as Record<string, unknown>)[part];
      }
      return val ?? null;
    }),
    ...overrides,
  };
}

describe("correlation-pattern", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── extractFromResponse ──────────────────────────────────────────────────

  describe("extractFromResponse", () => {
    it("extracts value via jsonPath", () => {
      const response = makeSafeResponse();
      const result = extractFromResponse(response, [{ name: "userId", jsonPath: "data.id" }]);

      expect(result.userId).toBe("abc-123");
    });

    it("extracts value via header", () => {
      const response = makeSafeResponse();
      const result = extractFromResponse(response, [{ name: "requestId", header: "x-request-id" }]);

      expect(result.requestId).toBe("req-456");
    });

    it("extracts value via header (case-insensitive fallback)", () => {
      const response = makeSafeResponse({
        headers: { "X-Custom": "value123" } as Record<string, string>,
      });
      const result = extractFromResponse(response, [{ name: "custom", header: "X-Custom" }]);

      expect(result.custom).toBe("value123");
    });

    it("extracts value via regex with capture group", () => {
      const response = makeSafeResponse({
        body: 'token="abc-secret-token-xyz"',
      });
      const result = extractFromResponse(response, [{ name: "token", regex: 'token="([^"]+)"' }]);

      expect(result.token).toBe("abc-secret-token-xyz");
    });

    it("returns null for missing jsonPath value (optional)", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const response = makeSafeResponse();
      const result = extractFromResponse(response, [
        { name: "missing", jsonPath: "data.nonexistent" },
      ]);

      expect(result.missing).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        "CorrelationPattern: optional value 'missing' not found"
      );
    });

    it("returns null for missing header (optional)", () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const response = makeSafeResponse();
      const result = extractFromResponse(response, [{ name: "missing", header: "X-NonExistent" }]);

      expect(result.missing).toBeNull();
    });

    it("returns null for non-matching regex (optional)", () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const response = makeSafeResponse({ body: "no match here" });
      const result = extractFromResponse(response, [{ name: "nope", regex: "secret=(\\w+)" }]);

      expect(result.nope).toBeNull();
    });

    it("throws when required jsonPath value is missing", () => {
      const response = makeSafeResponse();
      expect(() =>
        extractFromResponse(response, [
          { name: "critical", jsonPath: "data.nonexistent", required: true },
        ])
      ).toThrow("CorrelationPattern: required value 'critical' not found in response");
    });

    it("throws when required header is missing", () => {
      const response = makeSafeResponse();
      expect(() =>
        extractFromResponse(response, [
          { name: "authToken", header: "X-Missing-Header", required: true },
        ])
      ).toThrow("CorrelationPattern: required value 'authToken' not found in response");
    });

    it("throws when required regex does not match", () => {
      const response = makeSafeResponse({ body: "nope" });
      expect(() =>
        extractFromResponse(response, [
          { name: "sessionId", regex: "session=(\\w+)", required: true },
        ])
      ).toThrow("CorrelationPattern: required value 'sessionId' not found in response");
    });

    it("extracts multiple values in a single call", () => {
      const response = makeSafeResponse();
      const result = extractFromResponse(response, [
        { name: "id", jsonPath: "data.id" },
        { name: "name", jsonPath: "data.name" },
        { name: "reqId", header: "x-request-id" },
      ]);

      expect(result.id).toBe("abc-123");
      expect(result.name).toBe("test");
      expect(result.reqId).toBe("req-456");
    });

    it("converts non-string jsonPath values to string", () => {
      const response = makeSafeResponse({
        body: '{"count":42}',
      });
      // Override json to return number
      response.json = vi.fn((selector?: string) => {
        if (selector === "count") return 42;
        return JSON.parse(response.body);
      }) as SafeResponse["json"];

      const result = extractFromResponse(response, [{ name: "count", jsonPath: "count" }]);

      expect(result.count).toBe("42");
    });

    it("handles empty rules array", () => {
      const response = makeSafeResponse();
      const result = extractFromResponse(response, []);
      expect(result).toEqual({});
    });
  });

  // ── interpolate ──────────────────────────────────────────────────────────

  describe("interpolate", () => {
    it("replaces single placeholder", () => {
      const result = interpolate("/users/{{userId}}", { userId: "42" });
      expect(result).toBe("/users/42");
    });

    it("replaces multiple placeholders", () => {
      const result = interpolate("/users/{{userId}}/orders/{{orderId}}", {
        userId: "42",
        orderId: "99",
      });
      expect(result).toBe("/users/42/orders/99");
    });

    it("leaves placeholder as-is when value is null", () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = interpolate("/users/{{userId}}", { userId: null });
      expect(result).toBe("/users/{{userId}}");
    });

    it("leaves placeholder as-is when key is missing from values", () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = interpolate("/users/{{userId}}", {});
      expect(result).toBe("/users/{{userId}}");
    });

    it("replaces in body strings", () => {
      const template = '{"orderId":"{{orderId}}","amount":100}';
      const result = interpolate(template, { orderId: "order-777" });
      expect(result).toBe('{"orderId":"order-777","amount":100}');
    });

    it("handles template with no placeholders", () => {
      const result = interpolate("/api/health", { userId: "42" });
      expect(result).toBe("/api/health");
    });

    it("handles empty template string", () => {
      const result = interpolate("", { userId: "42" });
      expect(result).toBe("");
    });
  });

  // ── mergeWithExtracted ──────────────────────────────────────────────────

  describe("mergeWithExtracted", () => {
    it("merges extracted values into static body using mapping", () => {
      const result = mergeWithExtracted(
        { amount: 100, currency: "USD" },
        { userId: "42", sessionId: "sess-abc" },
        { user_id: "userId", session_id: "sessionId" }
      );

      expect(result).toEqual({
        amount: 100,
        currency: "USD",
        user_id: "42",
        session_id: "sess-abc",
      });
    });

    it("does not overwrite static fields with null extracted values", () => {
      const result = mergeWithExtracted({ amount: 100 }, { userId: null }, { user_id: "userId" });

      expect(result).toEqual({ amount: 100 });
      expect(result).not.toHaveProperty("user_id");
    });

    it("does not overwrite static fields with missing extracted keys", () => {
      const result = mergeWithExtracted({ amount: 100 }, {}, { user_id: "nonexistentKey" });

      expect(result).toEqual({ amount: 100 });
    });

    it("preserves original static body (no mutation)", () => {
      const staticBody = { amount: 100 };
      mergeWithExtracted(staticBody, { userId: "42" }, { user_id: "userId" });

      expect(staticBody).toEqual({ amount: 100 });
      expect(staticBody).not.toHaveProperty("user_id");
    });

    it("handles empty mapping", () => {
      const result = mergeWithExtracted({ amount: 100 }, { userId: "42" }, {});
      expect(result).toEqual({ amount: 100 });
    });

    it("handles empty static body", () => {
      const result = mergeWithExtracted({}, { userId: "42" }, { user_id: "userId" });
      expect(result).toEqual({ user_id: "42" });
    });
  });
});
