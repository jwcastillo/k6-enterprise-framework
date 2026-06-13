import { describe, it, expect, vi, beforeEach } from "vitest";
import { check } from "k6";
import {
  registerCheck,
  statusCheck,
  statusRangeCheck,
  schemaCheck,
  contentCheck,
  thresholdCheck,
  customCheck,
  runChecks,
  runChecksDetailed,
} from "../../src/core/check-system";
import type { SafeResponse } from "../../src/helpers/request-helper";

function mockResponse(overrides: Partial<SafeResponse> = {}): SafeResponse {
  return {
    status: 200,
    body: JSON.stringify({ id: 1, name: "test", items: [1, 2, 3] }),
    headers: { "content-type": "application/json" },
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

describe("check-system", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("statusCheck()", () => {
    it("should create a check spec with correct name and type", () => {
      const spec = statusCheck(200);

      expect(spec.name).toBe("status is 200");
      expect(spec.type).toBe("status");
    });

    it("should pass when status matches", () => {
      const spec = statusCheck(200);
      const res = mockResponse({ status: 200 });

      expect(spec.fn(res)).toBe(true);
    });

    it("should fail when status does not match", () => {
      const spec = statusCheck(200);
      const res = mockResponse({ status: 500 });

      expect(spec.fn(res)).toBe(false);
    });
  });

  describe("statusRangeCheck()", () => {
    it("should create a check spec with correct name", () => {
      const spec = statusRangeCheck(200, 299);

      expect(spec.name).toBe("status in 200-299");
      expect(spec.type).toBe("status");
    });

    it("should pass when status is within range", () => {
      const spec = statusRangeCheck(200, 299);
      const res = mockResponse({ status: 201 });

      expect(spec.fn(res)).toBe(true);
    });

    it("should pass when status equals min boundary", () => {
      const spec = statusRangeCheck(200, 299);
      const res = mockResponse({ status: 200 });

      expect(spec.fn(res)).toBe(true);
    });

    it("should pass when status equals max boundary", () => {
      const spec = statusRangeCheck(200, 299);
      const res = mockResponse({ status: 299 });

      expect(spec.fn(res)).toBe(true);
    });

    it("should fail when status is below range", () => {
      const spec = statusRangeCheck(200, 299);
      const res = mockResponse({ status: 199 });

      expect(spec.fn(res)).toBe(false);
    });

    it("should fail when status is above range", () => {
      const spec = statusRangeCheck(200, 299);
      const res = mockResponse({ status: 300 });

      expect(spec.fn(res)).toBe(false);
    });
  });

  describe("schemaCheck()", () => {
    it("should create a check spec with field names in name", () => {
      const spec = schemaCheck(["id", "name"]);

      expect(spec.name).toBe("body has fields: id, name");
      expect(spec.type).toBe("schema");
    });

    it("should pass when all fields are present", () => {
      const spec = schemaCheck(["id", "name"]);
      const res = mockResponse();

      expect(spec.fn(res)).toBe(true);
    });

    it("should fail when a field is missing", () => {
      const spec = schemaCheck(["id", "name", "email"]);
      const res = mockResponse();

      expect(spec.fn(res)).toBe(false);
    });

    it("should fail when body is not valid JSON", () => {
      const spec = schemaCheck(["id"]);
      const res = mockResponse({ body: "not json" });
      res.json = () => null;

      expect(spec.fn(res)).toBe(false);
    });
  });

  describe("contentCheck()", () => {
    it("should create a check spec with correct name", () => {
      const spec = contentCheck("success");

      expect(spec.name).toBe("body contains 'success'");
      expect(spec.type).toBe("content");
    });

    it("should pass when body contains the substring", () => {
      const spec = contentCheck("test");
      const res = mockResponse();

      expect(spec.fn(res)).toBe(true);
    });

    it("should fail when body does not contain the substring", () => {
      const spec = contentCheck("nonexistent");
      const res = mockResponse();

      expect(spec.fn(res)).toBe(false);
    });
  });

  describe("thresholdCheck()", () => {
    it("should create a check spec with correct name", () => {
      const spec = thresholdCheck(500);

      expect(spec.name).toBe("response time < 500ms");
      expect(spec.type).toBe("threshold");
    });

    it("should pass when duration is below threshold", () => {
      const spec = thresholdCheck(500);
      const res = mockResponse({ timings: { duration: 200, waiting: 100, receiving: 50, sending: 50 } });

      expect(spec.fn(res)).toBe(true);
    });

    it("should fail when duration is above threshold", () => {
      const spec = thresholdCheck(100);
      const res = mockResponse({ timings: { duration: 150, waiting: 100, receiving: 30, sending: 20 } });

      expect(spec.fn(res)).toBe(false);
    });

    it("should fail when duration equals threshold", () => {
      const spec = thresholdCheck(150);
      const res = mockResponse({ timings: { duration: 150, waiting: 100, receiving: 30, sending: 20 } });

      expect(spec.fn(res)).toBe(false);
    });
  });

  describe("registerCheck() and customCheck()", () => {
    it("should register and retrieve a custom check", () => {
      const uniqueName = `custom-check-${Date.now()}`;
      registerCheck(uniqueName, (res) => res.status === 200);

      const spec = customCheck(uniqueName);

      expect(spec.name).toBe(uniqueName);
      expect(spec.type).toBe("custom");
    });

    it("should throw when registering a duplicate name", () => {
      const uniqueName = `duplicate-check-${Date.now()}`;
      registerCheck(uniqueName, (res) => res.status === 200);

      expect(() => registerCheck(uniqueName, (res) => res.status === 201)).toThrow(
        /already registered/,
      );
    });

    it("should throw when retrieving an unregistered check", () => {
      expect(() => customCheck("nonexistent-check-name")).toThrow(
        /not registered/,
      );
    });

    it("should execute the registered function", () => {
      const uniqueName = `exec-check-${Date.now()}`;
      registerCheck(uniqueName, (res) => res.body.includes("test"));

      const spec = customCheck(uniqueName);
      const res = mockResponse();

      expect(spec.fn(res)).toBe(true);
    });
  });

  describe("runChecks()", () => {
    it("should call k6 check() with the response and check map", () => {
      const res = mockResponse();
      const specs = [statusCheck(200), contentCheck("test")];

      runChecks(res, specs);

      expect(check).toHaveBeenCalledWith(res, expect.any(Object));
    });

    it("should return the result of k6 check()", () => {
      const res = mockResponse();
      const specs = [statusCheck(200)];

      const result = runChecks(res, specs);

      expect(result).toBe(true);
    });

    it("should handle empty specs array", () => {
      const res = mockResponse();

      const result = runChecks(res, []);

      expect(check).toHaveBeenCalledWith(res, {});
      expect(result).toBe(true);
    });
  });

  describe("runChecksDetailed()", () => {
    it("should return detailed results for each check", () => {
      const res = mockResponse({ status: 200 });
      const specs = [statusCheck(200), statusCheck(500)];

      const results = runChecksDetailed(res, specs);

      expect(results).toHaveLength(2);
      expect(results[0].name).toBe("status is 200");
      expect(results[0].passed).toBe(true);
      expect(results[0].type).toBe("status");
      expect(results[1].name).toBe("status is 500");
      expect(results[1].passed).toBe(false);
    });

    it("should register each check with k6 check()", () => {
      const res = mockResponse();
      const specs = [statusCheck(200), contentCheck("test")];

      runChecksDetailed(res, specs);

      expect(check).toHaveBeenCalledTimes(2);
    });

    it("should catch exceptions in check functions and mark as failed", () => {
      const res = mockResponse();
      const throwingSpec = {
        name: "throws",
        type: "custom" as const,
        fn: () => {
          throw new Error("boom");
        },
      };

      const results = runChecksDetailed(res, [throwingSpec]);

      expect(results[0].passed).toBe(false);
    });
  });
});
