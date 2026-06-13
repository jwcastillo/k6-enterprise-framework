// T-097: Patron completo de datos via Redis con SharedArray
//
// Demonstrates the full setup → load → consume → teardown lifecycle:
//   1. setup()   — parse CSV/JSON with SharedArray, load into Redis
//   2. default() — consume unique user data per VU from Redis pool
//   3. teardown() — cleanup Redis keys + disconnect
//
// Run with:
//   k6 run --vus=10 --duration=30s clients/_reference/scenarios/api/16-redis-data-pool.ts
//
// Environment:
//   REDIS_URL=redis://localhost:6379   (default)
//   BASE_URL=http://localhost:3000     (default)
//
// Requires k6 binary compiled with xk6-redis.
// Build:  ./bin/build-binary.sh

import { SharedArray } from "k6/data";
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";

import { RedisHelper } from "../../../../src/helpers/redis-helper";
import { UserPool, StatsCounter, parseCsv } from "../../../../src/patterns/redis-patterns";
import { buildOptions } from "../../../../src/core/config-loader";

// ── Options ───────────────────────────────────────────────────────────────────
export const options = buildOptions({
  http_req_duration: ["p(95)<500", "p(99)<1000"],
  http_req_failed: ["rate<0.01"],
});

// ── Custom metrics ────────────────────────────────────────────────────────────
const redisLatency = new Trend("redis_operation_latency", true);
const poolHits = new Counter("redis_pool_hits");
const poolMisses = new Counter("redis_pool_misses");

// ── SharedArray — parsed once in init context, shared across all VUs ──────────
//
// SharedArray prevents each VU from loading the full dataset into memory.
// The parse function runs ONCE in the init context (not per-VU).
// (CHK-API-337)

const rawUsers = new SharedArray("users", function () {
  // open() reads the file in k6 init context
  const csvContent = open("../../../data/users.csv");
  return parseCsv(csvContent);
});

const rawProducts = new SharedArray("products", function () {
  const jsonContent = open("../../../data/products.json");
  return JSON.parse(jsonContent) as Array<Record<string, string>>;
});

// ── Setup — load data into Redis ──────────────────────────────────────────────

export interface SetupData {
  userPoolSize: number;
  productPoolSize: number;
}

export async function setup(): Promise<SetupData> {
  const redis = new RedisHelper(); // uses REDIS_URL env var

  // Load users as Redis hashes: user:0, user:1, user:2, ... (CHK-API-338)
  console.log(`[setup] Loading ${rawUsers.length} users into Redis...`);
  const userResult = await redis.bulkLoadHashes("user:", rawUsers as Array<Record<string, string>>);
  console.log(`[setup] Users loaded: ${userResult.loaded} (skipped: ${userResult.skipped})`);

  // Load product IDs as a Redis list for round-robin access: product:ids (CHK-API-338)
  const productIds = (rawProducts as Array<Record<string, string>>).map(
    (p, i) => p.id ?? String(i)
  );
  console.log(`[setup] Loading ${productIds.length} product IDs into Redis list...`);
  await redis.bulkLoadList("product:ids", productIds);

  // Also store each product as hash: product:0, product:1, ...
  await redis.bulkLoadHashes("product:", rawProducts as Array<Record<string, string>>);
  console.log(`[setup] Products loaded: ${rawProducts.length}`);

  await redis.disconnect();

  return {
    userPoolSize: rawUsers.length,
    productPoolSize: rawProducts.length,
  };
}

// ── Default — test function using Redis data per VU ───────────────────────────

export default async function main(data: SetupData): Promise<void> {
  const redis = new RedisHelper();
  const userPool = new UserPool(redis, { prefix: "user:" });
  const stats = new StatsCounter(redis, "reference-api");

  const baseUrl = __ENV["BASE_URL"] ?? "http://localhost:3000";

  // Get unique user data for this VU (no collisions for VUs <= pool size)
  const t0 = Date.now();
  const user = await userPool.getForVU(__VU, __ITER);
  redisLatency.add(Date.now() - t0);

  if (!user || Object.keys(user).length === 0) {
    poolMisses.add(1);
    console.warn(`[VU ${__VU}] No user data found in pool — check setup()`);
    return;
  }
  poolHits.add(1);

  // Use email/password from Redis hash for auth
  const email = user.email ?? `user${__VU}@example.com`;
  const password = user.password ?? "test-password";

  // Increment request counter (CHK-API-345)
  await stats.inc("requests");

  // Authenticate
  const loginRes = http.post(`${baseUrl}/api/auth/login`, JSON.stringify({ email, password }), {
    headers: { "Content-Type": "application/json" },
    tags: { name: "login" },
  });

  const loginOk = check(loginRes, {
    "login status 200": (r) => r.status === 200,
    "login returns token": (r) => {
      try {
        return !!(JSON.parse(r.body as string) as { token?: string }).token;
      } catch {
        return false;
      }
    },
  });

  if (!loginOk) {
    await stats.inc("errors");
    await redis.disconnect();
    return;
  }

  const token = (JSON.parse(loginRes.body as string) as { token: string }).token;

  // Browse a product (using rotating product index from Redis)
  const productIndex = (__VU + __ITER) % data.productPoolSize;
  const productRes = http.get(`${baseUrl}/api/products/${productIndex}`, {
    headers: { Authorization: `Bearer ${token}` },
    tags: { name: "get-product" },
  });

  check(productRes, {
    "product status 200": (r) => r.status === 200,
  });

  await stats.inc("requests");
  if (productRes.status !== 200) await stats.inc("errors");

  await redis.disconnect();
  sleep(1);
}

// ── Teardown — clean up Redis keys and disconnect ─────────────────────────────
//
// (CHK-API-339): teardown cleans all framework-managed keys.
// Failure in teardown generates warning but does not fail the test (EC-RED-009).

export async function teardown(_data: SetupData): Promise<void> {
  try {
    const redis = new RedisHelper();
    const userPool = new UserPool(redis, { prefix: "user:" });
    const stats = new StatsCounter(redis, "reference-api");

    // Print final stats before cleanup
    const finalStats = await stats.getAll(["requests", "errors"]);
    console.log(
      `[teardown] Final stats — requests: ${finalStats.requests}, errors: ${finalStats.errors}`
    );

    // Clean up all data
    await userPool.cleanup();
    await redis.del("product:ids");
    await redis.deleteByPrefix("product:");
    await stats.cleanup();

    console.log("[teardown] Redis cleanup complete");
    await redis.disconnect();
  } catch (err) {
    // EC-RED-009: teardown failure is a warning, not a test failure
    console.warn(`[teardown] Cleanup warning: ${(err as Error).message}`);
  }
}
