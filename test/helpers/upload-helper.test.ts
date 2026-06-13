import { describe, it, expect, vi, beforeEach } from "vitest";

// Override k6/metrics mock to use function constructors (arrow fns can't be used with new)
vi.mock("k6/metrics", () => ({
  Counter: vi.fn().mockImplementation(function (this: { add: ReturnType<typeof vi.fn> }) {
    this.add = vi.fn();
  }),
  Trend: vi.fn().mockImplementation(function (this: { add: ReturnType<typeof vi.fn> }) {
    this.add = vi.fn();
  }),
  Rate: vi.fn().mockImplementation(function (this: { add: ReturnType<typeof vi.fn> }) {
    this.add = vi.fn();
  }),
  Gauge: vi.fn().mockImplementation(function (this: { add: ReturnType<typeof vi.fn> }) {
    this.add = vi.fn();
  }),
}));

import http from "k6/http";
import { check, sleep } from "k6";
import { uploadFile, downloadFile, withRateLimitHandling } from "../../src/helpers/upload-helper";

function mockResponse(
  overrides: Partial<{
    status: number;
    body: unknown;
    headers: Record<string, string>;
    timings: { duration: number };
  }> = {}
) {
  return {
    status: overrides.status ?? 200,
    body: overrides.body ?? "ok",
    headers: overrides.headers ?? {},
    timings: overrides.timings ?? { duration: 100 },
  };
}

describe("uploadFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(http.file).mockReturnValue({ data: "filedata" } as never);
  });

  it("uploads a file via http.post with multipart form data", () => {
    vi.mocked(http.post).mockReturnValue(mockResponse({ status: 200 }) as never);
    const result = uploadFile("https://api.example.com/upload", "filecontent", "test.txt");
    expect(http.file).toHaveBeenCalledWith("filecontent", "test.txt");
    expect(http.post).toHaveBeenCalledWith(
      "https://api.example.com/upload",
      expect.objectContaining({ file: expect.anything() }),
      expect.any(Object)
    );
    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
    expect(result.rateLimited).toBe(false);
  });

  it("uses custom field name", () => {
    vi.mocked(http.post).mockReturnValue(mockResponse() as never);
    uploadFile("https://api.example.com/upload", "data", "doc.pdf", "document");
    const formData = vi.mocked(http.post).mock.calls[0][1] as Record<string, unknown>;
    expect(formData).toHaveProperty("document");
    expect(formData).not.toHaveProperty("file");
  });

  it("includes extra fields in the form data", () => {
    vi.mocked(http.post).mockReturnValue(mockResponse() as never);
    uploadFile("https://api.example.com/upload", "data", "test.txt", "file", {
      description: "test upload",
      category: "docs",
    });
    const formData = vi.mocked(http.post).mock.calls[0][1] as Record<string, unknown>;
    expect(formData.description).toBe("test upload");
    expect(formData.category).toBe("docs");
  });

  it("passes custom headers", () => {
    vi.mocked(http.post).mockReturnValue(mockResponse() as never);
    uploadFile("https://api.example.com/upload", "data", "test.txt", "file", undefined, {
      Authorization: "Bearer token123",
    });
    const params = vi.mocked(http.post).mock.calls[0][2] as { headers: Record<string, string> };
    expect(params.headers.Authorization).toBe("Bearer token123");
  });

  it("detects rate limiting (HTTP 429)", () => {
    vi.mocked(http.post).mockReturnValue(
      mockResponse({
        status: 429,
        headers: { "Retry-After": "30" },
      }) as never
    );
    const result = uploadFile("https://api.example.com/upload", "data", "test.txt");
    expect(result.rateLimited).toBe(true);
    expect(result.retryAfterSeconds).toBe(30);
    expect(result.success).toBe(false);
  });

  it("handles 429 without Retry-After header", () => {
    vi.mocked(http.post).mockReturnValue(mockResponse({ status: 429 }) as never);
    const result = uploadFile("https://api.example.com/upload", "data", "test.txt");
    expect(result.rateLimited).toBe(true);
    expect(result.retryAfterSeconds).toBeUndefined();
  });

  it("reports unsuccessful upload for non-2xx status", () => {
    vi.mocked(http.post).mockReturnValue(mockResponse({ status: 500 }) as never);
    const result = uploadFile("https://api.example.com/upload", "data", "test.txt");
    expect(result.success).toBe(false);
    expect(result.status).toBe(500);
  });

  it("records duration", () => {
    vi.mocked(http.post).mockReturnValue(mockResponse() as never);
    const result = uploadFile("https://api.example.com/upload", "data", "test.txt");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("calls check with upload assertions", () => {
    vi.mocked(http.post).mockReturnValue(mockResponse({ status: 200 }) as never);
    uploadFile("https://api.example.com/upload", "data", "test.txt");
    expect(check).toHaveBeenCalled();
  });
});

describe("downloadFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("downloads a file via http.get with binary responseType", () => {
    const body = new ArrayBuffer(1024);
    vi.mocked(http.get).mockReturnValue(
      mockResponse({
        status: 200,
        body,
        headers: { "Content-Type": "application/pdf" },
      }) as never
    );
    const result = downloadFile("https://api.example.com/files/doc.pdf");
    expect(http.get).toHaveBeenCalledWith(
      "https://api.example.com/files/doc.pdf",
      expect.objectContaining({ responseType: "binary" })
    );
    expect(result.success).toBe(true);
    expect(result.contentLength).toBe(1024);
    expect(result.contentType).toBe("application/pdf");
  });

  it("reports failure for non-200 status", () => {
    vi.mocked(http.get).mockReturnValue(mockResponse({ status: 404 }) as never);
    const result = downloadFile("https://api.example.com/files/missing.pdf");
    expect(result.success).toBe(false);
    expect(result.status).toBe(404);
  });

  it("validates minimum size when expectedMinBytes is set", () => {
    const body = new ArrayBuffer(100);
    vi.mocked(http.get).mockReturnValue(mockResponse({ status: 200, body }) as never);
    downloadFile("https://api.example.com/files/small.pdf", 500);
    expect(check).toHaveBeenCalled();
  });

  it("handles null body gracefully", () => {
    vi.mocked(http.get).mockReturnValue(mockResponse({ status: 200, body: null }) as never);
    const result = downloadFile("https://api.example.com/files/empty");
    expect(result.contentLength).toBe(0);
  });

  it("passes custom headers", () => {
    vi.mocked(http.get).mockReturnValue(mockResponse({ status: 200 }) as never);
    downloadFile("https://api.example.com/files/doc.pdf", undefined, {
      Authorization: "Bearer xyz",
    });
    const params = vi.mocked(http.get).mock.calls[0][1] as { headers: Record<string, string> };
    expect(params.headers.Authorization).toBe("Bearer xyz");
  });
});

describe("withRateLimitHandling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns immediately on successful response", () => {
    const fn = vi.fn(() => ({ status: 200, headers: {} }));
    const result = withRateLimitHandling(fn);
    expect(result.status).toBe(200);
    expect(result.rateLimited).toBe(false);
    expect(result.attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 and returns non-429 response", () => {
    const fn = vi
      .fn()
      .mockReturnValueOnce({ status: 429, headers: { "Retry-After": "1" } })
      .mockReturnValueOnce({ status: 200, headers: {} });
    const result = withRateLimitHandling(fn);
    expect(result.status).toBe(200);
    expect(result.rateLimited).toBe(false);
    expect(result.attempts).toBe(2);
    expect(sleep).toHaveBeenCalledWith(1);
  });

  it("uses exponential backoff when no Retry-After header", () => {
    const fn = vi
      .fn()
      .mockReturnValueOnce({ status: 429, headers: {} })
      .mockReturnValueOnce({ status: 200, headers: {} });
    withRateLimitHandling(fn);
    // 2^1 = 2 (exponential backoff for attempt 1)
    expect(sleep).toHaveBeenCalledWith(2);
  });

  it("gives up after maxRetries", () => {
    const fn = vi.fn(() => ({ status: 429, headers: {} }));
    const result = withRateLimitHandling(fn, 3);
    expect(result.status).toBe(429);
    expect(result.rateLimited).toBe(true);
    expect(result.attempts).toBe(3);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not sleep on the last attempt", () => {
    const fn = vi.fn(() => ({ status: 429, headers: { "Retry-After": "5" } }));
    withRateLimitHandling(fn, 2);
    // Only 1 sleep (after first attempt), not after last
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("passes through non-2xx non-429 status codes", () => {
    const fn = vi.fn(() => ({ status: 500, headers: {} }));
    const result = withRateLimitHandling(fn);
    expect(result.status).toBe(500);
    expect(result.rateLimited).toBe(false);
    expect(result.attempts).toBe(1);
  });
});
