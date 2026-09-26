# Database performance optimization

When the bottleneck is the database. Covers query analysis, indexing, connection pools, caching, partitioning, and replica strategy.

> Sources synthesized: khanntm database-performance-optimization, rcampos09 bottleneck patterns DB section.

This complements `bottleneck-patterns.md` Pattern 3 with concrete techniques.

---

## First: confirm it's actually the database

Before optimizing the DB, prove it's the bottleneck:

- App p95 spikes correlate with DB metrics (slow queries, lock waits, connection pool waits)
- DB CPU or I/O is high while app CPU is low
- Trace shows time spent inside DB span
- Connection pool `waiting` count > 0 sustained

If app CPU is high and DB is idle, it's not a DB problem.

---

## Query analysis — where 80% of DB perf wins live

### Find the slowest queries

**PostgreSQL:**
```sql
-- Top 10 by total time (requires pg_stat_statements)
SELECT query,
       calls,
       total_exec_time,
       mean_exec_time,
       max_exec_time,
       rows
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;
```

**MySQL:**
```sql
-- Slow query log must be enabled
-- Then analyze with mysqldumpslow or pt-query-digest
SELECT digest_text,
       count_star,
       sum_timer_wait/1e9 AS total_ms,
       avg_timer_wait/1e6 AS avg_ms
FROM performance_schema.events_statements_summary_by_digest
ORDER BY total_timer_wait DESC
LIMIT 10;
```

**MongoDB:**
```javascript
// Profiler at level 1 (slow only) or 2 (all)
db.setProfilingLevel(1, { slowms: 100 });
db.system.profile.find().sort({ ts: -1 }).limit(10);
```

### Read the execution plan

The plan tells you what the DB is actually doing:

**PostgreSQL:**
```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT * FROM orders WHERE customer_id = 42 AND status = 'pending';
```

Watch for:
- **Seq Scan** on a large table → missing index
- **Hash Join** with large hash → may need index for nested loop
- **Sort** with disk usage → `work_mem` too small
- **Filter** with high `Rows Removed` → index doesn't include enough columns
- Estimated vs actual rows wildly off → stale stats (`ANALYZE`)

**MySQL:**
```sql
EXPLAIN ANALYZE SELECT ...;
```

Watch for `type: ALL` (full scan), `Extra: Using filesort`, `rows` columns being huge.

---

## Indexing — the cheapest perf win

### Rules of thumb

1. **Index columns in WHERE, JOIN, ORDER BY**, in roughly that order.
2. **Multi-column index order matters**: equality columns first, then range, then sort.
   ```sql
   -- Good for: WHERE customer_id = ? AND status = ? ORDER BY created_at
   CREATE INDEX idx_orders ON orders (customer_id, status, created_at);
   ```
3. **Covering indexes** include all columns the query needs — DB never reads the table.
   ```sql
   CREATE INDEX idx_orders_covering ON orders (customer_id, status) INCLUDE (total, created_at);
   ```
4. **Partial indexes** for queries that always filter on a value.
   ```sql
   CREATE INDEX idx_pending_orders ON orders (created_at) WHERE status = 'pending';
   ```
5. **Don't over-index** — every index is paid on every INSERT/UPDATE/DELETE. Drop unused ones, but never primary-key or unique indexes (they enforce integrity even with zero scans), and check replicas before trusting a zero scan count.

### Find unused indexes

**PostgreSQL:**
```sql
SELECT schemaname, relname, indexrelname, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY pg_relation_size(indexrelid) DESC;
```

If `idx_scan = 0` after running for weeks, drop it.

### Find missing indexes (seq scans on large tables)

**PostgreSQL:**
```sql
SELECT relname, seq_scan, seq_tup_read, idx_scan, n_live_tup
FROM pg_stat_user_tables
WHERE seq_scan > 0
ORDER BY seq_tup_read DESC
LIMIT 20;
```

High `seq_tup_read` on a large table = candidate for indexing.

---

## N+1 queries — silent killer

**Symptom:** request count to DB grows linearly with rows returned by parent query.

**Detection:**
- Log query count per HTTP request (middleware/decorator).
- Trace span count for DB calls per request.
- Look for repeating identical-shaped queries with different parameters.

**Fix patterns:**

ORM eager-loading:
```python
# SQLAlchemy
session.query(Order).options(joinedload(Order.items)).all()

# Django
Order.objects.prefetch_related('items').all()
```

Batched fetcher (DataLoader pattern):
```javascript
const loader = new DataLoader(async ids => {
  const items = await db.query('SELECT * FROM items WHERE id IN (?)', [ids]);
  return ids.map(id => items.find(i => i.id === id));
});
// Multiple loader.load(id) calls coalesce into a single batched query
```

Single-query approach:
```sql
-- Instead of 1 + N queries
SELECT o.*, i.* FROM orders o JOIN items i ON i.order_id = o.id WHERE o.id IN (...);
```

---

## Connection pool sizing

**Formula** (from Hikari, applies broadly):
```
pool_size ≈ (core_count × 2) + effective_spindle_count
```

For modern SSDs / cloud DBs, `effective_spindle_count` ≈ 1.

**Hard ceiling:** sum of all app pool sizes < `db.max_connections`. Leave headroom for replicas, admin sessions, monitoring agents.

**Tuning approach:**
1. Measure under load: `active`, `idle`, `waiting`.
2. If `waiting` > 0 sustained AND DB CPU has headroom → pool too small, increase.
3. If `waiting` > 0 AND DB CPU saturated → DB is the bottleneck, not the pool. Don't increase.
4. If `idle` consistently > 50% → pool oversized, decrease (saves DB resources).

**Common mistake:** setting pool size to "however many we need." Pool size > DB capacity just shifts the bottleneck and adds context-switching overhead.

---

## Caching layers

### Read-heavy patterns

| Pattern | Use when | Trade-off |
|---------|----------|-----------|
| **Cache-aside** (read-through manually) | Most cases | Simple, but cache miss = full DB hit |
| **Read-through** (cache library handles) | Hot keys, predictable access | Less app code, cache library opinions |
| **Write-through** | Read-after-write consistency required | Slower writes |
| **Write-behind** | Write-heavy, eventual consistency OK | Risk of data loss on cache failure |
| **Refresh-ahead** | Predictable hot keys, latency-critical | Wasteful if predictions wrong |

### Invalidation strategies (the hard problem)

- **TTL only**: simplest; staleness bounded by TTL. Works for most cases.
- **Event-driven invalidation**: publish "invalidate(key)" on writes. Strong consistency but operational complexity.
- **Versioned keys**: include a version in the cache key (`user:42:v3`). Bump version on write to "invalidate" without delete.
- **Tag-based**: invalidate all keys with a tag (e.g., all `user:42:*`). Redis supports this via SCAN + DEL or scripted.

### Cache stampede protection

When a hot key expires, many requests hit the DB simultaneously.

- **Single-flight / request coalescing**: only one request fetches; others wait.
  ```python
  # Pseudo
  with lock(f"lock:{key}", timeout=30):
      value = cache.get(key) or fetch_and_cache(key)
  ```
- **Probabilistic early expiration**: refresh some requests before TTL, smoothing the storm.

---

## Replicas — read scaling and failover

### Read-replica routing

Patterns:
- **Per-request affinity**: writes go to primary, reads go to replicas.
- **Read-your-writes consistency**: stickier — recent writes from this user route to primary for N seconds.
- **Connection-string-based**: separate read pool, separate write pool.

**Watch:** replica lag. If lag > X seconds and the request reads its own writes, you'll see ghost data. Track `pg_stat_replication.replay_lag` (Postgres) or `Seconds_Behind_Master` (MySQL).

### Async vs sync replication

- **Async**: lag exists; data loss possible on primary failure.
- **Sync**: zero lag; primary blocks until replica acks; latency penalty.

For most read-heavy workloads, async + bounded lag tolerance is the right call. Sync replication is justified for strong consistency (e.g., financial transactions where the ADR explicitly chose it — see your context document).

---

## Partitioning and sharding

**Partition** (single DB, multiple tables): split a large table by a key (date, customer_id ranges) so queries hit a subset.
- Postgres declarative partitioning, MySQL native partitioning.
- Useful for **time-series data** (drop old partitions = O(1) cleanup).

**Shard** (multiple DBs): split data across DB instances by a shard key.
- Big operational complexity — only when single-instance is provably exhausted.
- Cross-shard queries are expensive; design schema to minimize them.

**Don't shard prematurely.** Vertical scaling, indexing, caching, and replicas exhaust most use cases. Sharding adds operational debt that lasts forever.

---

## Common Postgres-specific tunings

| Setting | Default | Often changed to | Why |
|---------|---------|------------------|-----|
| `shared_buffers` | 128MB | 25% of RAM | Cache pages |
| `effective_cache_size` | 4GB | 50-75% of RAM | Planner hint |
| `work_mem` | 4MB | 16-64MB (per op!) | Sort/hash without spill |
| `maintenance_work_mem` | 64MB | 1GB | Faster VACUUM, CREATE INDEX |
| `max_connections` | 100 | 200-500 (with pgBouncer) | Pool first, increase second |
| `random_page_cost` | 4.0 | 1.1 (on SSD) | Planner index preference |

For MySQL: `innodb_buffer_pool_size` is the analog of `shared_buffers` (set to 50-70% of RAM on dedicated servers).

---

## When you've exhausted the DB

If indexing, caching, connection pooling, and replicas all hit limits:

1. **Materialized views / CQRS** — pre-compute read shapes; tradeoff freshness for speed.
2. **Search index** (Elasticsearch, OpenSearch) for full-text or filter-heavy queries.
3. **Time-series store** (TimescaleDB, InfluxDB) for time-series data.
4. **Wide-column / KV** (Cassandra, DynamoDB) for write-heavy at scale.
5. **Re-architect**: maybe the data model is fighting the query pattern.

Each of these is a multi-quarter migration. Justify with measurements, not with "PostgreSQL doesn't scale" (it does, until it doesn't).
