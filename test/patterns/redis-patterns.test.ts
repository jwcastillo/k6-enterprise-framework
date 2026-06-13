import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the redis-helper module
vi.mock("../../src/helpers/redis-helper", () => {
  return {
    RedisHelper: vi.fn(),
  };
});

import {
  UserPool,
  DistributedRateLimiter,
  StatsCounter,
  parseCsvLine,
  parseCsv,
} from "../../src/patterns/redis-patterns";

// Create a mock RedisHelper instance with all methods
function makeMockRedis() {
  return {
    set: vi.fn(async () => {}),
    get: vi.fn(async () => null),
    del: vi.fn(async () => 1),
    exists: vi.fn(async () => false),
    mset: vi.fn(async () => {}),
    mget: vi.fn(async () => []),
    incr: vi.fn(async () => 1),
    incrby: vi.fn(async () => 1),
    lpush: vi.fn(async () => 1),
    rpush: vi.fn(async () => 1),
    lpop: vi.fn(async () => null),
    rpop: vi.fn(async () => null),
    llen: vi.fn(async () => 0),
    lrange: vi.fn(async () => []),
    hset: vi.fn(async () => 1),
    hmset: vi.fn(async () => {}),
    hget: vi.fn(async () => null),
    hgetall: vi.fn(async () => ({})),
    hdel: vi.fn(async () => 1),
    expire: vi.fn(async () => true),
    ttl: vi.fn(async () => -1),
    disconnect: vi.fn(async () => {}),
    bulkLoadHashes: vi.fn(async () => ({ loaded: 0, skipped: 0, errors: [] })),
    bulkLoadList: vi.fn(async () => 0),
    deleteByPrefix: vi.fn(async () => 0),
  };
}

describe("redis-patterns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── UserPool ──────────────────────────────────────────────────────────

  describe("UserPool", () => {
    describe("load", () => {
      it("loads users into Redis with default prefix", async () => {
        const redis = makeMockRedis();
        const pool = new UserPool(redis as never);

        const users = [
          { username: "alice", email: "alice@test.com" },
          { username: "bob", email: "bob@test.com" },
        ];

        const loaded = await pool.load(users);

        expect(loaded).toBe(2);
        expect(redis.set).toHaveBeenCalledWith("user:_meta:size", "2");
        expect(redis.hmset).toHaveBeenCalledWith("user:0", users[0]);
        expect(redis.hmset).toHaveBeenCalledWith("user:1", users[1]);
      });

      it("uses custom prefix", async () => {
        const redis = makeMockRedis();
        const pool = new UserPool(redis as never, { prefix: "account:" });

        await pool.load([{ username: "alice" }]);

        expect(redis.set).toHaveBeenCalledWith("account:_meta:size", "1");
        expect(redis.hmset).toHaveBeenCalledWith("account:0", { username: "alice" });
      });

      it("skips undefined/null users", async () => {
        const redis = makeMockRedis();
        const pool = new UserPool(redis as never);

        // Create a sparse array
        const users = [{ username: "alice" }];
        // Force one item to be skipped by making it falsy
        (users as unknown[])[1] = undefined;

        const loaded = await pool.load(users as Array<Record<string, string>>);
        expect(loaded).toBe(1);
      });
    });

    describe("getForVU", () => {
      it("returns user data for a VU (1-indexed VU to 0-indexed pool)", async () => {
        const redis = makeMockRedis();
        const pool = new UserPool(redis as never);

        // Simulate pool loaded with 3 users
        redis.get.mockResolvedValue("3");
        redis.hgetall.mockResolvedValue({ username: "alice", email: "alice@test.com" });

        const user = await pool.getForVU(1, 0);
        expect(redis.hgetall).toHaveBeenCalledWith("user:0");
        expect(user).toEqual({ username: "alice", email: "alice@test.com" });
      });

      it("recycles VUs when pool is smaller than VU count (recycle policy)", async () => {
        const redis = makeMockRedis();
        const pool = new UserPool(redis as never, { policy: "recycle" });

        redis.get.mockResolvedValue("3");
        redis.hgetall.mockResolvedValue({ username: "recycled" });

        // VU 4 should wrap to index 0 (4-1) % 3 = 0
        await pool.getForVU(4, 0);
        expect(redis.hgetall).toHaveBeenCalledWith("user:0");
      });

      it("throws when pool is exhausted with error policy", async () => {
        const redis = makeMockRedis();
        const pool = new UserPool(redis as never, { policy: "error" });

        redis.get.mockResolvedValue("2");

        // VU 3 exceeds pool size 2
        await expect(pool.getForVU(3, 0)).rejects.toThrow(
          "[UserPool] Pool exhausted: VU 3 exceeds pool size 2"
        );
      });

      it("throws when pool is empty", async () => {
        const redis = makeMockRedis();
        const pool = new UserPool(redis as never);

        redis.get.mockResolvedValue(null);

        await expect(pool.getForVU(1, 0)).rejects.toThrow(
          "[UserPool] Pool is empty"
        );
      });

      it("caches pool size after first lookup", async () => {
        const redis = makeMockRedis();
        const pool = new UserPool(redis as never);

        // Load sets poolSize directly
        await pool.load([{ username: "alice" }, { username: "bob" }]);
        redis.hgetall.mockResolvedValue({ username: "alice" });

        await pool.getForVU(1, 0);
        // Should NOT call redis.get for size since load() set it
        expect(redis.get).not.toHaveBeenCalledWith("user:_meta:size");
      });
    });

    describe("cleanup", () => {
      it("deletes all pool keys by prefix", async () => {
        const redis = makeMockRedis();
        const pool = new UserPool(redis as never);

        redis.deleteByPrefix.mockResolvedValue(5);
        const deleted = await pool.cleanup();

        expect(deleted).toBe(5);
        expect(redis.deleteByPrefix).toHaveBeenCalledWith("user:");
      });
    });
  });

  // ── DistributedRateLimiter ──────────────────────────────────────────

  describe("DistributedRateLimiter", () => {
    describe("allow", () => {
      it("allows requests under the limit", async () => {
        const redis = makeMockRedis();
        const limiter = new DistributedRateLimiter(redis as never, "payments", 100);

        redis.incr.mockResolvedValue(1);

        const allowed = await limiter.allow();
        expect(allowed).toBe(true);
      });

      it("sets expiry on first request in window", async () => {
        const redis = makeMockRedis();
        const limiter = new DistributedRateLimiter(redis as never, "payments", 100);

        redis.incr.mockResolvedValue(1); // count = 1, first in window

        await limiter.allow();
        expect(redis.expire).toHaveBeenCalledWith(expect.any(String), 60);
      });

      it("does not set expiry when count > 1", async () => {
        const redis = makeMockRedis();
        const limiter = new DistributedRateLimiter(redis as never, "payments", 100);

        redis.incr.mockResolvedValue(5); // not the first

        await limiter.allow();
        expect(redis.expire).not.toHaveBeenCalled();
      });

      it("rejects requests over the limit", async () => {
        const redis = makeMockRedis();
        const limiter = new DistributedRateLimiter(redis as never, "payments", 100);

        redis.incr.mockResolvedValue(101);

        const allowed = await limiter.allow();
        expect(allowed).toBe(false);
      });

      it("allows requests at exactly the limit", async () => {
        const redis = makeMockRedis();
        const limiter = new DistributedRateLimiter(redis as never, "payments", 100);

        redis.incr.mockResolvedValue(100);

        const allowed = await limiter.allow();
        expect(allowed).toBe(true);
      });
    });

    describe("currentCount", () => {
      it("returns current count from Redis", async () => {
        const redis = makeMockRedis();
        const limiter = new DistributedRateLimiter(redis as never, "payments", 100);

        redis.get.mockResolvedValue("42");

        const count = await limiter.currentCount();
        expect(count).toBe(42);
      });

      it("returns 0 when no window key exists", async () => {
        const redis = makeMockRedis();
        const limiter = new DistributedRateLimiter(redis as never, "payments", 100);

        redis.get.mockResolvedValue(null);

        const count = await limiter.currentCount();
        expect(count).toBe(0);
      });
    });

    describe("windowTtl", () => {
      it("returns TTL from Redis", async () => {
        const redis = makeMockRedis();
        const limiter = new DistributedRateLimiter(redis as never, "payments", 100);

        redis.ttl.mockResolvedValue(45);

        const ttl = await limiter.windowTtl();
        expect(ttl).toBe(45);
      });
    });
  });

  // ── StatsCounter ──────────────────────────────────────────────────────

  describe("StatsCounter", () => {
    describe("inc", () => {
      it("increments a counter by 1", async () => {
        const redis = makeMockRedis();
        const stats = new StatsCounter(redis as never, "checkout");

        redis.incr.mockResolvedValue(5);
        const newVal = await stats.inc("requests");

        expect(redis.incr).toHaveBeenCalledWith("stats:checkout:requests");
        expect(newVal).toBe(5);
      });
    });

    describe("incBy", () => {
      it("increments a counter by custom amount", async () => {
        const redis = makeMockRedis();
        const stats = new StatsCounter(redis as never, "checkout");

        redis.incrby.mockResolvedValue(150);
        const newVal = await stats.incBy("latency_ms", 150);

        expect(redis.incrby).toHaveBeenCalledWith("stats:checkout:latency_ms", 150);
        expect(newVal).toBe(150);
      });

      it("rounds fractional amounts", async () => {
        const redis = makeMockRedis();
        const stats = new StatsCounter(redis as never, "checkout");

        redis.incrby.mockResolvedValue(3);
        await stats.incBy("latency_ms", 2.7);

        expect(redis.incrby).toHaveBeenCalledWith("stats:checkout:latency_ms", 3);
      });
    });

    describe("get", () => {
      it("returns counter value", async () => {
        const redis = makeMockRedis();
        const stats = new StatsCounter(redis as never, "checkout");

        redis.get.mockResolvedValue("42");
        const val = await stats.get("requests");

        expect(redis.get).toHaveBeenCalledWith("stats:checkout:requests");
        expect(val).toBe(42);
      });

      it("returns 0 when counter does not exist", async () => {
        const redis = makeMockRedis();
        const stats = new StatsCounter(redis as never, "checkout");

        redis.get.mockResolvedValue(null);
        const val = await stats.get("unknown");

        expect(val).toBe(0);
      });
    });

    describe("getAll", () => {
      it("returns multiple counter values", async () => {
        const redis = makeMockRedis();
        const stats = new StatsCounter(redis as never, "checkout");

        redis.mget.mockResolvedValue(["10", "3", null]);
        const vals = await stats.getAll(["requests", "errors", "timeouts"]);

        expect(redis.mget).toHaveBeenCalledWith([
          "stats:checkout:requests",
          "stats:checkout:errors",
          "stats:checkout:timeouts",
        ]);
        expect(vals).toEqual({
          requests: 10,
          errors: 3,
          timeouts: 0,
        });
      });
    });

    describe("reset", () => {
      it("deletes the counter key", async () => {
        const redis = makeMockRedis();
        const stats = new StatsCounter(redis as never, "checkout");

        await stats.reset("requests");
        expect(redis.del).toHaveBeenCalledWith("stats:checkout:requests");
      });
    });

    describe("cleanup", () => {
      it("deletes all counters for namespace", async () => {
        const redis = makeMockRedis();
        const stats = new StatsCounter(redis as never, "checkout");

        redis.deleteByPrefix.mockResolvedValue(3);
        const deleted = await stats.cleanup();

        expect(redis.deleteByPrefix).toHaveBeenCalledWith("stats:checkout:");
        expect(deleted).toBe(3);
      });
    });
  });

  // ── parseCsvLine ──────────────────────────────────────────────────────

  describe("parseCsvLine", () => {
    it("parses simple comma-separated values", () => {
      const result = parseCsvLine("alice,bob,charlie");
      expect(result).toEqual(["alice", "bob", "charlie"]);
    });

    it("trims whitespace from values", () => {
      const result = parseCsvLine("  alice , bob , charlie  ");
      expect(result).toEqual(["alice", "bob", "charlie"]);
    });

    it("handles quoted values with commas inside", () => {
      const result = parseCsvLine('alice,"Smith, Jr.",charlie');
      expect(result).toEqual(["alice", "Smith, Jr.", "charlie"]);
    });

    it("handles empty values", () => {
      const result = parseCsvLine("alice,,charlie");
      expect(result).toEqual(["alice", "", "charlie"]);
    });

    it("handles single value", () => {
      const result = parseCsvLine("only");
      expect(result).toEqual(["only"]);
    });

    it("handles empty string", () => {
      const result = parseCsvLine("");
      expect(result).toEqual([""]);
    });
  });

  // ── parseCsv ──────────────────────────────────────────────────────────

  describe("parseCsv", () => {
    it("parses CSV with headers into array of objects", () => {
      const csv = "username,email\nalice,alice@test.com\nbob,bob@test.com";
      const result = parseCsv(csv);

      expect(result).toEqual([
        { username: "alice", email: "alice@test.com" },
        { username: "bob", email: "bob@test.com" },
      ]);
    });

    it("returns empty array for header-only CSV", () => {
      const warnFn = vi.fn();
      const result = parseCsv("username,email", warnFn);

      expect(result).toEqual([]);
      expect(warnFn).toHaveBeenCalledWith(
        expect.stringContaining("no data rows")
      );
    });

    it("returns empty array for empty CSV", () => {
      const warnFn = vi.fn();
      const result = parseCsv("", warnFn);

      expect(result).toEqual([]);
    });

    it("skips empty lines", () => {
      const csv = "name,value\n\nalice,1\n\nbob,2\n";
      const result = parseCsv(csv);

      expect(result).toEqual([
        { name: "alice", value: "1" },
        { name: "bob", value: "2" },
      ]);
    });

    it("handles missing columns with warning", () => {
      const warnFn = vi.fn();
      const csv = "name,email,role\nalice,alice@test.com";
      const result = parseCsv(csv, warnFn);

      expect(result).toEqual([
        { name: "alice", email: "alice@test.com", role: "" },
      ]);
      expect(warnFn).toHaveBeenCalledWith(
        expect.stringContaining('missing column "role"')
      );
    });

    it("warns on extra columns", () => {
      const warnFn = vi.fn();
      const csv = "name,email\nalice,alice@test.com,extra_value";
      const result = parseCsv(csv, warnFn);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("alice");
      expect(warnFn).toHaveBeenCalledWith(
        expect.stringContaining("extra columns ignored")
      );
    });

    it("handles Windows-style line endings (CRLF)", () => {
      const csv = "name,email\r\nalice,alice@test.com\r\nbob,bob@test.com\r\n";
      const result = parseCsv(csv);

      expect(result).toEqual([
        { name: "alice", email: "alice@test.com" },
        { name: "bob", email: "bob@test.com" },
      ]);
    });

    it("handles quoted values with commas", () => {
      const csv = 'name,address\nalice,"123 Main St, Apt 4"';
      const result = parseCsv(csv);

      expect(result).toEqual([
        { name: "alice", address: "123 Main St, Apt 4" },
      ]);
    });

    it("skips rows with all empty values", () => {
      const csv = "name,email\n,\nalice,alice@test.com";
      const result = parseCsv(csv);

      expect(result).toEqual([
        { name: "alice", email: "alice@test.com" },
      ]);
    });

    it("uses console.warn as default warning function", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const csv = "name\n";
      parseCsv(csv);
      // Should use console.warn since no warnFn provided
      expect(warnSpy).toHaveBeenCalled();
    });
  });
});
