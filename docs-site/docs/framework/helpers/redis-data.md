---
title: "Redis Data Support Guide"
sidebar_position: 2
---
# Redis Data Support Guide

<!-- T-103: Documentacion de Redis y datos de test -->

This guide covers using Redis for dynamic test data management in k6 load tests — user pools, distributed rate limiting, real-time statistics, and coordinating data across Virtual Users (VUs).

---

## Table of Contents

1. [Quick Reference](#1-quick-reference)
2. [Configuration & Setup](#2-configuration--setup)
3. [Reusable Patterns](#3-reusable-patterns)
4. [Recommended Workflow](#4-recommended-workflow)
5. [Data File Formats](#5-data-file-formats)
6. [Best Practices](#6-best-practices)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Quick Reference

All operations from `RedisHelper`. Import in your k6 script:

```typescript
import { RedisHelper } from '../../src/helpers/redis-helper';
const redis = new RedisHelper(); // uses REDIS_URL env var
```

### Basic Operations

| Method | Description | Example |
|--------|-------------|---------|
| `set(key, value, ttl?)` | Set a string value, optional TTL in seconds | `await redis.set('token:abc', 'value', 3600)` |
| `get(key)` | Get a string value (null if missing) | `await redis.get('token:abc')` |
| `del(...keys)` | Delete one or more keys | `await redis.del('key1', 'key2')` |
| `exists(key)` | Check if a key exists | `await redis.exists('user:1')` |
| `expire(key, ttl)` | Set TTL on existing key | `await redis.expire('session:x', 1800)` |
| `ttl(key)` | Get remaining TTL in seconds | `await redis.ttl('token:abc')` |

### Multiple Key Operations

| Method | Description | Example |
|--------|-------------|---------|
| `mset(pairs)` | Set multiple keys atomically | `await redis.mset({ 'a': '1', 'b': '2' })` |
| `mget(keys[])` | Get multiple values in one call | `await redis.mget(['key1', 'key2'])` |

### Counters (Atomic)

| Method | Description | Example |
|--------|-------------|---------|
| `incr(key)` | Increment by 1, returns new value | `await redis.incr('stats:requests')` |
| `incrby(key, n)` | Increment by n | `await redis.incrby('stats:latency', 245)` |

### Lists

| Method | Description | Example |
|--------|-------------|---------|
| `lpush(key, ...values)` | Push to LEFT of list | `await redis.lpush('queue:ids', 'id1', 'id2')` |
| `rpush(key, ...values)` | Push to RIGHT of list | `await redis.rpush('user:ids', 'u1')` |
| `lpop(key)` | Pop from LEFT | `await redis.lpop('queue:ids')` |
| `rpop(key)` | Pop from RIGHT | `await redis.rpop('queue:ids')` |
| `llen(key)` | Get list length | `await redis.llen('user:ids')` |
| `lrange(key, start, stop)` | Get range (0,-1 = all) | `await redis.lrange('user:ids', 0, -1)` |

### Hashes

| Method | Description | Example |
|--------|-------------|---------|
| `hset(key, field, value)` | Set one field | `await redis.hset('user:1', 'email', 'a@b.com')` |
| `hmset(key, fields)` | Set multiple fields | `await redis.hmset('user:1', { email: 'a@b.com', name: 'Ana' })` |
| `hget(key, field)` | Get one field | `await redis.hget('user:1', 'email')` |
| `hgetall(key)` | Get all fields as object | `await redis.hgetall('user:1')` |
| `hdel(key, ...fields)` | Delete fields | `await redis.hdel('user:1', 'temp_field')` |

### Connection

| Method | Description |
|--------|-------------|
| `disconnect()` | Gracefully close connection — always call in `teardown()` |

---

## 2. Configuration & Setup

### 2.1 Local (without Docker)

```bash
# Start Redis locally
brew install redis && brew services start redis
# or
docker run -d -p 6379:6379 redis:7-alpine

# Set connection URL
export REDIS_URL=redis://localhost:6379

# Run your test
k6 run --env REDIS_URL=redis://localhost:6379 my-test.ts
```

### 2.2 Docker Compose (with Redis profile)

```bash
# Start the full stack with Redis
docker compose --profile redis up -d

# REDIS_URL is automatically injected as redis://redis:6379
docker compose --profile redis --profile run up k6
```

The Redis port (6379) is NOT exposed to the host — only accessible inside the `k6-net` Docker network.

### 2.3 With Authentication

```bash
# .env file (never commit credentials)
REDIS_PASSWORD=mysecretpassword

# The REDIS_URL is auto-built as: redis://:mysecretpassword@redis:6379
# Or set explicitly:
export REDIS_URL=redis://:mysecretpassword@localhost:6379
```

```typescript
// In your k6 script — credentials are automatically masked in logs
const redis = new RedisHelper();
// Logs: [RedisHelper] Connected to redis://***:***@localhost:6379
```

### 2.4 Explicit URL in Constructor

```typescript
// Override REDIS_URL for a specific script
const redis = new RedisHelper({ url: 'redis://:password@my-redis-host:6379' });
```

---

## 3. Reusable Patterns

### Pattern 1: User Pool

Assign unique test data to each VU without collisions.

```
┌─────────────────────────────────────────────┐
│              Redis                          │
│  user:0  →  { email: "a@b.com", ... }       │
│  user:1  →  { email: "c@d.com", ... }       │
│  user:2  →  { email: "e@f.com", ... }       │
│  user:_meta:size  →  "3"                    │
└─────────────────────────────────────────────┘
         ↑                    ↑
      VU 1 → user:0       VU 2 → user:1
      (index = VU-1 % poolSize)
```

```typescript
import { UserPool } from '../../src/patterns/redis-patterns';

// setup(): load 500 users
export function setup() {
  const redis = new RedisHelper();
  const pool = new UserPool(redis, { prefix: 'user:', policy: 'recycle' });
  await pool.load(usersArray);          // stores user:0 ... user:499
  redis.disconnect();
}

// default(): each VU gets its own user (no collisions)
export default function() {
  const redis = new RedisHelper();
  const pool = new UserPool(redis, { prefix: 'user:' });
  const user = await pool.getForVU(__VU, __ITER);
  // VU 1 → user:0, VU 2 → user:1, VU 501 → user:0 (recycles)
  redis.disconnect();
}

// teardown(): clean up
export function teardown() {
  const redis = new RedisHelper();
  const pool = new UserPool(redis, { prefix: 'user:' });
  await pool.cleanup();   // deletes all user:* keys
  redis.disconnect();
}
```

**When VUs > pool size:** VUs wrap around and reuse data (policy: `'recycle'`). Document this in your test report. Use policy `'error'` to fail instead.

### Pattern 2: Distributed Rate Limiter

Coordinate request rate across ALL VUs using atomic counters.

```
┌─────────────────────────────────────────────┐
│              Redis                          │
│  rate:payment:20260218_0200  →  "47"        │
│  (expires in 13 seconds)                    │
└─────────────────────────────────────────────┘
         ↑
   All VUs increment this counter atomically.
   If count > maxPerMinute → request is skipped.
```

```typescript
import { DistributedRateLimiter } from '../../src/patterns/redis-patterns';

export default function() {
  const redis = new RedisHelper();
  const limiter = new DistributedRateLimiter(redis, 'payment-api', 100); // 100 req/min max

  if (!(await limiter.allow())) {
    console.log('Rate limit reached — skipping iteration');
    redis.disconnect();
    return;
  }

  // ... make request
  redis.disconnect();
}
```

**Precision:** ±2% at high concurrency (atomic `INCR` guarantees no lost counts).

### Pattern 3: Real-time Stats Counters

Atomic counters for live metrics during test execution, queryable while the test runs.

```
┌─────────────────────────────────────────────┐
│              Redis                          │
│  stats:checkout:requests  →  "1247"         │
│  stats:checkout:errors    →  "3"            │
│  stats:checkout:latency_ms →  "312750"      │
└─────────────────────────────────────────────┘
```

```typescript
import { StatsCounter } from '../../src/patterns/redis-patterns';

export default function() {
  const redis = new RedisHelper();
  const stats = new StatsCounter(redis, 'checkout');

  await stats.inc('requests');

  const res = http.get('https://api.example.com/checkout');
  if (res.status !== 200) await stats.inc('errors');
  await stats.incBy('latency_ms', res.timings.duration);

  redis.disconnect();
}

// Query live stats from outside the test:
// redis-cli get stats:checkout:requests
// → "1247"
```

---

## 4. Recommended Workflow

```
Step 1: Prepare data files
  users.csv, products.json

Step 2: Load into Redis (before test)
  node bin/load-redis-data.js --users=./data/users.csv --products=./data/products.json --clear

Step 3: Run k6 test
  k6 run --env REDIS_URL=redis://localhost:6379 my-test.ts

Step 4: (Optional) Query live stats during test
  redis-cli get stats:my-test:requests

Step 5: Clean up after test
  node bin/clean-redis-data.js --all
  # or automatically via teardown() in the k6 script
```

### Pre-load Script

```bash
# Load all data and clear old keys
node bin/load-redis-data.js \
  --users=clients/my-service/data/users.csv \
  --products=clients/my-service/data/products.json \
  --clear \
  --redis=redis://localhost:6379

# Output:
#   ✓ Users: 1000 records found
#   ✓ Products: 250 records found
#   ✓ Cleared 1250 keys with prefix "user:"
#   ✓ Loaded 1000 user records
#   ✓ Loaded 250 product records
#   Total loaded: 1250 keys
```

### Clean-up Script

```bash
# Delete specific prefix
node bin/clean-redis-data.js --pattern="user:*" --yes

# Delete all framework-managed keys
node bin/clean-redis-data.js --all --yes

# Dry-run (show what would be deleted)
node bin/clean-redis-data.js --all --dry-run
```

---

## 5. Data File Formats

### 5.1 CSV (for users, sessions)

```csv
id,email,password,role
1,alice@example.com,pass123,admin
2,bob@example.com,pass456,user
3,carol@example.com,pass789,user
```

- First row = column headers (field names in Redis hash)
- Empty rows are skipped with a warning
- Missing columns use empty string (not a crash)
- Special characters inside quoted fields are handled: `"name with, comma"`

**Parsing in k6 (SharedArray):**
```typescript
import { SharedArray } from 'k6/data';
import { parseCsv } from '../../src/patterns/redis-patterns';

const users = new SharedArray('users', function() {
  return parseCsv(open('./data/users.csv'));
});
// → [{ id: '1', email: 'alice@example.com', password: 'pass123', role: 'admin' }, ...]
```

### 5.2 JSON (for products, configs)

```json
[
  { "id": "p1", "name": "Widget A", "price": "9.99", "category": "tools" },
  { "id": "p2", "name": "Widget B", "price": "19.99", "category": "tools" }
]
```

- Must be a JSON **array** (not an object)
- All values are stored as strings in Redis (numbers are converted automatically)
- Nested objects are not supported — flatten before loading

**Parsing in k6 (SharedArray):**
```typescript
const products = new SharedArray('products', function() {
  return JSON.parse(open('./data/products.json'));
});
```

---

## 6. Best Practices

### ✅ DO

```typescript
// Use TTL for sensitive data (CHK-SEC-105)
await redis.set('token:user123', authToken, 3600); // expires in 1 hour

// Use namespaced keys to avoid collisions (CHK-API-346)
await redis.set('user:1:profile', value);     // user namespace
await redis.incr('stats:checkout:requests');  // stats namespace

// Use INCR for counters (atomic — no race conditions)
await redis.incr('stats:errors');

// Always disconnect in teardown (prevents connection leaks)
export function teardown() {
  redis.disconnect();
}

// Use SharedArray for large datasets (parsed once, shared across VUs)
const users = new SharedArray('users', () => parseCsv(open('./users.csv')));
```

### ❌ DON'T

```typescript
// Don't use GET+SET for counters (race condition under concurrent VUs)
const count = await redis.get('counter');
await redis.set('counter', String(Number(count) + 1)); // ❌ race condition

// Don't store values > 1MB (degrades Redis performance)
await redis.set('huge:blob', JSON.stringify(massiveObject)); // ❌

// Don't perform Redis operations in the VU loop without disconnecting
export default function() {
  const redis = new RedisHelper(); // connects on every iteration — expensive!
  // ...
  // missing redis.disconnect() ❌
}

// Better: connect once in setup, use VU-local connection pattern
// Don't use synchronous patterns in k6 default function
// All redis operations must be awaited
```

### Key Naming Conventions

| Prefix | Purpose | Example |
|--------|---------|---------|
| `user:` | User pool hashes | `user:42` |
| `product:` | Product hashes | `product:p1` |
| `token:` | Auth tokens (auto-TTL 1h) | `token:session-abc` |
| `rate:` | Rate limiter counters | `rate:payment:20260218_0200` |
| `stats:` | Test statistics counters | `stats:checkout:requests` |
| `config:` | Runtime config values | `config:feature_flags` |

### Size Limits

| Scenario | Recommendation |
|----------|---------------|
| String values | < 512KB per value |
| Hash fields | < 100 fields per hash for performance |
| Lists | Use `lrange(0, 99)` for pagination with large lists |
| Max value size | 1MB warning, >10MB not recommended |

---

## 7. Troubleshooting

### Error: "xk6-redis binary required"

```
[RedisHelper] Failed to connect to redis://localhost:6379.
Ensure you are using a k6 binary compiled with xk6-redis.
```

**Fix:** Build the custom binary:
```bash
./bin/build-binary.sh
# Then run with:
./dist/binaries/my-client/k6-my-client run my-test.ts
```

### Error: "Cannot connect to Redis"

```
Error: connect ECONNREFUSED 127.0.0.1:6379
```

**Fix options:**
```bash
# Option 1: Start Redis locally
brew services start redis       # macOS
sudo systemctl start redis      # Linux

# Option 2: Start Redis via Docker
docker run -d -p 6379:6379 redis:7-alpine

# Option 3: Use Docker Compose profile
docker compose --profile redis up -d
```

### Error: "hgetall: WRONGTYPE Operation against wrong key type"

```
[RedisHelper] hgetall("user:1"): key is not a hash type. Use get() for string keys.
```

**Fix:** The key exists but was stored as a string, not a hash. Check your `load-redis-data.js` call. Use `redis.get(key)` for string keys.

### Error: "Pool is empty. Call load() in setup() first."

The user pool was not loaded before `default()` ran.

**Fix:** Ensure `setup()` calls `pool.load(users)` before the test starts:
```typescript
export function setup() {
  const redis = new RedisHelper();
  const pool = new UserPool(redis, { prefix: 'user:' });
  await pool.load(allUsers); // ← this must complete before default() runs
  redis.disconnect();
}
```

### Error: "File not found: ./data/users.csv" (in load-redis-data.js)

```
Error: File not found: ./data/users.csv
```

**Fix:** Run `load-redis-data.js` from the `k6-framework/` directory, or use absolute paths:
```bash
cd k6-framework
node bin/load-redis-data.js --users=clients/my-service/data/users.csv
```

### Error: "ioredis is not installed"

```
Error: ioredis is not installed. Install it with: npm install ioredis
```

**Fix:**
```bash
cd k6-framework && npm install
# ioredis is listed in package.json dependencies
```

### Timeout during test (Redis operations slow)

- Check Redis memory: `redis-cli info memory`
- Check connection count: `redis-cli info clients`
- Use `redis.mget([keys])` instead of multiple individual `get()` calls
- Avoid `lrange(key, 0, -1)` on very large lists — use pagination
- Ensure you're using `SharedArray` for data parsed in init context (not in VU loop)
