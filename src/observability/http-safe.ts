/**
 * Low-level safe HTTP fetch for the observability layer.
 *
 * Wraps native fetch() with three guarantees no caller has to redo:
 *   - configurable timeout via AbortController (default 10s)
 *   - structured error return (never throws on HTTP failure)
 *   - error messages run through maskSensitive() before reaching the caller
 *
 * Previously inlined in ai/observability/observability-clients.ts and
 * reimplemented ad-hoc in infra-metrics-collector.ts (no masking, no
 * structured errors). Consolidated here as the canonical surface.
 */

import { maskSensitive } from "../core/secrets-manager";

export const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

export interface FetchSafeResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export async function fetchSafe<T = unknown>(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<FetchSafeResult<T>> {
  const { timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, ...fetchOpts } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...fetchOpts, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: maskSensitive(String(err)) };
  } finally {
    clearTimeout(timer);
  }
}
