// T-101: Controles de seguridad para la integracion Redis
//
// Security controls:
//   1. Auth enforcement — warn if REDIS_URL has no password in non-local environments
//   2. Credential masking — mask REDIS_URL in all logs
//   3. Value size warning — warn if values > 1MB
//   4. Teardown cleanup enforcement — ensure keys are cleaned up after tests
//
// Import this module in scripts that use RedisHelper for security validation.
// (CHK-SEC-104, CHK-SEC-105, CHK-SEC-106, CHK-SEC-107)

// ── URL masking ───────────────────────────────────────────────────────────────

/**
 * Mask credentials in a Redis URL for safe logging.
 * redis://:password@host:port → redis://***:***@host:port
 * (CHK-SEC-106, CHK-SEC-107)
 */
export function maskRedisUrl(url: string): string {
  return url.replace(/(:\/\/)([^:@]+):([^@]+)@/, "$1***:***@");
}

/**
 * Extract the host:port portion from a Redis URL for display.
 */
export function redisHostFromUrl(url: string): string {
  const masked = maskRedisUrl(url);
  const match = masked.match(/@([^/]+)/);
  if (match) return match[1];
  // No auth in URL — extract host from redis://host:port
  const plain = masked.match(/redis:\/\/([^/]+)/);
  return plain ? plain[1] : masked;
}

// ── Auth enforcement ──────────────────────────────────────────────────────────

/** Local env-name discriminator for redis auth warnings. Distinct from types/config.d.ts::Environment which is the framework-wide enum. */
type RedisEnvironment = "local" | "development" | "staging" | "production" | string;

/**
 * Warn if REDIS_URL does not contain a password in non-local environments.
 * Does NOT block execution — emits console.warn only (CHK-SEC-104).
 *
 * @param url   Redis URL (defaults to REDIS_URL env var)
 * @param env   Current environment name
 */
export function warnIfNoRedisAuth(url?: string, env?: RedisEnvironment): void {
  const redisUrl =
    url ?? (typeof __ENV !== "undefined" ? __ENV["REDIS_URL"] : process?.env?.["REDIS_URL"]) ?? "";
  const currentEnv =
    env ?? (typeof __ENV !== "undefined" ? __ENV["K6_ENV"] : process?.env?.["K6_ENV"]) ?? "local";

  const localEnvs = new Set(["local", "development", "dev", "localhost"]);
  if (localEnvs.has(currentEnv.toLowerCase())) return;

  const hasPassword = /@/.test(redisUrl) || redisUrl.includes(":password");
  const hasAuth = redisUrl.match(/redis:\/\/:[^@]+@/);

  if (!hasAuth && !hasPassword) {
    console.warn(
      `[RedisSecurity] WARNING: Redis URL has no password configured for environment "${currentEnv}". ` +
        `Use redis://:password@host:port format. Running without auth is only acceptable for local/development. ` +
        `(CHK-SEC-104)`
    );
  }
}

// ── Value size guard ──────────────────────────────────────────────────────────

const ONE_MB = 1024 * 1024;

/**
 * Warn if a value being stored in Redis exceeds 1MB.
 * Large values degrade Redis performance (EC-RED-011).
 *
 * @param key    Redis key (for diagnostic message)
 * @param value  String value about to be stored
 */
export function warnIfLargeValue(key: string, value: string): void {
  if (value.length > ONE_MB) {
    console.warn(
      `[RedisSecurity] Value for key "${key}" is ${(value.length / ONE_MB).toFixed(2)}MB. ` +
        `Values > 1MB may degrade Redis performance. Consider splitting into smaller keys. (EC-RED-011)`
    );
  }
}

// ── TTL enforcement for sensitive keys ───────────────────────────────────────

/**
 * Default TTL (1 hour) for sensitive keys like auth tokens.
 * (CHK-SEC-105)
 */
export const SENSITIVE_KEY_DEFAULT_TTL_SECONDS = 3600; // 1 hour

/**
 * Prefixes that are considered sensitive and should always have TTL.
 */
export const SENSITIVE_KEY_PREFIXES = ["token:", "auth:", "session:", "secret:"];

/**
 * Check if a Redis key matches a sensitive prefix (token:, auth:, session:, secret:).
 * Distinct from log-field sensitivity (see structured-logger.ts) — this is for
 * Redis-key-level TTL enforcement, not log redaction.
 */
export function hasSensitivePrefix(key: string): boolean {
  return SENSITIVE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** @deprecated renamed to hasSensitivePrefix — kept for backward compatibility. */
export const isSensitiveKey = hasSensitivePrefix;

/**
 * Get the recommended TTL for a key.
 * Returns default TTL for sensitive keys, undefined for others.
 * (CHK-SEC-105)
 */
export function recommendedTtl(key: string, overrideTtl?: number): number | undefined {
  if (overrideTtl !== undefined) return overrideTtl;
  if (hasSensitivePrefix(key)) return SENSITIVE_KEY_DEFAULT_TTL_SECONDS;
  return undefined;
}

// ── Teardown cleanup tracker ──────────────────────────────────────────────────

/**
 * Registry of key prefixes that must be cleaned up in teardown.
 * Add prefixes when loading data; verify cleanup was called.
 *
 * Usage in setup():
 *   const tracker = new CleanupTracker();
 *   tracker.register('user:');
 *   tracker.register('product:');
 *
 * Usage in teardown():
 *   await tracker.verifyCleanup(redis);
 */
export class CleanupTracker {
  private readonly registered: Set<string> = new Set();
  private readonly cleaned: Set<string> = new Set();

  /** Register a prefix that will be loaded and must be cleaned up */
  register(prefix: string): void {
    this.registered.add(prefix);
  }

  /** Mark a prefix as cleaned */
  markCleaned(prefix: string): void {
    this.cleaned.add(prefix);
  }

  /** Check if all registered prefixes have been cleaned */
  get allCleaned(): boolean {
    return [...this.registered].every((p) => this.cleaned.has(p));
  }

  /** Get list of prefixes not yet cleaned */
  get uncleaned(): string[] {
    return [...this.registered].filter((p) => !this.cleaned.has(p));
  }

  /**
   * Warn about any prefixes that were registered but not explicitly cleaned.
   * Called at end of teardown for audit purposes.
   */
  warnIfUnclean(): void {
    const uncleaned = this.uncleaned;
    if (uncleaned.length > 0) {
      console.warn(
        `[RedisSecurity] Teardown incomplete — the following key prefixes may have residual data: ` +
          `${uncleaned.join(", ")}. ` +
          `Call redis.deleteByPrefix() for each prefix in teardown(). (CHK-SEC-105)`
      );
    }
  }
}

// ── Concurrent operation safety note ─────────────────────────────────────────

/**
 * Document Redis atomicity guarantees and limitations for compound operations.
 * (EC-RED-002)
 *
 * Redis guarantees:
 *   - Single commands (GET, SET, INCR, HSET, etc.) are atomic
 *   - MULTI/EXEC transactions are atomic (not directly available in xk6-redis)
 *
 * Limitations:
 *   - Read-modify-write sequences (GET then SET) are NOT atomic
 *   - Use INCR/INCRBY for counter patterns instead of GET + SET
 *   - For conditional updates, use Lua scripts (not available in xk6-redis)
 *
 * Safe patterns:
 *   - Counter: redis.incr(key)                ✓ atomic
 *   - Set with TTL: redis.set(key, val, ttl)  ✓ atomic
 *   - Pool assignment: modulo by VU number    ✓ no writes needed
 *
 * Unsafe patterns (avoid):
 *   - const v = await redis.get(key); await redis.set(key, v + '1')  ✗ race condition
 */
export const REDIS_ATOMICITY_NOTES = {
  safe: ["incr", "incrby", "set-with-ttl", "vu-modulo-pool"],
  unsafe: ["get-then-set", "check-then-act"],
  recommendation: "Use INCR for counters, modulo assignment for pools.",
};
