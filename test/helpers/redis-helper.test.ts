import { describe, it, expect, vi, beforeEach } from "vitest";
import { RedisHelper } from "../../src/helpers/redis-helper";

// Create the mock client
function createMockRedisClient() {
  return {
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
    exists: vi.fn(),
    mset: vi.fn(),
    mget: vi.fn(),
    incr: vi.fn(),
    incrby: vi.fn(),
    lpush: vi.fn(),
    rpush: vi.fn(),
    lpop: vi.fn(),
    rpop: vi.fn(),
    llen: vi.fn(),
    lrange: vi.fn(),
    hset: vi.fn(),
    hget: vi.fn(),
    hgetall: vi.fn(),
    hdel: vi.fn(),
    expire: vi.fn(),
    ttl: vi.fn(),
    close: vi.fn(),
    scan: vi.fn(),
  };
}

/**
 * Create a RedisHelper instance with a mocked client injected,
 * bypassing the constructor's require("k6/x/redis") call.
 */
function createTestHelper(
  mockClient: ReturnType<typeof createMockRedisClient>,
  url = "redis://localhost:6379"
): RedisHelper {
  // Use Object.create to bypass the constructor
  const instance = Object.create(RedisHelper.prototype) as RedisHelper;
  // Set private fields directly via type-unsafe cast
  const raw = instance as unknown as Record<string, unknown>;
  raw["client"] = mockClient;
  raw["url"] = url;
  raw["maxRetries"] = 3;
  return instance;
}

describe("RedisHelper", () => {
  let mockClient: ReturnType<typeof createMockRedisClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockRedisClient();
    (globalThis as Record<string, unknown>).__ENV = {};
  });

  // ── Constructor behavior ───────────────────────────────────────────────────

  describe("constructor", () => {
    it("throws with guidance when xk6-redis is not available", () => {
      expect(() => new RedisHelper()).toThrow(
        "Ensure you are using a k6 binary compiled with xk6-redis"
      );
    });

    it("uses REDIS_URL from __ENV for error message", () => {
      (globalThis as Record<string, unknown>).__ENV = { REDIS_URL: "redis://custom:6380" };
      expect(() => new RedisHelper()).toThrow("redis://custom:6380");
    });

    it("accepts string URL (backwards compat)", () => {
      expect(() => new RedisHelper("redis://explicit:6379")).toThrow("redis://explicit:6379");
    });

    it("masks credentials in error message", () => {
      try {
        new RedisHelper({ url: "redis://user:password@host:6379" });
      } catch (err) {
        const msg = (err as Error).message;
        expect(msg).not.toContain("password");
        expect(msg).toContain("***");
      }
    });
  });

  // ── Basic operations (using injected mock client) ──────────────────────────

  describe("set", () => {
    it("sets a key-value pair", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.set.mockResolvedValue(undefined);
      await helper.set("key1", "value1");
      expect(mockClient.set).toHaveBeenCalledWith("key1", "value1");
    });

    it("sets with TTL", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.set.mockResolvedValue(undefined);
      await helper.set("key1", "value1", 60);
      expect(mockClient.set).toHaveBeenCalledWith("key1", "value1", { ex: 60 });
    });

    it("warns when TTL is zero or negative", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const helper = createTestHelper(mockClient);
      mockClient.set.mockResolvedValue(undefined);
      await helper.set("key1", "value1", 0);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("TTL=0"));
      warnSpy.mockRestore();
    });

    it("sets without TTL when TTL is undefined", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.set.mockResolvedValue(undefined);
      await helper.set("key1", "value1");
      expect(mockClient.set).toHaveBeenCalledWith("key1", "value1");
    });
  });

  describe("get", () => {
    it("returns value for existing key", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.get.mockResolvedValue("stored_value");
      const result = await helper.get("key1");
      expect(result).toBe("stored_value");
    });

    it("returns null for non-existing key", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.get.mockResolvedValue(null);
      const result = await helper.get("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("del", () => {
    it("deletes keys and returns count", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.del.mockResolvedValue(2);
      const result = await helper.del("key1", "key2");
      expect(result).toBe(2);
      expect(mockClient.del).toHaveBeenCalledWith("key1", "key2");
    });
  });

  describe("exists", () => {
    it("returns true when key exists (result = 1)", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.exists.mockResolvedValue(1);
      expect(await helper.exists("key1")).toBe(true);
    });

    it("returns false when key does not exist (result = 0)", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.exists.mockResolvedValue(0);
      expect(await helper.exists("missing")).toBe(false);
    });
  });

  // ── Multiple key operations ────────────────────────────────────────────────

  describe("mset", () => {
    it("sets multiple key-value pairs from object", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.mset.mockResolvedValue(undefined);
      await helper.mset({ key1: "val1", key2: "val2" });
      expect(mockClient.mset).toHaveBeenCalledWith("key1", "val1", "key2", "val2");
    });

    it("sets multiple key-value pairs from array of tuples", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.mset.mockResolvedValue(undefined);
      await helper.mset([
        ["k1", "v1"],
        ["k2", "v2"],
      ]);
      expect(mockClient.mset).toHaveBeenCalledWith("k1", "v1", "k2", "v2");
    });
  });

  describe("mget", () => {
    it("returns values for multiple keys", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.mget.mockResolvedValue(["v1", null, "v3"]);
      const result = await helper.mget(["key1", "key2", "key3"]);
      expect(result).toEqual(["v1", null, "v3"]);
    });
  });

  // ── Counters ───────────────────────────────────────────────────────────────

  describe("incr", () => {
    it("increments key and returns new value", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.incr.mockResolvedValue(5);
      expect(await helper.incr("counter")).toBe(5);
    });
  });

  describe("incrby", () => {
    it("increments key by amount and returns new value", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.incrby.mockResolvedValue(15);
      expect(await helper.incrby("counter", 10)).toBe(15);
    });
  });

  // ── List operations ────────────────────────────────────────────────────────

  describe("lpush", () => {
    it("pushes values to the left and returns new length", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.lpush.mockResolvedValue(3);
      const result = await helper.lpush("list", "a", "b");
      expect(result).toBe(3);
    });
  });

  describe("rpush", () => {
    it("pushes values to the right and returns new length", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.rpush.mockResolvedValue(5);
      const result = await helper.rpush("list", "x");
      expect(result).toBe(5);
    });
  });

  describe("lpop", () => {
    it("pops from the left", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.lpop.mockResolvedValue("first");
      expect(await helper.lpop("list")).toBe("first");
    });
  });

  describe("rpop", () => {
    it("pops from the right", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.rpop.mockResolvedValue("last");
      expect(await helper.rpop("list")).toBe("last");
    });
  });

  describe("llen", () => {
    it("returns list length", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.llen.mockResolvedValue(10);
      expect(await helper.llen("list")).toBe(10);
    });
  });

  describe("lrange", () => {
    it("returns range of elements", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.lrange.mockResolvedValue(["a", "b", "c"]);
      const result = await helper.lrange("list", 0, -1);
      expect(result).toEqual(["a", "b", "c"]);
    });
  });

  // ── Hash operations ────────────────────────────────────────────────────────

  describe("hset", () => {
    it("sets a hash field", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.hset.mockResolvedValue(1);
      const result = await helper.hset("hash", "field", "value");
      expect(result).toBe(1);
      expect(mockClient.hset).toHaveBeenCalledWith("hash", "field", "value");
    });
  });

  describe("hmset", () => {
    it("sets multiple hash fields via hset with flat args", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.hset.mockResolvedValue(undefined);
      await helper.hmset("hash", { name: "Alice", age: "30" });
      expect(mockClient.hset).toHaveBeenCalledWith("hash", "name", "Alice", "age", "30");
    });
  });

  describe("hget", () => {
    it("gets a hash field value", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.hget.mockResolvedValue("Alice");
      expect(await helper.hget("hash", "name")).toBe("Alice");
    });

    it("returns null when field does not exist", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.hget.mockResolvedValue(null);
      expect(await helper.hget("hash", "missing")).toBeNull();
    });
  });

  describe("hgetall", () => {
    it("returns object when result is already an object", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.hgetall.mockResolvedValue({ name: "Alice", age: "30" });
      const result = await helper.hgetall("hash");
      expect(result).toEqual({ name: "Alice", age: "30" });
    });

    it("converts flat array to object", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.hgetall.mockResolvedValue(["name", "Alice", "age", "30"]);
      const result = await helper.hgetall("hash");
      expect(result).toEqual({ name: "Alice", age: "30" });
    });

    it("returns empty object when result is null", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.hgetall.mockResolvedValue(null);
      const result = await helper.hgetall("hash");
      expect(result).toEqual({});
    });

    it("throws descriptive error on WRONGTYPE", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.hgetall.mockRejectedValue(new Error("WRONGTYPE Operation"));
      await expect(helper.hgetall("string-key")).rejects.toThrow("key is not a hash type");
    });

    it("re-throws non-WRONGTYPE errors", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.hgetall.mockRejectedValue(new Error("Connection lost"));
      await expect(helper.hgetall("key")).rejects.toThrow("Connection lost");
    });
  });

  describe("hdel", () => {
    it("deletes hash fields and returns count", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.hdel.mockResolvedValue(1);
      const result = await helper.hdel("hash", "field1");
      expect(result).toBe(1);
    });
  });

  // ── TTL operations ─────────────────────────────────────────────────────────

  describe("expire", () => {
    it("returns true when TTL is set (result = 1)", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.expire.mockResolvedValue(1);
      expect(await helper.expire("key", 60)).toBe(true);
    });

    it("returns false when key does not exist (result = 0)", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.expire.mockResolvedValue(0);
      expect(await helper.expire("missing", 60)).toBe(false);
    });
  });

  describe("ttl", () => {
    it("returns TTL in seconds", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.ttl.mockResolvedValue(300);
      expect(await helper.ttl("key")).toBe(300);
    });

    it("returns -1 for key without expiry", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.ttl.mockResolvedValue(-1);
      expect(await helper.ttl("persistent")).toBe(-1);
    });

    it("returns -2 for non-existent key", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.ttl.mockResolvedValue(-2);
      expect(await helper.ttl("missing")).toBe(-2);
    });
  });

  // ── disconnect ─────────────────────────────────────────────────────────────

  describe("disconnect", () => {
    it("closes the connection", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.close.mockResolvedValue(undefined);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await helper.disconnect();
      expect(mockClient.close).toHaveBeenCalled();
      logSpy.mockRestore();
    });

    it("handles disconnect errors gracefully", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const helper = createTestHelper(mockClient);
      mockClient.close.mockRejectedValue(new Error("already closed"));
      await helper.disconnect(); // should not throw
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Disconnect warning"));
      warnSpy.mockRestore();
    });

    it("does nothing when client is null", async () => {
      const helper = createTestHelper(mockClient);
      // Forcefully clear the client
      (helper as unknown as Record<string, unknown>)["client"] = null;
      await helper.disconnect(); // should not throw
    });
  });

  // ── Bulk helpers ───────────────────────────────────────────────────────────

  describe("bulkLoadHashes", () => {
    it("loads array of objects as Redis hashes", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.hset.mockResolvedValue(undefined);
      const items = [
        { name: "Alice", age: "30" },
        { name: "Bob", age: "25" },
      ];
      const result = await helper.bulkLoadHashes("user:", items);
      expect(result.loaded).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it("uses idField when provided", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.hset.mockResolvedValue(undefined);
      const items = [{ id: "u1", name: "Alice" }];
      await helper.bulkLoadHashes("user:", items, "id");
      expect(mockClient.hset).toHaveBeenCalledWith(
        "user:u1",
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String)
      );
    });

    it("uses array index when no idField", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.hset.mockResolvedValue(undefined);
      const items = [{ name: "Alice" }];
      await helper.bulkLoadHashes("user:", items);
      expect(mockClient.hset).toHaveBeenCalledWith(
        "user:0",
        expect.any(String),
        expect.any(String)
      );
    });

    it("skips invalid (null) items", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.hset.mockResolvedValue(undefined);
      const items = [{ name: "Alice" }, null as never, { name: "Bob" }];
      const result = await helper.bulkLoadHashes("user:", items);
      expect(result.loaded).toBe(2);
      expect(result.skipped).toBe(1);
    });

    it("records errors per item", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.hset
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("Write error"));
      const items = [{ name: "Alice" }, { name: "Bob" }];
      const result = await helper.bulkLoadHashes("user:", items);
      expect(result.loaded).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Write error");
    });
  });

  describe("bulkLoadList", () => {
    it("loads values into a Redis list", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.rpush.mockResolvedValue(3);
      const result = await helper.bulkLoadList("mylist", ["a", "b", "c"]);
      expect(result).toBe(3);
    });

    it("returns 0 for empty array", async () => {
      const helper = createTestHelper(mockClient);
      const result = await helper.bulkLoadList("mylist", []);
      expect(result).toBe(0);
      expect(mockClient.rpush).not.toHaveBeenCalled();
    });

    it("batches large arrays in groups of 100", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.rpush.mockResolvedValue(250);
      const values = Array.from({ length: 250 }, (_, i) => `item_${i}`);
      await helper.bulkLoadList("mylist", values);
      // 250 items / 100 batch size = 3 calls
      expect(mockClient.rpush).toHaveBeenCalledTimes(3);
    });
  });

  describe("deleteByPrefix", () => {
    it("deletes all keys matching prefix using SCAN", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.scan
        .mockResolvedValueOnce([10, ["user:1", "user:2"]])
        .mockResolvedValueOnce([0, ["user:3"]]);
      mockClient.del.mockResolvedValue(2);
      const result = await helper.deleteByPrefix("user:");
      expect(result).toBe(3);
      expect(mockClient.scan).toHaveBeenCalledTimes(2);
    });

    it("handles no keys found", async () => {
      const helper = createTestHelper(mockClient);
      mockClient.scan.mockResolvedValueOnce([0, []]);
      const result = await helper.deleteByPrefix("nonexistent:");
      expect(result).toBe(0);
    });
  });

  // ── assertClient ──────────────────────────────────────────────────────────

  describe("assertClient", () => {
    it("throws when client is null", async () => {
      const helper = createTestHelper(mockClient);
      (helper as unknown as Record<string, unknown>)["client"] = null;
      await expect(helper.get("key")).rejects.toThrow("Not connected");
    });
  });
});
