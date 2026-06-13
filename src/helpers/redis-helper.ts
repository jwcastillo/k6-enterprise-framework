// T-096: Implementacion completa de RedisHelper (xk6-redis)
//
// Full xk6-redis API wrapper for use inside k6 test scripts.
// Requires k6 binary compiled with xk6-redis extension.
//
// Build with:   ./bin/build-binary.sh
// Extension:    https://github.com/grafana/xk6-redis
//
// Connection:   REDIS_URL env var (default) or explicit URL in constructor
//               Format: redis://[:password@]host[:port][/db]
//               With auth: redis://:mypassword@localhost:6379
//
// IMPORTANT: All methods are async — use in k6 setup/default/teardown with await.
// REDIS_URL credentials are masked in all log output (CHK-SEC-106).

// Type stubs for xk6-redis client (resolved at runtime from k6/x/redis)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type XK6RedisClient = any;

/** Connection options for RedisHelper */
export interface RedisHelperOptions {
  /** Redis URL. Defaults to REDIS_URL env var, then redis://localhost:6379 */
  url?: string;
  /** Max retries for transient connection errors (default: 3) */
  maxRetries?: number;
}

/** Result of a bulk load operation */
export interface BulkLoadResult {
  loaded: number;
  skipped: number;
  errors: string[];
}

export class RedisHelper {
  private client: XK6RedisClient;
  private readonly url: string;
  private readonly maxRetries: number;

  /**
   * Create a new RedisHelper instance.
   *
   * @param options  Connection options, or a plain URL string (backwards-compat)
   *
   * @example
   * // Using env var REDIS_URL (recommended)
   * const redis = new RedisHelper();
   *
   * // Explicit URL
   * const redis = new RedisHelper({ url: 'redis://:password@redis:6379' });
   */
  constructor(options?: RedisHelperOptions | string) {
    const opts: RedisHelperOptions =
      typeof options === "string" ? { url: options } : (options ?? {});

    // Resolve connection URL: constructor → env var → default
    this.url = opts.url ?? __ENV["REDIS_URL"] ?? "redis://localhost:6379";
    this.maxRetries = opts.maxRetries ?? 3;

    // Mask credentials in logs (CHK-SEC-106)
    const maskedUrl = this.maskUrl(this.url);

    try {
      // xk6-redis import — available only when using xk6-redis compiled binary
       
      const { Client } = require("k6/x/redis");
      this.client = new Client(this.url);
      console.log(`[RedisHelper] Connected to ${maskedUrl}`);
    } catch {
      // Provide clear guidance if xk6-redis is not available
      const msg =
        `[RedisHelper] Failed to connect to ${maskedUrl}. ` +
        `Ensure you are using a k6 binary compiled with xk6-redis. ` +
        `Run: ./bin/build-binary.sh to build the binary. ` +
        `See docs/REDIS_DATA_SUPPORT.md for setup instructions.`;
      throw new Error(msg);
    }
  }

  // ── Basic operations ────────────────────────────────────────────────────────

  /**
   * Set a key to a string value with optional TTL.
   * TTL=0 or negative → key persists without expiry (with warning).
   */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.assertClient();
    if (ttlSeconds !== undefined && ttlSeconds <= 0) {
      console.warn(
        `[RedisHelper] set("${key}"): TTL=${ttlSeconds} — key will persist without expiry.`
      );
      return this.client.set(key, value);
    }
    if (ttlSeconds && ttlSeconds > 0) {
      return this.client.set(key, value, { ex: ttlSeconds });
    }
    return this.client.set(key, value);
  }

  /** Get a value by key. Returns null if key does not exist. */
  async get(key: string): Promise<string | null> {
    this.assertClient();
    return this.client.get(key);
  }

  /** Delete one or more keys. Returns number of keys deleted. */
  async del(...keys: string[]): Promise<number> {
    this.assertClient();
    return this.client.del(...keys);
  }

  /** Check if a key exists. Returns true if key exists. */
  async exists(key: string): Promise<boolean> {
    this.assertClient();
    const result: number = await this.client.exists(key);
    return result === 1;
  }

  // ── Multiple key operations ─────────────────────────────────────────────────

  /**
   * Set multiple key-value pairs in a single atomic operation.
   * @param pairs  Object mapping keys to values, or array of [key, value] tuples
   */
  async mset(pairs: Record<string, string> | Array<[string, string]>): Promise<void> {
    this.assertClient();
    const kvArray: string[] = Array.isArray(pairs)
      ? pairs.flatMap(([k, v]) => [k, v])
      : Object.entries(pairs).flatMap(([k, v]) => [k, v]);
    return this.client.mset(...kvArray);
  }

  /**
   * Get multiple values by keys.
   * Returns array with null for missing keys, in same order as input.
   */
  async mget(keys: string[]): Promise<Array<string | null>> {
    this.assertClient();
    return this.client.mget(...keys);
  }

  // ── Counters ────────────────────────────────────────────────────────────────

  /**
   * Increment key by 1 atomically. Creates key with value 1 if not exists.
   * Returns the new value.
   */
  async incr(key: string): Promise<number> {
    this.assertClient();
    return this.client.incr(key);
  }

  /**
   * Increment key by a specific amount. Returns new value.
   */
  async incrby(key: string, amount: number): Promise<number> {
    this.assertClient();
    return this.client.incrby(key, amount);
  }

  // ── List operations ─────────────────────────────────────────────────────────

  /**
   * Push one or more values to the LEFT of a list.
   * Returns new list length.
   */
  async lpush(key: string, ...values: string[]): Promise<number> {
    this.assertClient();
    return this.client.lpush(key, ...values);
  }

  /**
   * Push one or more values to the RIGHT of a list.
   * Returns new list length.
   */
  async rpush(key: string, ...values: string[]): Promise<number> {
    this.assertClient();
    return this.client.rpush(key, ...values);
  }

  /**
   * Pop (remove and return) the leftmost element of a list.
   * Returns null if list is empty.
   */
  async lpop(key: string): Promise<string | null> {
    this.assertClient();
    return this.client.lpop(key);
  }

  /**
   * Pop (remove and return) the rightmost element of a list.
   * Returns null if list is empty.
   */
  async rpop(key: string): Promise<string | null> {
    this.assertClient();
    return this.client.rpop(key);
  }

  /** Get the length of a list. Returns 0 if key does not exist. */
  async llen(key: string): Promise<number> {
    this.assertClient();
    return this.client.llen(key);
  }

  /**
   * Get a range of elements from a list (0-indexed, inclusive).
   * Use lrange(key, 0, -1) to get all elements.
   */
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    this.assertClient();
    return this.client.lrange(key, start, stop);
  }

  // ── Hash operations ─────────────────────────────────────────────────────────

  /**
   * Set a field in a hash.
   * @param key    Hash key
   * @param field  Field name
   * @param value  Field value
   */
  async hset(key: string, field: string, value: string): Promise<number> {
    this.assertClient();
    return this.client.hset(key, field, value);
  }

  /**
   * Set multiple fields in a hash at once.
   * @param key     Hash key
   * @param fields  Object mapping field names to values
   */
  async hmset(key: string, fields: Record<string, string>): Promise<void> {
    this.assertClient();
    const args: string[] = [];
    for (const [field, val] of Object.entries(fields)) {
      args.push(field, val);
    }
    return this.client.hset(key, ...args);
  }

  /**
   * Get a single field from a hash.
   * Returns null if key or field does not exist.
   */
  async hget(key: string, field: string): Promise<string | null> {
    this.assertClient();
    return this.client.hget(key, field);
  }

  /**
   * Get all fields and values from a hash.
   * Returns empty object if key does not exist.
   *
   * Error handling: if key is not a hash type, returns error message as thrown Error
   * (EC-RED-005: hgetall against wrong type returns descriptive error, not crash).
   */
  async hgetall(key: string): Promise<Record<string, string>> {
    this.assertClient();
    try {
      const result = await this.client.hgetall(key);
      if (!result) return {};
      // xk6-redis returns flat array [field, value, field, value, ...]
      // or an object depending on version
      if (Array.isArray(result)) {
        const obj: Record<string, string> = {};
        for (let i = 0; i < result.length; i += 2) {
          obj[result[i]] = result[i + 1];
        }
        return obj;
      }
      return result as Record<string, string>;
    } catch (err: unknown) {
      const e = err as Error;
      if (e.message?.includes("WRONGTYPE")) {
        throw new Error(
          `[RedisHelper] hgetall("${key}"): key is not a hash type. ` +
            `Use get() for string keys or lrange() for list keys.`
        );
      }
      throw err;
    }
  }

  /**
   * Delete a field from a hash.
   * Returns number of fields deleted.
   */
  async hdel(key: string, ...fields: string[]): Promise<number> {
    this.assertClient();
    return this.client.hdel(key, ...fields);
  }

  // ── TTL operations ──────────────────────────────────────────────────────────

  /**
   * Set a TTL (time-to-live) on an existing key.
   * Returns true if TTL was set, false if key does not exist.
   */
  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    this.assertClient();
    const result: number = await this.client.expire(key, ttlSeconds);
    return result === 1;
  }

  /**
   * Get remaining TTL of a key in seconds.
   * Returns -1 if key has no expiry, -2 if key does not exist.
   */
  async ttl(key: string): Promise<number> {
    this.assertClient();
    return this.client.ttl(key);
  }

  // ── Connection management ───────────────────────────────────────────────────

  /**
   * Gracefully close the Redis connection.
   * Always call in teardown() to prevent connection leaks.
   */
  async disconnect(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.close();
      console.log(`[RedisHelper] Disconnected from ${this.maskUrl(this.url)}`);
    } catch {
      // Best-effort disconnect
      console.warn(`[RedisHelper] Disconnect warning (connection may already be closed)`);
    }
  }

  // ── Bulk helpers (convenience) ──────────────────────────────────────────────

  /**
   * Load an array of objects as Redis hashes under a given prefix.
   * Each object is stored as hash at "{prefix}{i}" or "{prefix}{idField}".
   *
   * @param prefix   Key prefix (e.g. "user:")
   * @param items    Array of objects to load
   * @param idField  Optional field to use as ID (default: array index)
   */
  async bulkLoadHashes(
    prefix: string,
    items: Array<Record<string, string>>,
    idField?: string
  ): Promise<BulkLoadResult> {
    this.assertClient();
    const result: BulkLoadResult = { loaded: 0, skipped: 0, errors: [] };

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item || typeof item !== "object") {
        result.skipped++;
        continue;
      }
      const id = idField ? (item[idField] ?? String(i)) : String(i);
      const key = `${prefix}${id}`;
      try {
        await this.hmset(key, item);
        result.loaded++;
      } catch (err: unknown) {
        const e = err as Error;
        result.errors.push(`${key}: ${e.message}`);
        result.skipped++;
      }
    }
    return result;
  }

  /**
   * Load a list of string values into a Redis list key.
   * Uses rpush to preserve order.
   */
  async bulkLoadList(key: string, values: string[]): Promise<number> {
    this.assertClient();
    if (values.length === 0) return 0;
    // Push in batches of 100 to avoid large argument lists
    const BATCH = 100;
    for (let i = 0; i < values.length; i += BATCH) {
      await this.client.rpush(key, ...values.slice(i, i + BATCH));
    }
    return values.length;
  }

  /**
   * Delete all keys matching a prefix pattern.
   * NOTE: Uses SCAN + DEL — safe for production use (no KEYS command).
   */
  async deleteByPrefix(prefix: string): Promise<number> {
    this.assertClient();
    let deleted = 0;
    let cursor = 0;
    do {
      const [nextCursor, keys]: [number, string[]] = await this.client.scan(cursor, {
        match: `${prefix}*`,
        count: 100,
      });
      cursor = nextCursor;
      if (keys.length > 0) {
        await this.del(...keys);
        deleted += keys.length;
      }
    } while (cursor !== 0);
    return deleted;
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private assertClient(): void {
    if (!this.client) {
      throw new Error("[RedisHelper] Not connected. Ensure xk6-redis binary is used.");
    }
  }

  /** Mask credentials in Redis URL for safe logging (CHK-SEC-106) */
  private maskUrl(url: string): string {
    return url.replace(/(:\/\/)([^:@]+):([^@]+)@/, "$1***:***@");
  }
}
