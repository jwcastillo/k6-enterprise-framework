import { describe, it, expect, vi, beforeEach } from "vitest";
import { sleep } from "k6";
import { withRetry, retryRequest } from "../../src/patterns/retry-pattern";
import { SafeResponse } from "../../src/helpers/request-helper";

function makeSafeResponse(overrides: Partial<SafeResponse> = {}): SafeResponse {
  return {
    status: 200,
    body: '{"ok":true}',
    headers: {},
    timings: { duration: 50, waiting: 40, receiving: 5, sending: 5 },
    json: vi.fn(() => null),
    ...overrides,
  };
}

describe("retry-pattern", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Make Math.random deterministic for jitter calculations
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  // ── withRetry ──────────────────────────────────────────────────────────────

  describe("withRetry", () => {
    it("returns immediately on successful response (non-retryable status)", () => {
      const fn = vi.fn(() => makeSafeResponse({ status: 200 }));
      const result = withRetry(fn);

      expect(result.value.status).toBe(200);
      expect(result.attempts).toBe(1);
      expect(result.lastError).toBeUndefined();
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(0);
      expect(sleep).not.toHaveBeenCalled();
    });

    it("retries on default retryable status codes (429, 500, 502, 503, 504)", () => {
      const fn = vi
        .fn<(attempt: number) => SafeResponse>()
        .mockReturnValueOnce(makeSafeResponse({ status: 503 }))
        .mockReturnValueOnce(makeSafeResponse({ status: 200 }));

      const result = withRetry(fn);

      expect(result.value.status).toBe(200);
      expect(result.attempts).toBe(2);
      expect(fn).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledTimes(1);
    });

    it("retries up to maxAttempts and returns last response", () => {
      const fn = vi.fn(() => makeSafeResponse({ status: 500 }));
      const result = withRetry(fn, { maxAttempts: 4 });

      expect(result.value.status).toBe(500);
      expect(result.attempts).toBe(4);
      expect(result.lastError).toBe("HTTP 500");
      expect(fn).toHaveBeenCalledTimes(4);
      // sleep called between attempts, not after the last one
      expect(sleep).toHaveBeenCalledTimes(3);
    });

    it("uses custom retryOnStatus codes", () => {
      const fn = vi
        .fn<(attempt: number) => SafeResponse>()
        .mockReturnValueOnce(makeSafeResponse({ status: 409 }))
        .mockReturnValueOnce(makeSafeResponse({ status: 200 }));

      const result = withRetry(fn, { retryOnStatus: [409] });
      expect(result.value.status).toBe(200);
      expect(result.attempts).toBe(2);
    });

    it("does not retry on status not in retryOnStatus", () => {
      const fn = vi.fn(() => makeSafeResponse({ status: 404 }));
      const result = withRetry(fn);

      expect(result.value.status).toBe(404);
      expect(result.attempts).toBe(1);
      expect(sleep).not.toHaveBeenCalled();
    });

    it("retries on thrown errors when retryOnError is true (default)", () => {
      const fn = vi
        .fn<(attempt: number) => SafeResponse>()
        .mockImplementationOnce(() => {
          throw new Error("connection refused");
        })
        .mockReturnValueOnce(makeSafeResponse({ status: 200 }));

      const result = withRetry(fn);
      expect(result.value.status).toBe(200);
      expect(result.attempts).toBe(2);
      expect(sleep).toHaveBeenCalledTimes(1);
    });

    it("throws immediately on error when retryOnError is false", () => {
      const fn = vi.fn(() => {
        throw new Error("network failure");
      });

      expect(() => withRetry(fn, { retryOnError: false })).toThrow("network failure");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("throws if all attempts fail with errors", () => {
      const fn = vi.fn(() => {
        throw new Error("persistent failure");
      });

      expect(() => withRetry(fn, { maxAttempts: 3 })).toThrow("persistent failure");
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("calculates exponential backoff delay", () => {
      const fn = vi.fn(() => makeSafeResponse({ status: 500 }));
      // Math.random = 0.5, so jitter = capped * 0.3 * (0.5*2 - 1) = 0
      withRetry(fn, { maxAttempts: 4, baseDelaySeconds: 1, jitter: 0.3 });

      // attempt 0: base * 2^0 = 1s, jitter=0 → 1.0
      // attempt 1: base * 2^1 = 2s, jitter=0 → 2.0
      // attempt 2: base * 2^2 = 4s, jitter=0 → 4.0
      expect(sleep).toHaveBeenCalledTimes(3);
      expect(sleep).toHaveBeenNthCalledWith(1, 1);
      expect(sleep).toHaveBeenNthCalledWith(2, 2);
      expect(sleep).toHaveBeenNthCalledWith(3, 4);
    });

    it("caps delay at maxDelaySeconds", () => {
      const fn = vi.fn(() => makeSafeResponse({ status: 500 }));
      withRetry(fn, {
        maxAttempts: 5,
        baseDelaySeconds: 10,
        maxDelaySeconds: 15,
        jitter: 0,
      });

      // attempt 0: 10*2^0=10, capped at 15 → 10
      // attempt 1: 10*2^1=20, capped at 15 → 15
      // attempt 2: 10*2^2=40, capped at 15 → 15
      // attempt 3: 10*2^3=80, capped at 15 → 15
      expect(sleep).toHaveBeenNthCalledWith(1, 10);
      expect(sleep).toHaveBeenNthCalledWith(2, 15);
      expect(sleep).toHaveBeenNthCalledWith(3, 15);
      expect(sleep).toHaveBeenNthCalledWith(4, 15);
    });

    it("passes attempt number to callback", () => {
      const fn = vi.fn((_attempt: number) => makeSafeResponse({ status: 502 }));
      withRetry(fn, { maxAttempts: 3 });

      expect(fn).toHaveBeenNthCalledWith(1, 0);
      expect(fn).toHaveBeenNthCalledWith(2, 1);
      expect(fn).toHaveBeenNthCalledWith(3, 2);
    });

    it("uses default config when none provided", () => {
      const fn = vi.fn(() => makeSafeResponse({ status: 200 }));
      const result = withRetry(fn);
      expect(result.attempts).toBe(1);
    });
  });

  // ── retryRequest ──────────────────────────────────────────────────────────

  describe("retryRequest", () => {
    it("returns the response directly (unwrapped from RetryResult)", () => {
      const response = makeSafeResponse({ status: 200 });
      const fn = vi.fn(() => response);
      const result = retryRequest(fn);

      expect(result.status).toBe(200);
      expect(result).toBe(response);
    });

    it("retries and returns response on success after failure", () => {
      const fn = vi
        .fn<() => SafeResponse>()
        .mockReturnValueOnce(makeSafeResponse({ status: 429 }))
        .mockReturnValueOnce(makeSafeResponse({ status: 200 }));

      const result = retryRequest(fn, { maxAttempts: 3 });
      expect(result.status).toBe(200);
    });

    it("returns last retryable response if all attempts exhausted", () => {
      const fn = vi.fn(() => makeSafeResponse({ status: 504 }));
      const result = retryRequest(fn, { maxAttempts: 2 });
      expect(result.status).toBe(504);
    });

    it("forwards config to withRetry", () => {
      const fn = vi.fn(() => makeSafeResponse({ status: 503 }));
      retryRequest(fn, { maxAttempts: 5 });
      expect(fn).toHaveBeenCalledTimes(5);
    });
  });
});
