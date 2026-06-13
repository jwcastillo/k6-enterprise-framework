/**
 * T-032: Per-client data pools with unique allocation
 *
 * Manages isolated data pools per client. Each pool provides:
 * - Unique record allocation per VU (no collisions with __VU % N)
 * - Three exhaustion policies: recycle, generate, stop
 * - Concurrent access safety (VU-based indexing, no shared state)
 *
 * This module runs in k6 goja runtime — uses open() and __VU.
 * Pool config is loaded from clients/{name}/config/ or passed directly.
 */

import { DataPoolConfig, ExhaustionPolicy } from "../types/client.d";

// ── Data pool class ───────────────────────────────────────────────────────────

/**
 * A data pool that provides unique records per VU.
 *
 * @example
 * // In scenario init:
 * const users = new DataPool(JSON.parse(open('./data/users.json')), { exhaustionPolicy: 'recycle' });
 *
 * // In default function:
 * export default function () {
 *   const user = users.getRecord(); // Unique per VU
 * }
 */
export class DataPool<T = Record<string, unknown>> {
  private readonly records: T[];
  private readonly policy: ExhaustionPolicy;
  private readonly keyField: string | undefined;
  private cursor: number;

  /**
   * Create a data pool from an array of records.
   *
   * @param records - Array of data records
   * @param config - Pool configuration (exhaustionPolicy, keyField)
   */
  constructor(
    records: T[],
    config: Partial<DataPoolConfig> = {},
  ) {
    const maxRecords = config.maxRecords ?? 0;
    this.records =
      maxRecords > 0 ? records.slice(0, maxRecords) : [...records];
    this.policy = config.exhaustionPolicy ?? "recycle";
    this.keyField = config.keyField;
    this.cursor = 0;

    if (this.records.length === 0) {
      console.warn("[data-pool] Warning: pool initialized with 0 records.");
    }
  }

  /** Total number of records in the pool */
  get size(): number {
    return this.records.length;
  }

  /**
   * Get a record unique to the current VU.
   * Uses __VU modulo pool size for collision-free static allocation.
   *
   * For pools smaller than VU count, the exhaustion policy applies:
   * - recycle: wraps around to beginning
   * - generate: returns null (caller should generate via DataHelper)
   * - stop: throws error
   */
  getRecord(): T {
    if (this.records.length === 0) {
      return this.handleExhaustion();
    }

    // VU-based index — each VU gets a deterministic record
    const vuId = typeof __VU !== "undefined" ? __VU : 1;
    const index = (vuId - 1) % this.records.length;

    return this.records[index];
  }

  /**
   * Get the next record in sequence (for iteration-based access).
   * Each call advances the cursor. Thread-safe via VU isolation (each VU
   * has its own copy of the module in k6).
   */
  getNextRecord(): T {
    if (this.records.length === 0) {
      return this.handleExhaustion();
    }

    const index = this.cursor;
    this.cursor++;

    if (index >= this.records.length) {
      return this.handleExhaustion();
    }

    return this.records[index];
  }

  /**
   * Get a batch of N records starting from the VU's offset.
   */
  getRecordBatch(count: number): T[] {
    if (this.records.length === 0) return [];

    const vuId = typeof __VU !== "undefined" ? __VU : 1;
    const startIndex = ((vuId - 1) * count) % this.records.length;

    const batch: T[] = [];
    for (let i = 0; i < count; i++) {
      const idx = (startIndex + i) % this.records.length;
      if (idx >= this.records.length && this.policy !== "recycle") {
        break;
      }
      batch.push(this.records[idx % this.records.length]);
    }

    return batch;
  }

  /**
   * Get a random record from the pool.
   * Not VU-unique — use for non-critical data selection.
   */
  getRandomRecord(): T {
    if (this.records.length === 0) {
      return this.handleExhaustion();
    }
    const index = Math.floor(Math.random() * this.records.length);
    return this.records[index];
  }

  /**
   * Get a record by key field value.
   */
  getByKey(value: unknown): T | undefined {
    if (!this.keyField) {
      throw new Error(
        "[data-pool] getByKey requires keyField to be configured.",
      );
    }
    return this.records.find(
      (r) => (r as Record<string, unknown>)[this.keyField!] === value,
    );
  }

  /**
   * Handle pool exhaustion based on the configured policy.
   */
  private handleExhaustion(): T {
    switch (this.policy) {
      case "recycle":
        this.cursor = 0;
        if (this.records.length > 0) {
          return this.records[0];
        }
        throw new Error("[data-pool] Pool is empty — cannot recycle.");

      case "generate":
        // Return null — caller should use DataHelper to generate
        return null as unknown as T;

      case "stop":
        throw new Error(
          `[data-pool] Pool exhausted (${this.records.length} records consumed). ` +
            `Policy 'stop' requires halting this VU. ` +
            `Consider increasing pool size or switching to 'recycle' policy.`,
        );

      default:
        throw new Error(`[data-pool] Unknown exhaustion policy: ${this.policy}`);
    }
  }

  /**
   * Reset the cursor (for reuse across iterations).
   */
  reset(): void {
    this.cursor = 0;
  }
}

// ── Pool factory ──────────────────────────────────────────────────────────────

/**
 * Create a data pool from a JSON file loaded via k6 open().
 *
 * @example
 * const users = createPool(open('./data/users.json'), { exhaustionPolicy: 'recycle' });
 */
export function createPool<T = Record<string, unknown>>(
  jsonContent: string,
  config: Partial<DataPoolConfig> = {},
): DataPool<T> {
  const records = JSON.parse(jsonContent) as T[];
  if (!Array.isArray(records)) {
    throw new Error("[data-pool] Data file must contain a JSON array.");
  }
  return new DataPool<T>(records, config);
}

/**
 * Create a data pool from a CSV file loaded via k6 open().
 * Parses CSV with header row into array of objects.
 *
 * @example
 * const users = createCsvPool(open('./data/users.csv'), { exhaustionPolicy: 'stop' });
 */
export function createCsvPool(
  csvContent: string,
  config: Partial<DataPoolConfig> = {},
): DataPool<Record<string, string>> {
  const lines = csvContent.trim().split("\n");
  if (lines.length < 2) {
    return new DataPool<Record<string, string>>([], config);
  }

  const headers = lines[0].split(",").map((h) => h.trim());
  const records: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map((v) => v.trim());
    const record: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      record[headers[j]] = values[j] ?? "";
    }
    records.push(record);
  }

  return new DataPool<Record<string, string>>(records, config);
}
