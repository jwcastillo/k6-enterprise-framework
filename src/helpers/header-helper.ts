/** T-009: HeaderHelper — Headers de trazabilidad, autenticacion y localizacion */

import { AuthType } from "../types/config.d";

const FRAMEWORK_VERSION = "0.1.0";
const FRAMEWORK_UA = __ENV.K6_USER_AGENT || `k6-enterprise-framework/${FRAMEWORK_VERSION} k6`;

/**
 * Generate a UUID v4 for use as a correlation or trace ID.
 *
 * T-139: Uses Math.random() which is acceptable for traceability IDs
 * (correlation, trace, request). These IDs are used for observability,
 * NOT for cryptographic purposes (session tokens, CSRF, etc.).
 *
 * Note: crypto.randomUUID() is NOT available in the k6 goja runtime.
 * For Node.js contexts (bin/), use crypto.randomUUID() directly instead.
 *
 * The generated IDs follow RFC 4122 UUID v4 format, producing values
 * like: "550e8400-e29b-41d4-a716-446655440000"
 */
function generateUUID(): string {
  const hex = "0123456789abcdef";
  let uuid = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      uuid += "-";
    } else if (i === 14) {
      uuid += "4"; // version 4
    } else if (i === 19) {
      uuid += hex[Math.floor(Math.random() * 4) + 8]; // variant 10xx
    } else {
      uuid += hex[Math.floor(Math.random() * 16)];
    }
  }
  return uuid;
}

export interface TraceHeaders {
  "X-Correlation-ID": string;
  "X-Trace-ID": string;
  "X-Request-ID": string;
}

export interface AuthHeaders {
  Authorization?: string;
  "X-API-Key"?: string;
}

export interface LocalizationHeaders {
  "Accept-Language"?: string;
  "X-Country"?: string;
}

export interface InstrumentationHeaders {
  traceparent?: string;
  b3?: string;
  "uber-trace-id"?: string;
  "X-Pyroscope-Labels"?: string;
}

export type HeaderMap = Record<string, string>;

export class HeaderHelper {
  /** Generate unique per-request traceability headers */
  static tracing(): TraceHeaders {
    return {
      "X-Correlation-ID": generateUUID(),
      "X-Trace-ID": generateUUID(),
      "X-Request-ID": generateUUID(),
    };
  }

  /** Build authentication headers by type */
  static auth(type: AuthType, credentials: Record<string, string>): AuthHeaders {
    switch (type) {
      case "bearer":
        return { Authorization: `Bearer ${credentials["token"] ?? ""}` };
      case "basic": {
        const encoded = btoa(`${credentials["username"] ?? ""}:${credentials["password"] ?? ""}`);
        return { Authorization: `Basic ${encoded}` };
      }
      case "oauth2":
        return { Authorization: `Bearer ${credentials["accessToken"] ?? ""}` };
      case "apikey":
        return {
          [`${credentials["header"] ?? "X-API-Key"}`]: credentials["key"] ?? "",
        } as AuthHeaders;
      case "none":
      default:
        return {};
    }
  }

  /** Build localization headers */
  static localization(language = "en-US", country?: string): LocalizationHeaders {
    const headers: LocalizationHeaders = { "Accept-Language": language };
    if (country) headers["X-Country"] = country;
    return headers;
  }

  /** Framework User-Agent identifier */
  static userAgent(): HeaderMap {
    return { "User-Agent": FRAMEWORK_UA };
  }

  /** Instrumentation headers (injected conditionally via env vars) */
  static instrumentation(traceId?: string): InstrumentationHeaders {
    const headers: InstrumentationHeaders = {};

    // T-158: traceparent format controlled by K6_TEMPO_PROPAGATION (default: w3c)
    // Supported: w3c, b3, jaeger. Invalid values throw at test start (fail-fast).
    if (__ENV["K6_TEMPO_ENABLED"] === "true") {
      const propagation = (__ENV["K6_TEMPO_PROPAGATION"] || "w3c").toLowerCase();
      const SUPPORTED_PROPAGATIONS = ["w3c", "b3", "jaeger"];
      if (!SUPPORTED_PROPAGATIONS.includes(propagation)) {
        throw new Error(
          `Unsupported propagation: '${propagation}'. Use: ${SUPPORTED_PROPAGATIONS.join(", ")}`
        );
      }
      const tid = traceId ?? generateUUID().replace(/-/g, "");
      const traceId32 = tid.padEnd(32, "0").slice(0, 32);
      const spanId16 = tid.slice(0, 16).padEnd(16, "0");
      if (propagation === "w3c") {
        headers["traceparent"] = `00-${traceId32}-${spanId16}-01`;
      } else if (propagation === "b3") {
        // B3 single-header format
        headers["b3"] = `${traceId32}-${spanId16}-1`;
      } else if (propagation === "jaeger") {
        // Jaeger uber-trace-id format: {traceId}:{spanId}:{parentSpanId}:{flags}
        headers["uber-trace-id"] = `${traceId32}:${spanId16}:0:1`;
      }
    }

    if (__ENV["K6_PYROSCOPE_ENABLED"] === "true") {
      // T-136: Include client label for per-client Pyroscope data isolation (CHK-SEC-065).
      // Dashboards filter by this label so client A cannot see profiling data of client B.
      const clientLabel = __ENV["K6_CLIENT"] ? `,client=${__ENV["K6_CLIENT"]}` : "";
      headers["X-Pyroscope-Labels"] = `k6_test=true${clientLabel}`;
    }

    return headers;
  }

  /** Merge all standard headers into a single map */
  static standard(authType: AuthType, credentials: Record<string, string>): HeaderMap {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...HeaderHelper.tracing(),
      ...HeaderHelper.auth(authType, credentials),
      ...HeaderHelper.userAgent(),
      ...HeaderHelper.instrumentation(),
    };
  }
}
