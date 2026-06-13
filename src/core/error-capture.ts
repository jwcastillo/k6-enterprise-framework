/**
 * ErrorCapture — captures HTTP responses with unexpected status codes.
 *
 * Logs structured JSON to stderr (already piped to k6-execution-*.log by run-test.sh)
 * and accumulates entries in module-level memory so that handleSummary() can dump
 * them to a file (k6/goja has no fs API during VU execution; only handleSummary can
 * return files via the standard k6 mechanism).
 *
 * Enabled by default. Toggle with K6_CAPTURE_ERRORS=false.
 *
 * Env knobs:
 *   K6_CAPTURE_ERRORS      — "true"|"false" (default true)
 *   K6_ERROR_BODY_MAX      — int (default 2000) max chars of body kept per entry
 *   K6_ERROR_MAX_ENTRIES   — int (default 500) cap to bound memory under high VUs
 *   K6_ERROR_TRACK_HEADERS — comma-separated header names to look up (case-insensitive)
 */

export interface CaptureContext {
  url?: string;
  method?: string;
  expectedStatus?: number | number[];
  service?: string;
  module?: string;
  scenario?: string;
  trackId?: string;
  headers?: Record<string, string>;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

export interface CapturedError {
  timestamp: string;
  vu: number;
  iter: number;
  scenario?: string;
  module?: string;
  service?: string;
  method?: string;
  url?: string;
  status: number;
  expectedStatus?: number | number[];
  trackId?: string;
  contentType?: string;
  bodyTruncated: boolean;
  body: string;
  durationMs?: number;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

const DEFAULT_TRACK_HEADERS = [
  "x-track-id",
  "x-request-id",
  "x-correlation-id",
  "x-amzn-trace-id",
  "traceparent",
];

const buffer: CapturedError[] = [];

function envBool(name: string, defaultVal: boolean): boolean {
  const v = __ENV[name];
  if (v === undefined || v === "") return defaultVal;
  return v.toLowerCase() === "true" || v === "1";
}

function envInt(name: string, defaultVal: number): number {
  const v = __ENV[name];
  if (!v) return defaultVal;
  const n = parseInt(v, 10);
  return isNaN(n) ? defaultVal : n;
}

function isCaptureEnabled(): boolean {
  return envBool("K6_CAPTURE_ERRORS", true);
}

function maxBody(): number {
  return envInt("K6_ERROR_BODY_MAX", 2000);
}

function maxEntries(): number {
  return envInt("K6_ERROR_MAX_ENTRIES", 500);
}

function trackHeaderNames(): string[] {
  const v = __ENV["K6_ERROR_TRACK_HEADERS"];
  if (!v) return DEFAULT_TRACK_HEADERS;
  return v
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function lookupHeader(
  headers: Record<string, string> | undefined,
  names: string[]
): string | undefined {
  if (!headers) return undefined;
  const lowered: Record<string, string> = {};
  for (const k of Object.keys(headers)) lowered[k.toLowerCase()] = headers[k];
  for (const name of names) {
    const v = lowered[name];
    if (v) return v;
  }
  return undefined;
}

function truncate(s: string, max: number): { body: string; truncated: boolean } {
  if (s.length <= max) return { body: s, truncated: false };
  return { body: s.slice(0, max), truncated: true };
}

function statusMatches(actual: number, expected: number | number[] | undefined): boolean {
  if (expected === undefined) return true;
  if (Array.isArray(expected)) return expected.includes(actual);
  return actual === expected;
}

function expectedToString(expected: number | number[] | undefined): string {
  if (expected === undefined) return "";
  if (Array.isArray(expected)) return expected.join("|");
  return String(expected);
}

/**
 * Capture an unexpected HTTP response.
 *
 * Accepts both k6 native responses (k6/http RefinedResponse) and SafeResponse
 * via duck-typing (status/body/headers/timings). Returns true if captured.
 */
// Loose response shape — accepts both k6 RefinedResponse and SafeResponse via duck-typing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyResponse = any;

export function captureUnexpectedResponse(
  response: AnyResponse,
  ctx: CaptureContext = {}
): boolean {
  if (!isCaptureEnabled()) return false;
  if (statusMatches(response.status, ctx.expectedStatus)) return false;
  if (buffer.length >= maxEntries()) return false;

  const reqHeaders = ctx.headers ?? response.request?.headers;
  const trackId = ctx.trackId ?? lookupHeader(reqHeaders, trackHeaderNames());

  const rawBody = typeof response.body === "string" ? response.body : String(response.body ?? "");
  const { body, truncated } = truncate(rawBody, maxBody());

  const entry: CapturedError = {
    timestamp: new Date().toISOString(),
    vu: typeof __VU !== "undefined" ? __VU : 0,
    iter: typeof __ITER !== "undefined" ? __ITER : 0,
    scenario: ctx.scenario,
    module: ctx.module,
    service: ctx.service,
    method: ctx.method ?? response.request?.method,
    url: ctx.url ?? response.request?.url,
    status: response.status,
    expectedStatus: ctx.expectedStatus,
    trackId,
    contentType: response.headers?.["Content-Type"] ?? response.headers?.["content-type"],
    bodyTruncated: truncated,
    body,
    durationMs: response.timings?.duration,
    tags: ctx.tags,
    extra: ctx.extra,
  };

  buffer.push(entry);

  console.error(
    JSON.stringify({
      level: "error",
      event: "unexpected_status",
      ...entry,
      message: `Unexpected status ${entry.status} (expected ${expectedToString(ctx.expectedStatus) || "?"}) trackId=${trackId ?? "n/a"}`,
    })
  );

  return true;
}

/** Get a snapshot of captured errors (used by handleSummary). */
export function getCapturedErrors(): CapturedError[] {
  return buffer.slice();
}

/** Clear the in-memory buffer (mostly for tests). */
export function clearCapturedErrors(): void {
  buffer.length = 0;
}

/**
 * Build the file map fragment for k6 handleSummary().
 * Returns an object whose keys are file paths and values are stringified JSON.
 * Returns an empty object if no errors were captured (avoids empty files).
 */
export function captureErrorsSummaryFile(filePath: string = "errors.json"): Record<string, string> {
  if (buffer.length === 0) return {};
  const payload = {
    generatedAt: new Date().toISOString(),
    count: buffer.length,
    truncatedBodyMaxChars: maxBody(),
    maxEntriesCap: maxEntries(),
    capHit: buffer.length >= maxEntries(),
    errors: buffer,
  };
  return { [filePath]: JSON.stringify(payload, null, 2) };
}
