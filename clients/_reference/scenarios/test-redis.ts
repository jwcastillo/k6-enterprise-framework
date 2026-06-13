// T-104: Suite de verificacion Redis (test-redis.ts)
//
// Validates all RedisHelper operations and coordination patterns.
// Requires Redis to be running (Docker or local).
//
// Run:
//   k6 run --env REDIS_URL=redis://localhost:6379 clients/_reference/scenarios/test-redis.ts
//
// Skip gracefully if Redis unavailable:
//   If REDIS_URL is not set or Redis is unreachable, all checks are skipped
//   with a clear message — test exits 0 (not a test failure).
//
// CI/CD:
//   Run only when Redis is available. The script detects availability.

import { check, group, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";
import { SharedArray } from "k6/data";
import { RedisHelper } from "../../../src/helpers/redis-helper";
import {
  UserPool,
  DistributedRateLimiter,
  StatsCounter,
  parseCsv,
} from "../../../src/patterns/redis-patterns";

// ── Options ───────────────────────────────────────────────────────────────────
export const options = {
  vus: 10,
  duration: "30s",
  thresholds: {
    // All Redis operation checks must pass
    checks: ["rate>=1.0"],
    // Redis ops must be fast (< 5ms per operation, SC-091)
    redis_op_duration: ["p(95)<5", "p(99)<10"],
  },
};

// ── Custom metrics ─────────────────────────────────────────────────────────────
const redisOpDuration = new Trend("redis_op_duration", true); // milliseconds
const redisErrors = new Counter("redis_errors");

// ── SharedArray — parsed once in init context ─────────────────────────────────
const testUsers = new SharedArray("test_users", function () {
  // Inline CSV for self-contained test (no external file dependency)
  const csv = `id,email,password,role
1,alice@redis-test.com,pass1,admin
2,bob@redis-test.com,pass2,user
3,carol@redis-test.com,pass3,user
4,dave@redis-test.com,pass4,user
5,eve@redis-test.com,pass5,user`;
  return parseCsv(csv);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const t0 = Date.now();
  const result = await fn();
  return { result, ms: Date.now() - t0 };
}

function checkOp(name: string, condition: boolean): boolean {
  const passed = check({}, { [name]: () => condition });
  if (!passed) redisErrors.add(1);
  return passed;
}

// ── Setup — load test data into Redis ────────────────────────────────────────
export interface SetupData {
  redisAvailable: boolean;
  poolSize: number;
}

export async function setup(): Promise<SetupData> {
  let redis: RedisHelper;
  try {
    redis = new RedisHelper();
  } catch {
    console.warn("[test-redis] Redis not available — all checks will be skipped.");
    return { redisAvailable: false, poolSize: 0 };
  }

  // Clean up any leftover test keys from previous runs
  await redis.deleteByPrefix("test:");
  await redis.deleteByPrefix("user:");
  await redis.deleteByPrefix("rate:");
  await redis.deleteByPrefix("stats:");

  // Load user pool (CHK-API-337, CHK-API-338)
  const pool = new UserPool(redis, { prefix: "user:" });
  const loadedCount = await pool.load(testUsers as Array<Record<string, string>>);
  console.log(`[setup] Loaded ${loadedCount} users into Redis pool`);

  await redis.disconnect();
  return { redisAvailable: true, poolSize: testUsers.length };
}

// ── Default — verification scenarios ─────────────────────────────────────────
export default async function main(data: SetupData): Promise<void> {
  if (!data.redisAvailable) {
    console.warn("[test-redis] Skipping — Redis not available");
    return;
  }

  const redis = new RedisHelper();

  // ── Group 1: Basic string operations ───────────────────────────────────────
  await group("Basic operations: set/get/del/exists", async () => {
    // set + get
    const setOp = await timed(() => redis.set("test:basic:key", "hello-redis"));
    redisOpDuration.add(setOp.ms, { op: "set" });
    checkOp("set: no error", true); // if it throws, test fails above

    const getOp = await timed(() => redis.get("test:basic:key"));
    redisOpDuration.add(getOp.ms, { op: "get" });
    checkOp("get: correct value", getOp.result === "hello-redis");

    // exists
    const existsOp = await timed(() => redis.exists("test:basic:key"));
    redisOpDuration.add(existsOp.ms, { op: "exists" });
    checkOp("exists: true for existing key", existsOp.result === true);

    const existsMissOp = await timed(() => redis.exists("test:basic:nonexistent"));
    checkOp("exists: false for missing key", existsMissOp.result === false);

    // del
    const delOp = await timed(() => redis.del("test:basic:key"));
    redisOpDuration.add(delOp.ms, { op: "del" });
    checkOp("del: returns 1 for existing key", delOp.result === 1);

    const getAfterDel = await redis.get("test:basic:key");
    checkOp("get: null after del", getAfterDel === null);
  });

  // ── Group 2: TTL operations ─────────────────────────────────────────────────
  await group("TTL operations: set with expiry", async () => {
    // set with TTL
    await redis.set("test:ttl:key", "expires-soon", 60);
    const ttlVal = await timed(() => redis.ttl("test:ttl:key"));
    redisOpDuration.add(ttlVal.ms, { op: "ttl" });
    checkOp("ttl: positive for key with expiry", ttlVal.result > 0 && ttlVal.result <= 60);

    // key without TTL
    await redis.set("test:ttl:noexpiry", "no-expire");
    const ttlNoExp = await redis.ttl("test:ttl:noexpiry");
    checkOp("ttl: -1 for key without expiry", ttlNoExp === -1);

    // missing key
    const ttlMissing = await redis.ttl("test:ttl:nonexistent");
    checkOp("ttl: -2 for missing key", ttlMissing === -2);

    // expire on existing key
    const expireRes = await timed(() => redis.expire("test:ttl:noexpiry", 120));
    redisOpDuration.add(expireRes.ms, { op: "expire" });
    checkOp("expire: returns true for existing key", expireRes.result === true);

    // set with TTL=0 (no expiry, warns)
    await redis.set("test:ttl:zero", "zero-ttl", 0);
    const ttlZero = await redis.ttl("test:ttl:zero");
    checkOp("set ttl=0: key persists (no expiry)", ttlZero === -1);

    // cleanup
    await redis.del("test:ttl:key", "test:ttl:noexpiry", "test:ttl:zero");
  });

  // ── Group 3: Multiple key operations ───────────────────────────────────────
  await group("Multiple key operations: mset/mget", async () => {
    const msetOp = await timed(() =>
      redis.mset({
        "test:multi:a": "value-a",
        "test:multi:b": "value-b",
        "test:multi:c": "value-c",
      })
    );
    redisOpDuration.add(msetOp.ms, { op: "mset" });
    checkOp("mset: completes without error", true);

    const mgetOp = await timed(() =>
      redis.mget(["test:multi:a", "test:multi:b", "test:multi:c", "test:multi:missing"])
    );
    redisOpDuration.add(mgetOp.ms, { op: "mget" });
    checkOp(
      "mget: returns correct values",
      mgetOp.result[0] === "value-a" && mgetOp.result[1] === "value-b"
    );
    checkOp("mget: null for missing key", mgetOp.result[3] === null);

    await redis.del("test:multi:a", "test:multi:b", "test:multi:c");
  });

  // ── Group 4: Counters (atomic) ──────────────────────────────────────────────
  await group("Atomic counters: incr/incrby", async () => {
    await redis.del("test:counter:hits");

    const incr1 = await timed(() => redis.incr("test:counter:hits"));
    redisOpDuration.add(incr1.ms, { op: "incr" });
    checkOp("incr: first call returns 1", incr1.result === 1);

    const incr2 = await redis.incr("test:counter:hits");
    checkOp("incr: second call returns 2", incr2 === 2);

    const incrBy = await timed(() => redis.incrby("test:counter:hits", 10));
    redisOpDuration.add(incrBy.ms, { op: "incrby" });
    checkOp("incrby: adds 10, returns 12", incrBy.result === 12);

    await redis.del("test:counter:hits");
  });

  // ── Group 5: List operations ────────────────────────────────────────────────
  await group("List operations: lpush/llen/lrange/lpop", async () => {
    await redis.del("test:list:queue");

    const lpushOp = await timed(() => redis.lpush("test:list:queue", "item-3", "item-2", "item-1"));
    redisOpDuration.add(lpushOp.ms, { op: "lpush" });
    checkOp("lpush: returns 3 for 3 items", lpushOp.result === 3);

    const llenOp = await timed(() => redis.llen("test:list:queue"));
    redisOpDuration.add(llenOp.ms, { op: "llen" });
    checkOp("llen: returns 3", llenOp.result === 3);

    const lrangeOp = await timed(() => redis.lrange("test:list:queue", 0, -1));
    redisOpDuration.add(lrangeOp.ms, { op: "lrange" });
    checkOp("lrange: returns all 3 items", lrangeOp.result.length === 3);
    checkOp("lrange: first item is item-1 (lpush reverses order)", lrangeOp.result[0] === "item-1");

    const lpopOp = await timed(() => redis.lpop("test:list:queue"));
    redisOpDuration.add(lpopOp.ms, { op: "lpop" });
    checkOp("lpop: returns item-1", lpopOp.result === "item-1");
    checkOp("llen after pop: 2", (await redis.llen("test:list:queue")) === 2);

    // rpush
    await redis.rpush("test:list:queue", "item-4");
    checkOp("rpush: appends to end", (await redis.llen("test:list:queue")) === 3);

    await redis.del("test:list:queue");
  });

  // ── Group 6: Hash operations ────────────────────────────────────────────────
  await group("Hash operations: hset/hget/hgetall/hdel", async () => {
    await redis.del("test:hash:user");

    const hsetOp = await timed(() => redis.hset("test:hash:user", "email", "test@example.com"));
    redisOpDuration.add(hsetOp.ms, { op: "hset" });
    checkOp("hset: returns 1 for new field", hsetOp.result === 1);

    const hmsetOp = await timed(() =>
      redis.hmset("test:hash:user", { name: "Test User", role: "admin" })
    );
    redisOpDuration.add(hmsetOp.ms, { op: "hmset" });
    checkOp("hmset: completes without error", true);

    const hgetOp = await timed(() => redis.hget("test:hash:user", "email"));
    redisOpDuration.add(hgetOp.ms, { op: "hget" });
    checkOp("hget: returns correct value", hgetOp.result === "test@example.com");

    const hgetMissing = await redis.hget("test:hash:user", "nonexistent_field");
    checkOp("hget: null for missing field", hgetMissing === null);

    const hgetallOp = await timed(() => redis.hgetall("test:hash:user"));
    redisOpDuration.add(hgetallOp.ms, { op: "hgetall" });
    checkOp("hgetall: returns object with 3 fields", Object.keys(hgetallOp.result).length === 3);
    checkOp("hgetall: email field correct", hgetallOp.result["email"] === "test@example.com");
    checkOp("hgetall: role field correct", hgetallOp.result["role"] === "admin");

    // hgetall on missing key
    const hgetallMissing = await redis.hgetall("test:hash:nonexistent");
    checkOp("hgetall: empty object for missing key", Object.keys(hgetallMissing).length === 0);

    // hdel
    const hdelOp = await timed(() => redis.hdel("test:hash:user", "role"));
    redisOpDuration.add(hdelOp.ms, { op: "hdel" });
    checkOp("hdel: returns 1 for deleted field", hdelOp.result === 1);
    checkOp("hget after hdel: null", (await redis.hget("test:hash:user", "role")) === null);

    await redis.del("test:hash:user");
  });

  // ── Group 7: User pool pattern (CHK-API-343) ────────────────────────────────
  await group("Pattern: User pool (VU assignment)", async () => {
    const pool = new UserPool(redis, { prefix: "user:" });

    // Each VU gets a unique user by index
    const user = await pool.getForVU(__VU, __ITER);
    checkOp("pool: returns non-null user", user !== null && user !== undefined);
    checkOp("pool: user has email field", typeof user?.["email"] === "string");
    checkOp("pool: user email not empty", (user?.["email"] ?? "").length > 0);

    // VU index assignment is deterministic
    const userAgain = await pool.getForVU(__VU, __ITER + 1);
    checkOp(
      "pool: same VU always gets same user (deterministic)",
      user?.["email"] === userAgain?.["email"]
    );
  });

  // ── Group 8: Rate limiting pattern (CHK-API-344) ───────────────────────────
  await group("Pattern: Distributed rate limiter", async () => {
    const limiter = new DistributedRateLimiter(redis, "test-endpoint", 1000); // high limit for test

    const allowed1 = await timed(() => limiter.allow());
    redisOpDuration.add(allowed1.ms, { op: "rate_limit_check" });
    checkOp("rate limiter: first request allowed", allowed1.result === true);

    const count = await limiter.currentCount();
    checkOp("rate limiter: count increments", count >= 1);

    const ttl = await limiter.windowTtl();
    checkOp("rate limiter: window TTL <= 60s", ttl >= 0 && ttl <= 60);
  });

  // ── Group 9: Stats counters pattern (CHK-API-345) ──────────────────────────
  await group("Pattern: Real-time stats counters", async () => {
    const stats = new StatsCounter(redis, `test-${__VU}`);

    // Increment and verify
    const v1 = await timed(() => stats.inc("requests"));
    redisOpDuration.add(v1.ms, { op: "stats_inc" });
    checkOp("stats: incr returns >= 1", v1.result >= 1);

    await stats.incBy("latency_ms", 150);
    const latency = await stats.get("latency_ms");
    checkOp("stats: incBy accumulates value", latency >= 150);

    // getAll
    const all = await stats.getAll(["requests", "latency_ms", "errors"]);
    checkOp("stats: getAll returns all requested counters", Object.keys(all).length === 3);
    checkOp("stats: getAll errors defaults to 0", all["errors"] === 0);

    // Cleanup
    await stats.cleanup();
    const afterCleanup = await stats.get("requests");
    checkOp("stats: cleanup removes counter", afterCleanup === 0);
  });

  await redis.disconnect();
  sleep(0.1);
}

// ── Teardown — clean up all test data ─────────────────────────────────────────
export async function teardown(data: SetupData): Promise<void> {
  if (!data.redisAvailable) return;

  try {
    const redis = new RedisHelper();
    const pool = new UserPool(redis, { prefix: "user:" });
    await pool.cleanup();
    await redis.deleteByPrefix("test:");
    await redis.deleteByPrefix("rate:test-endpoint:");
    await redis.deleteByPrefix("stats:test-");
    console.log("[teardown] Redis test cleanup complete — no residual data left");
    await redis.disconnect();
  } catch (err) {
    // EC-RED-009: teardown failure is a warning, not a test failure
    console.warn(`[teardown] Cleanup warning: ${(err as Error).message}`);
  }
}
