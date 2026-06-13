/**
 * CR-01 regression suite for bin/load-redis-data.js loadToRedis().
 *
 * Source: .planning/milestones/v0.3.0-phases/06-developer-experience-documentation/06-REVIEW.md
 *
 * Original defects (Phase 6 critical review):
 *   1. `const pipeline = redis.pipeline()` was created ONCE outside the batch loop and
 *      never reset after `pipeline.exec()`. ioredis pipelines do NOT clear their
 *      command queue on exec — every batch re-replayed all prior batches, so the
 *      actual write count was O(N^2/BATCH) instead of N.
 *   2. `loaded += Math.min(BATCH, (i % BATCH) + 1)` mis-counted the final partial
 *      batch, then `loaded - errors * BATCH` subtracted a magic number unrelated
 *      to actual per-command failures.
 *   3. `pipeline.exec()` resolves with `[[err, result], ...]` — per-command errors
 *      never throw. The try/catch only catches transport-level rejections; the
 *      per-command failure modes were silently dropped.
 *
 * Fix policy (canonical, NOT either-or):
 *   - `let pipeline = redis.pipeline()` reset after every flush.
 *   - Per-command-tuple error accounting: iterate the array returned by `exec()`
 *     and count tuples whose first element is a non-null Error as failures.
 *   - Transport-level rejection: when `exec()` itself rejects, the whole queued
 *     batch is counted toward `errors`.
 *
 * Tests inject a fake ioredis via `vi.mock('ioredis', ...)`, then require the
 * patched script which exposes `loadToRedis` for direct invocation (the script
 * still auto-invokes the CLI only `if (require.main === module)`).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

interface FakePipeline {
  hset: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
  exec: ReturnType<typeof vi.fn>;
  __queuedHsets: Array<[string, ...string[]]>;
}

interface PipelineFactoryOptions {
  /** Override the result returned by exec() for the Nth flush (0-indexed). */
  execResultPerFlush?: Array<Array<[Error | null, unknown]> | "reject">;
}

/**
 * Build a fake Redis whose `.pipeline()` produces a brand-new pipeline mock
 * each call. Tracks per-pipeline queued hset commands and exposes total
 * flushes via a global counter (`mockRedis.__pipelineFactoryCalls`).
 */
function buildMockRedis(opts: PipelineFactoryOptions = {}): {
  pipeline: () => FakePipeline;
  __pipelineFactoryCalls: number;
  __pipelines: FakePipeline[];
} {
  const state = {
    pipeline: function () {
      const idx = state.__pipelineFactoryCalls;
      state.__pipelineFactoryCalls += 1;

      const queued: Array<[string, ...string[]]> = [];
      const p: FakePipeline = {
        __queuedHsets: queued,
        hset: vi.fn((key: string, ...fields: string[]) => {
          queued.push([key, ...fields]);
          return p;
        }),
        expire: vi.fn(() => p),
        exec: vi.fn(() => {
          // Default success for every queued command in this pipeline.
          const planned = opts.execResultPerFlush?.[idx];
          if (planned === "reject") {
            return Promise.reject(new Error("transport-level failure"));
          }
          if (Array.isArray(planned)) {
            return Promise.resolve(planned);
          }
          return Promise.resolve(queued.map(() => [null, "OK"] as [Error | null, unknown]));
        }),
      };
      state.__pipelines.push(p);
      return p;
    },
    __pipelineFactoryCalls: 0,
    __pipelines: [] as FakePipeline[],
  };
  return state;
}

// Mock ioredis BEFORE requiring the script. The script's `require("ioredis")`
// only triggers the install check at module load — it does not instantiate a
// connection unless main() runs (which is gated by require.main === module).
vi.mock("ioredis", () => {
  // Default export so `require("ioredis")` returns a class-like ctor.
  // Not used by loadToRedis directly (we pass a fake redis object in tests),
  // but keeps the script's top-level `require("ioredis")` happy.
  return {
    default: class FakeIoRedis {
      ping() {
        return Promise.resolve("PONG");
      }
      quit() {
        return Promise.resolve("OK");
      }
    },
  };
});

// Suppress console.log/error noise from the script during tests.
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

// Lazy require so the mock is applied first.
function importScript(extraArgv: string[] = []): {
  loadToRedis: (
    redis: unknown,
    records: Array<Record<string, unknown>>,
    prefix: string,
    ttl: number | null,
    label: string
  ) => Promise<{ loaded: number; errors: number }>;
  BATCH: number;
} {
  // Bust the require cache so each test starts fresh (the script sets module
  // state from argv at load time; calling with --help would exit, so we set
  // an inert argv before requiring).
  const scriptPath = require.resolve("../../bin/load-redis-data.js");
  delete require.cache[scriptPath];
  // Set argv so the script's validation doesn't process.exit(1). Important:
  // do NOT include --dry-run by default — DRY_RUN is a module-level boolean
  // and would make loadToRedis short-circuit before invoking pipeline().
  const originalArgv = process.argv;
  process.argv = ["node", "bin/load-redis-data.js", "--users=/tmp/nonexistent.csv", ...extraArgv];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(scriptPath);
    return { loadToRedis: mod.loadToRedis, BATCH: mod.BATCH ?? 50 };
  } finally {
    process.argv = originalArgv;
  }
}

describe("bin/load-redis-data.js loadToRedis() — CR-01 regression", () => {
  it("150 records with BATCH=50 → exactly 3 flushes, 150 hset calls total, loaded === 150, errors === 0", async () => {
    const { loadToRedis } = importScript();
    const mockRedis = buildMockRedis();
    const records = Array.from({ length: 150 }, (_, i) => ({ id: `u${i}`, name: `User ${i}` }));

    const result = await loadToRedis(mockRedis, records, "user:", null, "user");

    // 150 records / batch of 50 = exactly 3 pipeline factory calls (3 flushes).
    expect(mockRedis.__pipelineFactoryCalls).toBe(3);
    // 3 exec calls total — one per flush.
    const totalExecCalls = mockRedis.__pipelines.reduce(
      (sum, p) => sum + (p.exec as ReturnType<typeof vi.fn>).mock.calls.length,
      0
    );
    expect(totalExecCalls).toBe(3);

    // 150 hset calls total across all flushes (50 + 50 + 50). No duplicate replays.
    const totalHsetCalls = mockRedis.__pipelines.reduce(
      (sum, p) => sum + (p.hset as ReturnType<typeof vi.fn>).mock.calls.length,
      0
    );
    expect(totalHsetCalls).toBe(150);

    // Each flush queued exactly 50 unique records.
    for (const p of mockRedis.__pipelines) {
      expect(p.__queuedHsets).toHaveLength(50);
    }

    // Distinct keys across all flushes (no replays).
    const allKeys = mockRedis.__pipelines.flatMap((p) => p.__queuedHsets.map(([k]) => k));
    expect(new Set(allKeys).size).toBe(150);

    expect(result.loaded).toBe(150);
    expect(result.errors).toBe(0);
  });

  it("173 records (non-multiple of BATCH=50) → exactly 4 flushes (50+50+50+23), loaded === 173, errors === 0", async () => {
    const { loadToRedis } = importScript();
    const mockRedis = buildMockRedis();
    const records = Array.from({ length: 173 }, (_, i) => ({ id: `r${i}`, kind: "x" }));

    const result = await loadToRedis(mockRedis, records, "rec:", null, "rec");

    expect(mockRedis.__pipelineFactoryCalls).toBe(4);
    const sizes = mockRedis.__pipelines.map((p) => p.__queuedHsets.length);
    expect(sizes).toEqual([50, 50, 50, 23]);

    expect(result.loaded).toBe(173);
    expect(result.errors).toBe(0);
  });

  it("per-command-tuple error accounting: errors increments by count of Error tuples; loaded by count of null-error tuples", async () => {
    const { loadToRedis } = importScript();
    // 100 records → 2 flushes of 50 each.
    // First flush: 3 of 50 commands fail per-command (still resolves array).
    // Second flush: all succeed.
    const flush1Result: Array<[Error | null, unknown]> = Array.from({ length: 50 }, (_, i) =>
      i < 3
        ? ([
            new Error("WRONGTYPE Operation against a key holding the wrong kind of value"),
            null,
          ] as [Error, null])
        : ([null, "OK"] as [null, "OK"])
    );
    const flush2Result: Array<[Error | null, unknown]> = Array.from(
      { length: 50 },
      () => [null, "OK"] as [null, "OK"]
    );

    const mockRedis = buildMockRedis({
      execResultPerFlush: [flush1Result, flush2Result],
    });
    const records = Array.from({ length: 100 }, (_, i) => ({ id: `t${i}` }));

    const result = await loadToRedis(mockRedis, records, "t:", null, "t");

    expect(mockRedis.__pipelineFactoryCalls).toBe(2);
    expect(result.errors).toBe(3); // exactly the count of Error tuples in flush 1
    expect(result.loaded).toBe(97); // 47 from flush 1 + 50 from flush 2
  });

  it("transport-level rejection: all queued commands in the failed flush count as errors; processing continues", async () => {
    const { loadToRedis } = importScript();
    // 100 records → 2 flushes. First flush rejects at transport level; second succeeds.
    const flush2Result: Array<[Error | null, unknown]> = Array.from(
      { length: 50 },
      () => [null, "OK"] as [null, "OK"]
    );
    const mockRedis = buildMockRedis({
      execResultPerFlush: ["reject", flush2Result],
    });
    const records = Array.from({ length: 100 }, (_, i) => ({ id: `f${i}` }));

    const result = await loadToRedis(mockRedis, records, "f:", null, "f");

    expect(mockRedis.__pipelineFactoryCalls).toBe(2);
    expect(result.errors).toBe(50); // entire failed flush
    expect(result.loaded).toBe(50); // only the second flush succeeded
  });

  it("DRY_RUN does not invoke pipeline at all", async () => {
    // DRY_RUN is module-level state — re-load the script with --dry-run argv.
    const scriptPath = require.resolve("../../bin/load-redis-data.js");
    delete require.cache[scriptPath];
    const originalArgv = process.argv;
    process.argv = ["node", "bin/load-redis-data.js", "--users=/tmp/x.csv", "--dry-run"];
    let loadToRedis: typeof import("../../bin/load-redis-data").loadToRedis;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(scriptPath);
      loadToRedis = mod.loadToRedis;
    } finally {
      process.argv = originalArgv;
    }

    const mockRedis = buildMockRedis();
    const records = Array.from({ length: 200 }, (_, i) => ({ id: `d${i}` }));

    const result = await loadToRedis(mockRedis, records, "d:", null, "d");

    expect(mockRedis.__pipelineFactoryCalls).toBe(0);
    expect(result.loaded).toBe(200);
    expect(result.errors).toBe(0);
  });

  it("ttl flag applies expire() after every hset", async () => {
    const { loadToRedis } = importScript();
    const mockRedis = buildMockRedis();
    const records = Array.from({ length: 10 }, (_, i) => ({ id: `e${i}`, v: 1 }));

    await loadToRedis(mockRedis, records, "e:", 60, "e");

    // 1 flush expected (10 < 50 → flushes only at end).
    expect(mockRedis.__pipelineFactoryCalls).toBe(1);
    const p = mockRedis.__pipelines[0];
    expect((p.hset as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(10);
    expect((p.expire as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(10);
  });
});
