/** T-008: RequestHelper — Cliente HTTP con instrumentacion */

import http, { RefinedResponse, ResponseType } from "k6/http";
import { HeaderHelper, HeaderMap } from "./header-helper";
import { AuthType } from "../types/config.d";
import type { SafeResponse } from "@types-k6/safe-response";
// Compat re-export: SafeResponse is this module's public return type. Canonical
// home stays @types-k6/safe-response (ARC-01); consumers may import from either.
export type { SafeResponse } from "@types-k6/safe-response";
import {
  isTracingEnabled,
  currentTraceRoot,
  beginIteration,
  buildIterationTraceHeaders,
} from "@observability/tracing-instrumentation";

export interface RequestOptions {
  authType?: AuthType;
  credentials?: Record<string, string>;
  extraHeaders?: HeaderMap;
  timeout?: number;
  tags?: Record<string, string>;
  /**
   * OBS2-03: Per-call opt-out for distributed trace header injection.
   * Default true when K6_TEMPO_ENABLED=true. Pass false to suppress
   * traceparent/tracestate (or B3/Jaeger equivalents) for this single call.
   * Precedence: per-call opts.tracing > defaultOptions.tracing > implicit true.
   */
  tracing?: boolean;
}

function toSafeResponse(res: RefinedResponse<ResponseType>): SafeResponse {
  return {
    status: res.status,
    body: res.body?.toString() ?? "",
    headers: res.headers as Record<string, string>,
    timings: {
      duration: res.timings.duration,
      waiting: res.timings.waiting,
      receiving: res.timings.receiving,
      sending: res.timings.sending,
    },
    json<T = unknown>(selector?: string): T | null {
      try {
        const parsed = JSON.parse(res.body?.toString() ?? "null");
        if (!selector) return parsed as T;
        const parts = selector.split(".");
        let val: unknown = parsed;
        for (const part of parts) {
          if (val == null || typeof val !== "object") return null;
          val = (val as Record<string, unknown>)[part];
        }
        return val as T;
      } catch {
        return null;
      }
    },
  };
}

/** Build query string from object, skipping undefined/null values */
function buildQueryString(
  params: Record<string, string | number | boolean | null | undefined>
): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

export class RequestHelper {
  private readonly baseUrl: string;
  private readonly defaultOptions: RequestOptions;

  constructor(baseUrl: string, defaultOptions: RequestOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.defaultOptions = defaultOptions;
  }

  private buildHeaders(opts: RequestOptions): HeaderMap {
    const authType = opts.authType ?? this.defaultOptions.authType ?? "none";
    const credentials = opts.credentials ?? this.defaultOptions.credentials ?? {};
    const standardHeaders = HeaderHelper.standard(authType, credentials);

    // OBS2-03: Auto-inject distributed trace headers when K6_TEMPO_ENABLED=true
    // and the call has not opted out via { tracing: false }. The iteration's
    // trace root is lazy-initialized so scenarios do NOT need to call
    // beginIteration() explicitly — the first RequestHelper call of an
    // iteration sets up the per-VU per-__ITER cache entry automatically.
    //
    // Precedence: per-call opts.tracing > defaultOptions.tracing > implicit true.
    //
    // Known limitation: for very long VU lifetimes (> 100K iterations) the
    // _iterationCache Map grows without bound unless scenarios call
    // endIteration() in their iteration teardown. ~10 MB per VU worst case
    // is acceptable within the k6 VU memory budget.
    const tracingEnabled = isTracingEnabled();
    const callTracingOptIn = opts.tracing ?? this.defaultOptions.tracing ?? true;
    if (tracingEnabled && callTracingOptIn) {
      if (!currentTraceRoot()) beginIteration();
      const traceHeaders = buildIterationTraceHeaders();
      return {
        ...standardHeaders,
        ...(opts.extraHeaders ?? {}),
        ...traceHeaders,
      };
    }

    return {
      ...standardHeaders,
      ...(opts.extraHeaders ?? {}),
    };
  }

  private buildParams(opts: RequestOptions): {
    headers: HeaderMap;
    timeout?: number;
    tags?: Record<string, string>;
  } {
    const params: { headers: HeaderMap; timeout?: number; tags?: Record<string, string> } = {
      headers: this.buildHeaders(opts),
    };
    const timeout = opts.timeout ?? this.defaultOptions.timeout;
    if (timeout) params.timeout = timeout;
    const tags = { ...(this.defaultOptions.tags ?? {}), ...(opts.tags ?? {}) };
    if (Object.keys(tags).length) params.tags = tags;
    return params;
  }

  get(
    path: string,
    queryParams?: Record<string, string | number | boolean | null | undefined>,
    opts: RequestOptions = {}
  ): SafeResponse {
    const qs = queryParams ? buildQueryString(queryParams) : "";
    const res = http.get(`${this.baseUrl}${path}${qs}`, this.buildParams(opts));
    return toSafeResponse(res);
  }

  post(path: string, body: unknown, opts: RequestOptions = {}): SafeResponse {
    const res = http.post(`${this.baseUrl}${path}`, JSON.stringify(body), this.buildParams(opts));
    return toSafeResponse(res);
  }

  put(path: string, body: unknown, opts: RequestOptions = {}): SafeResponse {
    const res = http.put(`${this.baseUrl}${path}`, JSON.stringify(body), this.buildParams(opts));
    return toSafeResponse(res);
  }

  patch(path: string, body: unknown, opts: RequestOptions = {}): SafeResponse {
    const res = http.patch(`${this.baseUrl}${path}`, JSON.stringify(body), this.buildParams(opts));
    return toSafeResponse(res);
  }

  delete(path: string, opts: RequestOptions = {}): SafeResponse {
    const res = http.del(`${this.baseUrl}${path}`, null, this.buildParams(opts));
    return toSafeResponse(res);
  }
}
