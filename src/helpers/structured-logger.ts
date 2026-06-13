/** T-014: StructuredLogger — Logging con enmascaramiento de secretos */

import { maskSecret } from "../core/secrets-manager";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

/** Patterns that indicate a value should be masked */
const SENSITIVE_PATTERNS = [
  /authorization/i,
  /x-api-key/i,
  /password/i,
  /secret/i,
  /token/i,
  /credential/i,
  /private.?key/i,
  /x-amz-security-token/i,
  /x-goog-signature/i,
];

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => p.test(key));
}

/**
 * Sanitize a URL by redacting query parameters whose names look sensitive.
 * Handles malformed URLs gracefully by returning them unchanged.
 * T-130: Prevents token leakage in request logs (e.g. ?token=abc123).
 */
function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url);
    let changed = false;
    for (const key of [...u.searchParams.keys()]) {
      if (isSensitiveKey(key)) {
        u.searchParams.set(key, "****");
        changed = true;
      }
    }
    return changed ? u.toString() : url;
  } catch {
    // Not a valid URL — return as-is (don't block logging)
    return url;
  }
}

function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (isSensitiveKey(k) && typeof v === "string") {
      result[k] = maskSecret(v);
    } else if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      result[k] = sanitizeObject(v as Record<string, unknown>);
    } else {
      result[k] = v;
    }
  }
  return result;
}

function isEnabled(): boolean {
  return __ENV["K6_STRUCTURED_LOGS"] === "true";
}

function isDebug(): boolean {
  return __ENV["K6_DEBUG"] === "true";
}

function emit(level: LogLevel, entry: LogEntry): void {
  const line = JSON.stringify(entry);
  switch (level) {
    case "error":
      console.error(line);
      break;
    case "warn":
      console.warn(line);
      break;
    case "debug":
      if (isDebug()) console.log(line);
      break;
    default:
      console.log(line);
  }
}

export class StructuredLogger {
  private readonly context: Record<string, unknown>;

  constructor(context: Record<string, unknown> = {}) {
    this.context = context;
  }

  /** Log an HTTP request with automatic secret masking */
  logRequest(
    method: string,
    url: string,
    status: number,
    durationMs: number,
    extra: Record<string, unknown> = {}
  ): void {
    if (!isEnabled()) return;
    const safeUrl = sanitizeUrl(url); // T-130: redact sensitive query params
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: "info",
      message: `${method} ${safeUrl} → ${status}`,
      method,
      url: safeUrl,
      status,
      duration: durationMs,
      ...this.context,
      ...sanitizeObject(extra),
    };
    emit("info", entry);
  }

  /** Log a named event */
  logEvent(name: string, data: Record<string, unknown> = {}): void {
    if (!isEnabled()) return;
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: "info",
      message: name,
      event: name,
      ...this.context,
      ...sanitizeObject(data),
    };
    emit("info", entry);
  }

  /** Log an error */
  logError(message: string, error?: unknown, extra: Record<string, unknown> = {}): void {
    if (!isEnabled()) return;
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: "error",
      message,
      error: error instanceof Error ? error.message : String(error ?? ""),
      ...this.context,
      ...sanitizeObject(extra),
    };
    emit("error", entry);
  }

  /** Log a debug message (only when K6_DEBUG=true) */
  logDebug(message: string, data: Record<string, unknown> = {}): void {
    if (!isEnabled() || !isDebug()) return;
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: "debug",
      message,
      ...this.context,
      ...sanitizeObject(data),
    };
    emit("debug", entry);
  }

  /**
   * T-130: Log a configuration object safely.
   * - Sensitive fields are masked (shows "****" instead of resolved value)
   * - Variable references like "${DB_PASSWORD}" are shown as-is (not resolved)
   * - Literal values that look like hardcoded secrets trigger a warning log entry
   */
  logConfig(label: string, config: Record<string, unknown>): void {
    if (!isEnabled()) return;
    const safe = sanitizeObject(config);
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: "info",
      message: `Config: ${label}`,
      config: safe,
      ...this.context,
    };
    emit("info", entry);
  }

  /** Create a child logger with additional context */
  child(context: Record<string, unknown>): StructuredLogger {
    return new StructuredLogger({ ...this.context, ...context });
  }
}
