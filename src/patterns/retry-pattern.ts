/** T-018: Patron de retry — Exponential backoff con jitter */

import { sleep } from "k6";
import { SafeResponse } from "@types-k6/safe-response";

export interface RetryConfig {
  /** Maximum number of attempts (default: 3) */
  maxAttempts?: number;
  /** Base delay in seconds (default: 1) */
  baseDelaySeconds?: number;
  /** Maximum delay cap in seconds (default: 30) */
  maxDelaySeconds?: number;
  /** Jitter factor 0-1 (default: 0.3 = ±30%) */
  jitter?: number;
  /** HTTP status codes that trigger a retry (default: [429, 500, 502, 503, 504]) */
  retryOnStatus?: number[];
  /** Whether to retry on network errors / non-HTTP failures (default: true) */
  retryOnError?: boolean;
}

export interface RetryResult<T> {
  value: T;
  attempts: number;
  lastError?: string;
}

const DEFAULT_RETRY_STATUS = [429, 500, 502, 503, 504];

function shouldRetry(response: SafeResponse, config: RetryConfig): boolean {
  const retryStatus = config.retryOnStatus ?? DEFAULT_RETRY_STATUS;
  return retryStatus.includes(response.status);
}

function computeDelay(attempt: number, config: RetryConfig): number {
  const base = config.baseDelaySeconds ?? 1;
  const max = config.maxDelaySeconds ?? 30;
  const jitterFactor = config.jitter ?? 0.3;

  // Exponential backoff: base * 2^attempt
  const exponential = base * Math.pow(2, attempt);
  const capped = Math.min(exponential, max);

  // Add jitter: ±jitterFactor of the delay
  const jitter = capped * jitterFactor * (Math.random() * 2 - 1);
  return Math.max(0, capped + jitter);
}

/**
 * Execute an HTTP request function with exponential backoff retry.
 * The callback receives the attempt number (0-indexed) and should return a SafeResponse.
 */
export function withRetry(
  fn: (attempt: number) => SafeResponse,
  config: RetryConfig = {}
): RetryResult<SafeResponse> {
  const maxAttempts = config.maxAttempts ?? 3;
  let lastResponse: SafeResponse | null = null;
  let lastError: string | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = fn(attempt);
      lastResponse = response;

      if (!shouldRetry(response, config)) {
        return { value: response, attempts: attempt + 1 };
      }

      lastError = `HTTP ${response.status}`;

      if (attempt < maxAttempts - 1) {
        const delay = computeDelay(attempt, config);
        console.warn(
          `RetryPattern: attempt ${attempt + 1}/${maxAttempts} failed (${lastError}), retrying in ${delay.toFixed(2)}s`
        );
        sleep(delay);
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (!(config.retryOnError ?? true) || attempt === maxAttempts - 1) {
        throw err;
      }
      const delay = computeDelay(attempt, config);
      console.warn(
        `RetryPattern: attempt ${attempt + 1}/${maxAttempts} threw error (${lastError}), retrying in ${delay.toFixed(2)}s`
      );
      sleep(delay);
    }
  }

  if (!lastResponse) {
    throw new Error(`RetryPattern: all ${maxAttempts} attempts failed. Last error: ${lastError}`);
  }

  return { value: lastResponse, attempts: maxAttempts, lastError };
}

/**
 * Simplified retry wrapper that returns just the response.
 * Throws if all retries are exhausted with non-retryable status.
 */
export function retryRequest(fn: () => SafeResponse, config: RetryConfig = {}): SafeResponse {
  return withRetry(() => fn(), config).value;
}
