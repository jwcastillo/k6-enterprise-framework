import { describe, it, expect, vi, beforeEach } from "vitest";
import { DataPool, createPool, createCsvPool } from "../../src/helpers/data-pool";

describe("DataPool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset __VU to 1 for deterministic tests
    (globalThis as Record<string, unknown>).__VU = 1;
  });

  // ── Constructor ────────────────────────────────────────────────────────────

  describe("constructor", () => {
    it("creates pool with given records", () => {
      const pool = new DataPool([{ id: 1 }, { id: 2 }, { id: 3 }]);
      expect(pool.size).toBe(3);
    });

    it("creates a copy of records (no mutation)", () => {
      const records = [{ id: 1 }, { id: 2 }];
      const pool = new DataPool(records);
      expect(pool.size).toBe(2);
      records.push({ id: 3 });
      expect(pool.size).toBe(2);
    });

    it("limits records when maxRecords is set", () => {
      const records = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
      const pool = new DataPool(records, { maxRecords: 2 });
      expect(pool.size).toBe(2);
    });

    it("defaults exhaustionPolicy to recycle", () => {
      const pool = new DataPool([{ id: 1 }]);
      expect(pool.size).toBe(1);
    });

    it("warns when initialized with empty records", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      new DataPool([]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("pool initialized with 0 records")
      );
      warnSpy.mockRestore();
    });
  });

  // ── getRecord ─────────────────────────────────────────────────────────────

  describe("getRecord", () => {
    it("returns record based on __VU modulo pool size", () => {
      const records = [{ name: "a" }, { name: "b" }, { name: "c" }];
      const pool = new DataPool(records);

      (globalThis as Record<string, unknown>).__VU = 1;
      expect(pool.getRecord()).toEqual({ name: "a" }); // (1-1) % 3 = 0

      (globalThis as Record<string, unknown>).__VU = 2;
      expect(pool.getRecord()).toEqual({ name: "b" }); // (2-1) % 3 = 1

      (globalThis as Record<string, unknown>).__VU = 3;
      expect(pool.getRecord()).toEqual({ name: "c" }); // (3-1) % 3 = 2

      (globalThis as Record<string, unknown>).__VU = 4;
      expect(pool.getRecord()).toEqual({ name: "a" }); // (4-1) % 3 = 0
    });

    it("handles empty pool with recycle policy by throwing", () => {
      const pool = new DataPool([], { exhaustionPolicy: "recycle" });
      expect(() => pool.getRecord()).toThrow("Pool is empty — cannot recycle");
    });

    it("handles empty pool with generate policy by returning null", () => {
      const pool = new DataPool([], { exhaustionPolicy: "generate" });
      expect(pool.getRecord()).toBeNull();
    });

    it("handles empty pool with stop policy by throwing", () => {
      const pool = new DataPool([], { exhaustionPolicy: "stop" });
      expect(() => pool.getRecord()).toThrow("Pool exhausted");
    });
  });

  // ── getNextRecord ─────────────────────────────────────────────────────────

  describe("getNextRecord", () => {
    it("returns records sequentially", () => {
      const pool = new DataPool([{ id: 1 }, { id: 2 }, { id: 3 }]);
      expect(pool.getNextRecord()).toEqual({ id: 1 });
      expect(pool.getNextRecord()).toEqual({ id: 2 });
      expect(pool.getNextRecord()).toEqual({ id: 3 });
    });

    it("recycles when cursor exceeds pool size (recycle policy)", () => {
      const pool = new DataPool([{ id: 1 }, { id: 2 }], {
        exhaustionPolicy: "recycle",
      });
      pool.getNextRecord(); // 0
      pool.getNextRecord(); // 1
      const recycled = pool.getNextRecord(); // exhaustion → recycle → returns first
      expect(recycled).toEqual({ id: 1 });
    });

    it("returns null when exhausted with generate policy", () => {
      const pool = new DataPool([{ id: 1 }], {
        exhaustionPolicy: "generate",
      });
      pool.getNextRecord(); // 0
      const result = pool.getNextRecord(); // exhaustion → null
      expect(result).toBeNull();
    });

    it("throws when exhausted with stop policy", () => {
      const pool = new DataPool([{ id: 1 }], {
        exhaustionPolicy: "stop",
      });
      pool.getNextRecord();
      expect(() => pool.getNextRecord()).toThrow("Pool exhausted");
    });
  });

  // ── getRecordBatch ────────────────────────────────────────────────────────

  describe("getRecordBatch", () => {
    it("returns batch of records starting from VU offset", () => {
      const records = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
      const pool = new DataPool(records);
      (globalThis as Record<string, unknown>).__VU = 1;
      const batch = pool.getRecordBatch(2);
      expect(batch).toHaveLength(2);
      expect(batch[0]).toEqual({ id: 1 });
      expect(batch[1]).toEqual({ id: 2 });
    });

    it("wraps around with recycle policy", () => {
      const records = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const pool = new DataPool(records, { exhaustionPolicy: "recycle" });
      (globalThis as Record<string, unknown>).__VU = 1;
      const batch = pool.getRecordBatch(5);
      expect(batch).toHaveLength(5);
    });

    it("returns empty array when pool is empty", () => {
      const pool = new DataPool([]);
      const batch = pool.getRecordBatch(3);
      expect(batch).toEqual([]);
    });
  });

  // ── getRandomRecord ───────────────────────────────────────────────────────

  describe("getRandomRecord", () => {
    it("returns a record from the pool", () => {
      const records = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const pool = new DataPool(records);
      const record = pool.getRandomRecord();
      expect(records).toContainEqual(record);
    });

    it("handles empty pool with recycle policy by throwing", () => {
      const pool = new DataPool([], { exhaustionPolicy: "recycle" });
      expect(() => pool.getRandomRecord()).toThrow("Pool is empty");
    });

    it("handles empty pool with generate policy by returning null", () => {
      const pool = new DataPool([], { exhaustionPolicy: "generate" });
      expect(pool.getRandomRecord()).toBeNull();
    });
  });

  // ── getByKey ──────────────────────────────────────────────────────────────

  describe("getByKey", () => {
    it("finds record by key field", () => {
      const records = [
        { username: "alice", role: "admin" },
        { username: "bob", role: "user" },
      ];
      const pool = new DataPool(records, { keyField: "username" });
      expect(pool.getByKey("bob")).toEqual({ username: "bob", role: "user" });
    });

    it("returns undefined when key not found", () => {
      const records = [{ username: "alice" }];
      const pool = new DataPool(records, { keyField: "username" });
      expect(pool.getByKey("charlie")).toBeUndefined();
    });

    it("throws when keyField is not configured", () => {
      const pool = new DataPool([{ id: 1 }]);
      expect(() => pool.getByKey("anything")).toThrow(
        "getByKey requires keyField to be configured"
      );
    });
  });

  // ── reset ─────────────────────────────────────────────────────────────────

  describe("reset", () => {
    it("resets cursor to beginning", () => {
      const pool = new DataPool([{ id: 1 }, { id: 2 }]);
      pool.getNextRecord(); // cursor 0 → 1
      pool.getNextRecord(); // cursor 1 → 2
      pool.reset();
      expect(pool.getNextRecord()).toEqual({ id: 1 });
    });
  });

  // ── size ──────────────────────────────────────────────────────────────────

  describe("size", () => {
    it("returns the number of records", () => {
      const pool = new DataPool([{ a: 1 }, { a: 2 }, { a: 3 }]);
      expect(pool.size).toBe(3);
    });

    it("returns 0 for empty pool", () => {
      const pool = new DataPool([]);
      expect(pool.size).toBe(0);
    });
  });
});

// ── createPool ──────────────────────────────────────────────────────────────

describe("createPool", () => {
  it("creates DataPool from JSON string", () => {
    const json = JSON.stringify([{ id: 1 }, { id: 2 }]);
    const pool = createPool(json);
    expect(pool.size).toBe(2);
  });

  it("throws when JSON is not an array", () => {
    const json = JSON.stringify({ notAnArray: true });
    expect(() => createPool(json)).toThrow("Data file must contain a JSON array");
  });

  it("passes config to DataPool", () => {
    const json = JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const pool = createPool(json, { maxRecords: 2 });
    expect(pool.size).toBe(2);
  });
});

// ── createCsvPool ───────────────────────────────────────────────────────────

describe("createCsvPool", () => {
  it("parses CSV with header row", () => {
    const csv = "name,age,city\nAlice,30,NYC\nBob,25,LA";
    const pool = createCsvPool(csv);
    expect(pool.size).toBe(2);
    const record = pool.getRecord();
    expect(record).toHaveProperty("name");
    expect(record).toHaveProperty("age");
    expect(record).toHaveProperty("city");
  });

  it("creates empty pool for header-only CSV", () => {
    const csv = "name,age";
    const pool = createCsvPool(csv);
    expect(pool.size).toBe(0);
  });

  it("handles missing values with empty string", () => {
    const csv = "a,b,c\n1,2\n4,5,6";
    const pool = createCsvPool(csv);
    expect(pool.size).toBe(2);
    const first = pool.getRecord();
    expect(first.c).toBe("");
  });

  it("trims whitespace from headers and values", () => {
    const csv = " name , age \n Alice , 30 ";
    const pool = createCsvPool(csv);
    const record = pool.getRecord();
    expect(record).toHaveProperty("name", "Alice");
    expect(record).toHaveProperty("age", "30");
  });

  it("returns empty pool for empty content", () => {
    const pool = createCsvPool("");
    expect(pool.size).toBe(0);
  });
});
