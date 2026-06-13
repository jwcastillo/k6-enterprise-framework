// T-099: Patrones reutilizables de coordinacion via Redis
//
// Three reusable patterns for VU coordination:
//   1. User Pool       — unique per-VU data assignment without collisions
//   2. Rate Limiting   — distributed request rate limiting across all VUs
//   3. Real-time Stats — atomic counters for live metrics during test execution
//
// All patterns use namespaced keys to avoid collisions (CHK-API-346):
//   user:*    — user pool data
//   rate:*    — rate limiting counters
//   stats:*   — statistics counters
//
// Usage: import these utilities in your k6 scenario scripts.
// Requires: RedisHelper initialized with xk6-redis binary.

import { RedisHelper } from '../helpers/redis-helper';

// ── Pattern 1: User Pool ──────────────────────────────────────────────────────
//
// Assigns unique test data to each VU by index.
// Supports pools larger or smaller than VU count.
//
// Pool exhaustion policy:
//   'recycle'  (default) — VUs wrap around and reuse data (modulo)
//   'error'              — VU throws error when pool is exhausted
//
// Example:
//   const pool = new UserPool(redis, 'user:', { policy: 'recycle' });
//   // In setup(): await pool.load(usersArray);
//   // In default(): const user = await pool.getForVU(__VU, __ITER);

export type PoolExhaustionPolicy = 'recycle' | 'error';

export interface UserPoolOptions {
  /** Key prefix (default: 'user:') */
  prefix?: string;
  /** What to do when VUs > pool size (default: 'recycle') */
  policy?: PoolExhaustionPolicy;
}

export class UserPool {
  private readonly redis: RedisHelper;
  private readonly prefix: string;
  private readonly policy: PoolExhaustionPolicy;
  private poolSize = 0;

  constructor(redis: RedisHelper, options: UserPoolOptions = {}) {
    this.redis = redis;
    this.prefix = options.prefix ?? 'user:';
    this.policy = options.policy ?? 'recycle';
  }

  /**
   * Load user data into Redis during setup().
   * Each user is stored as a hash at "{prefix}{index}".
   * Also stores pool size at "{prefix}_meta:size".
   */
  async load(users: Array<Record<string, string>>): Promise<number> {
    this.poolSize = users.length;
    // Store pool size for cross-VU access
    await this.redis.set(`${this.prefix}_meta:size`, String(users.length));

    let loaded = 0;
    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      if (!user) continue;
      await this.redis.hmset(`${this.prefix}${i}`, user);
      loaded++;
    }
    return loaded;
  }

  /**
   * Get data for current VU (no collisions for VUs <= pool size).
   * Uses __VU % poolSize for assignment (SC-096, CHK-API-343).
   *
   * @param vu    k6 __VU variable
   * @param iter  k6 __ITER variable (unused for index assignment, kept for API clarity)
   */
  async getForVU(vu: number, _iter: number): Promise<Record<string, string> | null> {
    // Refresh pool size from Redis (shared across VUs)
    if (this.poolSize === 0) {
      const sizeStr = await this.redis.get(`${this.prefix}_meta:size`);
      this.poolSize = sizeStr ? parseInt(sizeStr, 10) : 0;
    }

    if (this.poolSize === 0) {
      throw new Error(`[UserPool] Pool is empty. Call load() in setup() first.`);
    }

    // For pool larger than VUs: each VU gets unique slot (1-indexed VU → 0-indexed pool)
    // For pool smaller than VUs: wrap around with modulo (documented behavior EC-RED-008)
    const index = (vu - 1) % this.poolSize;

    if (this.policy === 'error' && vu - 1 >= this.poolSize) {
      throw new Error(
        `[UserPool] Pool exhausted: VU ${vu} exceeds pool size ${this.poolSize}. ` +
        `Increase pool size or change policy to 'recycle'.`
      );
    }

    return this.redis.hgetall(`${this.prefix}${index}`);
  }

  /**
   * Clean up all pool keys. Call in teardown().
   */
  async cleanup(): Promise<number> {
    const deleted = await this.redis.deleteByPrefix(this.prefix);
    this.poolSize = 0;
    return deleted;
  }
}

// ── Pattern 2: Distributed Rate Limiter ───────────────────────────────────────
//
// Coordinates request rate across all VUs using Redis atomic counters.
// Uses INCR + EXPIRE pattern for per-window counting.
//
// Accuracy: ±2% at high concurrency (atomic INCR guarantees no lost counts).
//
// Example:
//   const limiter = new DistributedRateLimiter(redis, 'payment', 100);
//   // In default(): if (!(await limiter.allow())) { return; }

export class DistributedRateLimiter {
  private readonly redis: RedisHelper;
  private readonly endpoint: string;
  private readonly maxPerMinute: number;
  private readonly keyPrefix = 'rate:';

  /**
   * @param redis          RedisHelper instance
   * @param endpoint       Endpoint identifier (used in key namespace)
   * @param maxPerMinute   Maximum requests per minute across all VUs
   */
  constructor(redis: RedisHelper, endpoint: string, maxPerMinute: number) {
    this.redis = redis;
    this.endpoint = endpoint;
    this.maxPerMinute = maxPerMinute;
  }

  /**
   * Check if a request is allowed under the rate limit.
   * Uses current minute as the window key.
   * Returns true if request is allowed, false if rate limit exceeded.
   *
   * Precision: ±2% (SC-097, CHK-API-344)
   */
  async allow(): Promise<boolean> {
    const windowKey = this.getWindowKey();
    const count = await this.redis.incr(windowKey);

    // Set expiry on first request in window (60s window)
    if (count === 1) {
      await this.redis.expire(windowKey, 60);
    }

    return count <= this.maxPerMinute;
  }

  /**
   * Get current request count for this window (for monitoring).
   */
  async currentCount(): Promise<number> {
    const windowKey = this.getWindowKey();
    const val = await this.redis.get(windowKey);
    return val ? parseInt(val, 10) : 0;
  }

  /** Get remaining TTL of current window in seconds */
  async windowTtl(): Promise<number> {
    return this.redis.ttl(this.getWindowKey());
  }

  private getWindowKey(): string {
    // Window: current minute (YYYYMMDD_HHMM)
    const now = new Date();
    const window = `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}_${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}`;
    return `${this.keyPrefix}${this.endpoint}:${window}`;
  }
}

// ── Pattern 3: Real-time Stats Counters ───────────────────────────────────────
//
// Atomic counters for live metrics during test execution.
// All counters use "stats:" prefix (CHK-API-346).
// Counters are queryable via get() during execution.
//
// Example:
//   const stats = new StatsCounter(redis, 'checkout');
//   // In default():
//   //   await stats.inc('requests');
//   //   if (response.status !== 200) await stats.inc('errors');
//   //   await stats.incBy('latency_ms', response.timings.duration);
//
//   // Query live stats:
//   //   const counts = await stats.getAll(['requests', 'errors']);

export class StatsCounter {
  private readonly redis: RedisHelper;
  private readonly namespace: string;
  private readonly keyPrefix = 'stats:';

  /**
   * @param redis      RedisHelper instance
   * @param namespace  Test/scenario namespace for key isolation
   */
  constructor(redis: RedisHelper, namespace: string) {
    this.redis = redis;
    this.namespace = namespace;
  }

  /**
   * Increment a named counter by 1.
   * Counter is created automatically on first increment.
   * Returns the new counter value (CHK-API-345).
   */
  async inc(counter: string): Promise<number> {
    return this.redis.incr(this.key(counter));
  }

  /**
   * Increment a named counter by a custom amount.
   * Useful for accumulating latency totals.
   */
  async incBy(counter: string, amount: number): Promise<number> {
    return this.redis.incrby(this.key(counter), Math.round(amount));
  }

  /**
   * Get the current value of a counter.
   * Returns 0 if counter has never been incremented.
   */
  async get(counter: string): Promise<number> {
    const val = await this.redis.get(this.key(counter));
    return val ? parseInt(val, 10) : 0;
  }

  /**
   * Get multiple counter values in a single round-trip.
   * Returns a map of counter name → current value.
   */
  async getAll(counters: string[]): Promise<Record<string, number>> {
    const keys = counters.map(c => this.key(c));
    const values = await this.redis.mget(keys);
    const result: Record<string, number> = {};
    for (let i = 0; i < counters.length; i++) {
      result[counters[i]] = values[i] ? parseInt(values[i]!, 10) : 0;
    }
    return result;
  }

  /**
   * Reset a counter to zero (or delete it).
   */
  async reset(counter: string): Promise<void> {
    await this.redis.del(this.key(counter));
  }

  /**
   * Clean up all counters for this namespace. Call in teardown().
   */
  async cleanup(): Promise<number> {
    return this.redis.deleteByPrefix(`${this.keyPrefix}${this.namespace}:`);
  }

  private key(counter: string): string {
    return `${this.keyPrefix}${this.namespace}:${counter}`;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/**
 * Parse a CSV line into an array of trimmed string values.
 * Handles quoted values and commas inside quotes.
 */
export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Parse CSV content (string) into an array of objects using the first row as headers.
 * Handles empty lines, missing columns, and special characters.
 *
 * @param csv      Raw CSV string (as returned by k6's open())
 * @param warnFn   Optional warning function (default: console.warn)
 */
export function parseCsv(
  csv: string,
  warnFn?: (msg: string) => void
): Array<Record<string, string>> {
  const warn = warnFn ?? console.warn;
  const lines = csv.split(/\r?\n/).filter(l => l.trim() !== '');

  if (lines.length < 2) {
    warn('[parseCsv] CSV has no data rows (header-only or empty)');
    return [];
  }

  const headers = parseCsvLine(lines[0]);
  const results: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    if (values.length === 0 || (values.length === 1 && values[0] === '')) continue;

    const row: Record<string, string> = {};
    let hasData = false;

    for (let j = 0; j < headers.length; j++) {
      const header = headers[j];
      const value = values[j] ?? '';
      if (j < values.length) {
        row[header] = value;
        if (value !== '') hasData = true;
      } else {
        // Missing column — warn but continue (EC-RED-006)
        warn(`[parseCsv] Row ${i + 1}: missing column "${header}" — using empty string`);
        row[header] = '';
      }
    }

    if (values.length > headers.length) {
      warn(`[parseCsv] Row ${i + 1}: extra columns ignored (${values.length} vs ${headers.length} headers)`);
    }

    if (hasData) {
      results.push(row);
    }
  }

  return results;
}
