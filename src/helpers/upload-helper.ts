/** T-019: UploadHelper — File upload multipart/form-data + rate-limit detection */

import http, { FileData } from "k6/http";
import { Trend, Counter } from "k6/metrics";
import { check, sleep } from "k6";

// Custom metrics for rate-limit tracking (FR-126)
export const rateLimitHits = new Counter("rate_limit_hits");
export const successfulRequests = new Counter("successful_requests");
export const uploadDuration = new Trend("upload_duration_ms", true);
export const downloadDuration = new Trend("download_duration_ms", true);

export interface UploadResult {
  status: number;
  success: boolean;
  body: string;
  durationMs: number;
  rateLimited: boolean;
  retryAfterSeconds?: number;
}

export interface DownloadResult {
  status: number;
  success: boolean;
  contentLength: number;
  durationMs: number;
  contentType: string;
}

/**
 * Upload a file via multipart/form-data.
 * Measures upload time as a separate custom metric.
 */
export function uploadFile(
  url: string,
  fileContent: ArrayBuffer | string,
  fileName: string,
  fieldName = "file",
  extraFields?: Record<string, string>,
  headers?: Record<string, string>
): UploadResult {
  const fileData: FileData = http.file(fileContent, fileName);
  const formData: Record<string, FileData | string> = { [fieldName]: fileData };
  if (extraFields) {
    for (const [k, v] of Object.entries(extraFields)) {
      formData[k] = v;
    }
  }

  const start = Date.now();
  const res = http.post(url, formData, { headers: headers ?? {} });
  const durationMs = Date.now() - start;

  uploadDuration.add(durationMs);

  const rateLimited = res.status === 429;
  if (rateLimited) {
    rateLimitHits.add(1);
  }

  const result: UploadResult = {
    status: res.status,
    success: res.status >= 200 && res.status < 300,
    body: res.body?.toString() ?? "",
    durationMs,
    rateLimited,
  };

  if (rateLimited) {
    const retryAfter = res.headers["Retry-After"] ?? res.headers["retry-after"];
    if (retryAfter) {
      result.retryAfterSeconds = parseInt(retryAfter, 10);
    }
  }

  if (result.success) {
    successfulRequests.add(1);
  }

  check(res, {
    "upload: status 2xx": (r) => r.status >= 200 && r.status < 300,
    "upload: not rate limited": (r) => r.status !== 429,
  });

  return result;
}

/**
 * Download a file and validate its size.
 * Reports transfer time as a separate metric.
 */
export function downloadFile(
  url: string,
  expectedMinBytes?: number,
  headers?: Record<string, string>
): DownloadResult {
  const start = Date.now();
  const res = http.get(url, {
    headers: headers ?? {},
    responseType: "binary",
  });
  const durationMs = Date.now() - start;

  downloadDuration.add(durationMs);

  // body is ArrayBuffer when responseType="binary"
  const body = res.body as ArrayBuffer | null;
  const contentLength = body?.byteLength ?? 0;
  const contentType = res.headers["Content-Type"] ?? res.headers["content-type"] ?? "";

  const result: DownloadResult = {
    status: res.status,
    success: res.status === 200,
    contentLength,
    durationMs,
    contentType,
  };

  check(res, {
    "download: status 200": (r) => r.status === 200,
    "download: body not empty": () => contentLength > 0,
    ...(expectedMinBytes !== undefined
      ? {
          [`download: body >= ${expectedMinBytes} bytes`]: (): boolean =>
            contentLength >= expectedMinBytes,
        }
      : {}),
  });

  if (result.success) {
    successfulRequests.add(1);
  }

  return result;
}

/**
 * Execute a request with automatic rate-limit detection and adaptive backoff.
 * Reads `Retry-After` header when HTTP 429 is returned (FR-126).
 */
export function withRateLimitHandling(
  fn: () => { status: number; headers: Record<string, string> },
  maxRetries = 3
): { status: number; rateLimited: boolean; attempts: number } {
  let attempts = 0;

  while (attempts < maxRetries) {
    const res = fn();
    attempts++;

    if (res.status !== 429) {
      if (res.status >= 200 && res.status < 300) {
        successfulRequests.add(1);
      }
      return { status: res.status, rateLimited: false, attempts };
    }

    rateLimitHits.add(1);

    const retryAfterHeader = res.headers["Retry-After"] ?? res.headers["retry-after"];
    const retryAfterSeconds = retryAfterHeader
      ? parseInt(retryAfterHeader, 10)
      : Math.pow(2, attempts);

    console.warn(
      `RateLimitHandler: HTTP 429 received. Retry-After=${retryAfterSeconds}s (attempt ${attempts}/${maxRetries})`
    );

    if (attempts < maxRetries) {
      sleep(retryAfterSeconds);
    }
  }

  return { status: 429, rateLimited: true, attempts };
}
