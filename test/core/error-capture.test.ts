/**
 * COV-01 — error-capture.ts coverage (D-04, D-05).
 *
 * Unit tests for src/core/error-capture.ts. All stubs are in-memory
 * (no HTTP server, no port binding). Suite runs read-only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  captureUnexpectedResponse,
  getCapturedErrors,
  clearCapturedErrors,
  captureErrorsSummaryFile,
} from "../../src/core/error-capture";

type StubResponse = {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
  timings?: { duration?: number };
  request?: { method?: string; url?: string; headers?: Record<string, string> };
};

function stubResponse(overrides: Partial<StubResponse> = {}): StubResponse {
  return {
    status: 500,
    body: "oops",
    headers: {},
    timings: { duration: 42 },
    request: { method: "GET", url: "/x", headers: {} },
    ...overrides,
  };
}

describe("error-capture (COV-01)", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clearCapturedErrors();
    (globalThis as Record<string, unknown>).__ENV = {};
    (globalThis as Record<string, unknown>).__VU = 1;
    (globalThis as Record<string, unknown>).__ITER = 0;
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    clearCapturedErrors();
    (globalThis as Record<string, unknown>).__ENV = {};
    vi.restoreAllMocks();
  });

  it("captures response when status does not match expectedStatus", () => {
    const captured = captureUnexpectedResponse(stubResponse({ status: 500, body: "oops" }), {
      expectedStatus: 200,
      method: "GET",
      url: "/x",
    });
    expect(captured).toBe(true);
    const entries = getCapturedErrors();
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e.status).toBe(500);
    expect(e.body).toBe("oops");
    expect(e.bodyTruncated).toBe(false);
    expect(e.method).toBe("GET");
    expect(e.url).toBe("/x");
    expect(e.durationMs).toBe(42);
    expect(e.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("returns false and does not push when status matches expectedStatus", () => {
    const captured = captureUnexpectedResponse(stubResponse({ status: 200 }), {
      expectedStatus: 200,
    });
    expect(captured).toBe(false);
    expect(getCapturedErrors()).toHaveLength(0);
  });

  it("respects K6_CAPTURE_ERRORS=false", () => {
    (globalThis as Record<string, unknown>).__ENV = { K6_CAPTURE_ERRORS: "false" };
    const captured = captureUnexpectedResponse(stubResponse({ status: 500 }), {
      expectedStatus: 200,
    });
    expect(captured).toBe(false);
    expect(getCapturedErrors()).toHaveLength(0);
  });

  it("truncates body when length exceeds K6_ERROR_BODY_MAX", () => {
    (globalThis as Record<string, unknown>).__ENV = { K6_ERROR_BODY_MAX: "16" };
    const longBody = "x".repeat(64);
    captureUnexpectedResponse(stubResponse({ status: 500, body: longBody }), {
      expectedStatus: 200,
    });
    const e = getCapturedErrors()[0];
    expect(e.body.length).toBe(16);
    expect(e.bodyTruncated).toBe(true);
  });

  it("stops capturing after K6_ERROR_MAX_ENTRIES cap is reached", () => {
    (globalThis as Record<string, unknown>).__ENV = { K6_ERROR_MAX_ENTRIES: "2" };
    const r1 = captureUnexpectedResponse(stubResponse({ status: 500 }), { expectedStatus: 200 });
    const r2 = captureUnexpectedResponse(stubResponse({ status: 501 }), { expectedStatus: 200 });
    const r3 = captureUnexpectedResponse(stubResponse({ status: 502 }), { expectedStatus: 200 });
    expect(r1).toBe(true);
    expect(r2).toBe(true);
    expect(r3).toBe(false);
    expect(getCapturedErrors()).toHaveLength(2);
  });

  it("looks up trackId from response request.headers via default header list", () => {
    captureUnexpectedResponse(
      stubResponse({
        status: 500,
        request: { method: "GET", url: "/x", headers: { "X-Request-Id": "abc-123" } },
      }),
      { expectedStatus: 200 }
    );
    expect(getCapturedErrors()[0].trackId).toBe("abc-123");
  });

  it("uses custom track headers when K6_ERROR_TRACK_HEADERS is set", () => {
    (globalThis as Record<string, unknown>).__ENV = { K6_ERROR_TRACK_HEADERS: "x-corr" };
    captureUnexpectedResponse(stubResponse({ status: 500 }), {
      expectedStatus: 200,
      headers: { "x-corr": "xx-99" },
    });
    expect(getCapturedErrors()[0].trackId).toBe("xx-99");
  });

  it("handles status=0 (connection error) as a non-match capture", () => {
    const captured = captureUnexpectedResponse(stubResponse({ status: 0, body: "" }), {
      expectedStatus: 200,
    });
    expect(captured).toBe(true);
    expect(getCapturedErrors()[0].status).toBe(0);
  });

  it("handles non-string body via String() coercion", () => {
    captureUnexpectedResponse(stubResponse({ status: 500, body: { foo: 1 } }), {
      expectedStatus: 200,
    });
    const body = getCapturedErrors()[0].body;
    expect(typeof body).toBe("string");
    expect(body).toBe("[object Object]");
  });

  it("captureErrorsSummaryFile() returns empty object when buffer is empty", () => {
    expect(captureErrorsSummaryFile()).toEqual({});
  });

  it("captureErrorsSummaryFile(path) returns map with stringified JSON payload", () => {
    captureUnexpectedResponse(stubResponse({ status: 500 }), { expectedStatus: 200 });
    const out = captureErrorsSummaryFile("errors.json");
    expect(Object.keys(out)).toEqual(["errors.json"]);
    const payload = JSON.parse(out["errors.json"]);
    expect(payload).toMatchObject({
      count: 1,
      errors: expect.any(Array),
      truncatedBodyMaxChars: expect.any(Number),
      maxEntriesCap: expect.any(Number),
      capHit: false,
    });
    expect(payload.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
