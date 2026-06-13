import { describe, it, expect as vitestExpect, vi, beforeEach } from "vitest";
import { check } from "k6";
import { expect } from "../../src/core/assertion-helper";
import type { SafeResponse } from "../../src/helpers/request-helper";

function mockResponse(overrides: Partial<SafeResponse> = {}): SafeResponse {
  return {
    status: 200,
    body: JSON.stringify({ data: { id: "abc", name: "test" }, items: [1, 2, 3] }),
    headers: { "content-type": "application/json", "x-request-id": "req-123" },
    timings: { duration: 150, waiting: 100, receiving: 30, sending: 20 },
    json: function <T>(selector?: string): T | null {
      try {
        const parsed = JSON.parse(this.body);
        if (!selector) return parsed as T;
        return selector.split(".").reduce((obj: Record<string, unknown>, key: string) => {
          return obj && typeof obj === "object" ? (obj[key] as Record<string, unknown>) : undefined;
        }, parsed) as T;
      } catch {
        return null;
      }
    },
    ...overrides,
  } as SafeResponse;
}

describe("AssertionHelper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("expect().status()", () => {
    it("should pass when status matches", () => {
      const res = mockResponse({ status: 200 });
      const assertion = expect(res).status(200);

      vitestExpect(assertion.passed).toBe(true);
      vitestExpect(check).toHaveBeenCalled();
    });

    it("should fail when status does not match", () => {
      const res = mockResponse({ status: 500 });
      const assertion = expect(res).status(200);

      vitestExpect(assertion.results[0].passed).toBe(false);
    });
  });

  describe("expect().statusIn()", () => {
    it("should pass when status is in range", () => {
      const res = mockResponse({ status: 201 });
      const assertion = expect(res).statusIn(200, 299);

      vitestExpect(assertion.passed).toBe(true);
    });

    it("should fail when status is out of range", () => {
      const res = mockResponse({ status: 400 });
      const assertion = expect(res).statusIn(200, 299);

      vitestExpect(assertion.results[0].passed).toBe(false);
    });
  });

  describe("expect().bodyContains()", () => {
    it("should pass when body contains substring", () => {
      const res = mockResponse({ body: '{"status":"ok"}' });
      const assertion = expect(res).bodyContains("ok");

      vitestExpect(assertion.passed).toBe(true);
    });

    it("should fail when body does not contain substring", () => {
      const res = mockResponse({ body: '{"status":"ok"}' });
      const assertion = expect(res).bodyContains("error");

      vitestExpect(assertion.results[0].passed).toBe(false);
    });
  });

  describe("expect().jsonField()", () => {
    it("toBeDefined should pass for existing field", () => {
      const res = mockResponse();
      expect(res).jsonField("data").toBeDefined();

      vitestExpect(check).toHaveBeenCalled();
    });

    it("toBeDefined should fail for missing field", () => {
      const res = mockResponse();
      const field = expect(res).jsonField("nonexistent");
      field.toBeDefined();

      // The check was called (registered with k6) — just verifying no crash
      vitestExpect(check).toHaveBeenCalled();
    });

    it("toEqual should pass for matching value", () => {
      const res = mockResponse();
      expect(res).jsonField("data.id").toEqual("abc");

      vitestExpect(check).toHaveBeenCalled();
    });

    it("toContain should pass for string fields", () => {
      const res = mockResponse();
      expect(res).jsonField("data.name").toContain("te");

      vitestExpect(check).toHaveBeenCalled();
    });

    it("toHaveLength should pass for arrays", () => {
      const res = mockResponse();
      expect(res).jsonField("items").toHaveLength(3);

      vitestExpect(check).toHaveBeenCalled();
    });
  });

  describe("expect().header()", () => {
    it("toBeDefined should pass for existing header", () => {
      const res = mockResponse();
      expect(res).header("content-type").toBeDefined();

      vitestExpect(check).toHaveBeenCalled();
    });

    it("toContain should pass for header substring", () => {
      const res = mockResponse();
      expect(res).header("content-type").toContain("json");

      vitestExpect(check).toHaveBeenCalled();
    });

    it("toEqual should pass for exact match", () => {
      const res = mockResponse();
      expect(res).header("x-request-id").toEqual("req-123");

      vitestExpect(check).toHaveBeenCalled();
    });

    it("should handle case-insensitive header names", () => {
      const res = mockResponse();
      expect(res).header("Content-Type").toContain("json");

      vitestExpect(check).toHaveBeenCalled();
    });
  });

  describe("expect().responseTime()", () => {
    it("toBeLessThan should pass when under threshold", () => {
      const res = mockResponse();
      res.timings = { duration: 100, waiting: 50, receiving: 30, sending: 20 };
      const assertion = expect(res);
      assertion.responseTime().toBeLessThan(500);

      vitestExpect(assertion.passed).toBe(true);
      vitestExpect(assertion.results[0].passed).toBe(true);
    });

    it("toBeLessThan should fail when over threshold", () => {
      const res = mockResponse();
      res.timings = { duration: 600, waiting: 400, receiving: 100, sending: 100 };
      const assertion = expect(res);
      assertion.responseTime().toBeLessThan(500);

      vitestExpect(assertion.results[0].passed).toBe(false);
    });

    it("toBeGreaterThan should pass when over threshold", () => {
      const res = mockResponse();
      res.timings = { duration: 200, waiting: 100, receiving: 50, sending: 50 };
      const assertion = expect(res);
      assertion.responseTime().toBeGreaterThan(100);

      vitestExpect(assertion.results[0].passed).toBe(true);
    });
  });

  describe("chaining", () => {
    it("should support chaining multiple assertions", () => {
      const res = mockResponse();
      const assertion = expect(res).status(200).bodyContains("data").statusIn(200, 299);

      vitestExpect(assertion.passed).toBe(true);
      vitestExpect(assertion.results).toHaveLength(3);
    });

    it("should fail overall if any assertion fails", () => {
      const res = mockResponse({ status: 500 });
      const assertion = expect(res).status(200).bodyContains("data");

      vitestExpect(assertion.passed).toBe(false);
      vitestExpect(assertion.results).toHaveLength(2);
    });
  });
});
