#!/usr/bin/env node
// bin/load-redis-data.js — Standalone Redis data loader (Node.js, no k6 required)
//
// Loads CSV, JSON, and JSONL data files into Redis for use by k6 test scripts.
// Uses ioredis (Node.js) — works independently of k6 binary.
//
// Usage:
//   node bin/load-redis-data.js --users=./data/users.csv --products=./data/products.json
//   node bin/load-redis-data.js --users=./data/users.csv --clear --redis=redis://localhost:6379
//   node bin/load-redis-data.js --file=./data/tokens.json --prefix=token: --clear
//   node bin/load-redis-data.js --jsonl=./data/airline-orders/seed-orders-10M.jsonl --prefix=order: --key=orderId
//
// Options:
//   --users=<path>     Load users CSV with prefix "user:"
//   --products=<path>  Load products JSON with prefix "product:"
//   --file=<path>      Generic JSON array file with --prefix required
//   --jsonl=<path>     Load JSONL file (streaming, no OOM for large files) with --prefix required
//   --key=<field>      Field to use as Redis key suffix for --jsonl (default: orderId)
//   --prefix=<str>     Key prefix for --file/--jsonl (required when using --file or --jsonl)
//   --clear            Delete existing keys with the target prefixes before loading
//   --redis=<url>      Redis URL (default: REDIS_URL env var or redis://localhost:6379)
//   --ttl=<seconds>    Set TTL on loaded keys (default: no expiry)
//   --dry-run          Validate files without loading to Redis
//
// Exit codes: 0 = success, 1 = error
//
// Security: --redis URL with credentials is never logged in full (CHK-SEC-107).

"use strict";

const fs = require("fs");
const path = require("path");
const { createInterface } = require("readline");

// ── Argument parsing ──────────────────────────────────────────────────────────
const args = {};
for (const arg of process.argv.slice(2)) {
  if (arg === "--help" || arg === "-h") {
    args.help = true;
    continue;
  }
  if (arg.startsWith("--")) {
    const [key, ...rest] = arg.slice(2).split("=");
    args[key] = rest.length > 0 ? rest.join("=") : true;
  }
}

if (args.help) {
  require("./_help").printHelp({
    name: "load-redis-data",
    description: "Load CSV/JSON/JSONL data files into Redis for k6 test scripts (no k6 required)",
    usage:
      "node bin/load-redis-data.js (--users=<path> | --products=<path> | --file=<path> --prefix=<str> | --jsonl=<path> --prefix=<str>) [options]",
    flags: [
      { flag: "--users=<path>", description: 'Load users CSV with prefix "user:"' },
      { flag: "--products=<path>", description: 'Load products JSON with prefix "product:"' },
      { flag: "--file=<path>", description: "Generic JSON array file (requires --prefix)" },
      {
        flag: "--jsonl=<path>",
        description: "JSONL file streamed line-by-line (requires --prefix, no OOM)",
      },
      {
        flag: "--key=<field>",
        description: "Field used as Redis key suffix for --jsonl (default: orderId)",
      },
      {
        flag: "--prefix=<str>",
        description: "Key prefix for --file/--jsonl (required when using those)",
      },
      {
        flag: "--clear",
        description: "Delete existing keys with the target prefixes before loading",
      },
      {
        flag: "--redis=<url>",
        description: "Redis URL (default: REDIS_URL env or redis://localhost:6379)",
      },
      { flag: "--ttl=<seconds>", description: "Set TTL on loaded keys (default: no expiry)" },
      { flag: "--dry-run", description: "Validate files without loading to Redis" },
      { flag: "--help, -h", description: "Show this help and exit" },
    ],
    examples: [
      "node bin/load-redis-data.js --users=./data/users.csv --products=./data/products.json",
      "node bin/load-redis-data.js --jsonl=./data/orders.jsonl --prefix=order: --key=orderId --clear",
    ],
  });
  process.exit(0);
}

const REDIS_URL = args.redis || process.env.REDIS_URL || "redis://localhost:6379";
const CLEAR = args.clear === true || args.clear === "true";
const DRY_RUN = args["dry-run"] === true || args["dry-run"] === "true";
const TTL = args.ttl ? parseInt(args.ttl, 10) : null;

// Mask credentials for safe logging (CHK-SEC-107)
function maskUrl(url) {
  return url.replace(/(:\/\/)([^:@]+):([^@]+)@/, "$1***:***@");
}

const MASKED_URL = maskUrl(REDIS_URL);

// ── Validate required args ────────────────────────────────────────────────────
if (!args.users && !args.products && !args.file && !args.jsonl) {
  console.error("Error: At least one of --users, --products, --file, or --jsonl is required.");
  console.error("Usage: node bin/load-redis-data.js --users=<path> [--products=<path>] [--clear]");
  console.error("       node bin/load-redis-data.js --jsonl=<path> --prefix=<str> [--key=<field>]");
  process.exit(1);
}

if (args.file && !args.prefix) {
  console.error("Error: --prefix is required when using --file.");
  process.exit(1);
}

if (args.jsonl && !args.prefix) {
  console.error("Error: --prefix is required when using --jsonl.");
  process.exit(1);
}

// ── Load ioredis ──────────────────────────────────────────────────────────────
let Redis;
try {
  Redis = require("ioredis");
} catch {
  console.error("Error: ioredis is not installed.");
  console.error("Install it with: npm install ioredis");
  process.exit(1);
}

// ── Parsers ───────────────────────────────────────────────────────────────────

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCsv(content, filePath) {
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) {
    console.warn(`  Warning: ${filePath} has no data rows (only header or empty)`);
    return [];
  }
  const headers = parseCsvLine(lines[0]);
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    if (values.every((v) => v === "")) continue;
    const record = {};
    let hasData = false;
    for (let j = 0; j < headers.length; j++) {
      record[headers[j]] = values[j] ?? "";
      if (values[j]) hasData = true;
    }
    if (values.length > headers.length) {
      console.warn(`  Warning: ${filePath} row ${i + 1} has extra columns (ignored)`);
    }
    if (hasData) records.push(record);
  }
  return records;
}

function loadFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const ext = path.extname(filePath).toLowerCase();
  const content = fs.readFileSync(filePath, "utf-8");

  if (ext === ".csv") {
    return parseCsv(content, filePath);
  } else if (ext === ".json") {
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      throw new Error(`Invalid JSON in ${filePath}: ${e.message}`);
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`${filePath} must contain a JSON array, got ${typeof parsed}`);
    }
    return parsed.map((item) =>
      typeof item === "object" && item !== null
        ? Object.fromEntries(Object.entries(item).map(([k, v]) => [k, String(v)]))
        : { value: String(item) }
    );
  } else {
    throw new Error(`Unsupported file type: ${ext}. Use .csv or .json`);
  }
}

// ── Progress indicator ────────────────────────────────────────────────────────
function progressBar(current, total, width = 30) {
  const pct = Math.floor((current / total) * 100);
  const filled = Math.floor((current / total) * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  return `[${bar}] ${pct}% (${current}/${total})`;
}

// ── Main loader ───────────────────────────────────────────────────────────────
// CR-01: pipeline must be reset after every flush — ioredis pipelines do NOT
// clear their queue on exec(). Per-command-tuple error accounting is the
// canonical policy: pipeline.exec() resolves to [[err, result], ...] and
// per-command failures never throw. Reference: loadJsonlToRedis below.
const BATCH = 50;

async function loadToRedis(redis, records, prefix, ttl, label) {
  console.log(`\n  Loading ${records.length} ${label} records with prefix "${prefix}"...`);

  if (DRY_RUN) {
    console.log(`  [dry-run] Would load ${records.length} records — skipping Redis writes`);
    return { loaded: records.length, errors: 0 };
  }

  let loaded = 0;
  let errors = 0;
  let pipeline = redis.pipeline();
  let queued = 0;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const id = record.id ?? record.userId ?? record.productId ?? String(i);
    const key = `${prefix}${id}`;

    // Flatten object to string fields for hset
    const fields = Object.entries(record).flatMap(([k, v]) => [k, String(v)]);
    pipeline.hset(key, ...fields);
    if (ttl && ttl > 0) pipeline.expire(key, ttl);
    queued++;

    const isLast = i === records.length - 1;
    if (queued >= BATCH || isLast) {
      // Snapshot the count of HSET commands queued in this flush. expire()
      // calls are appended after each hset() and count as additional commands
      // in the exec() result, but error/success accounting is keyed off the
      // HSET tuples — exec() returns one tuple per queued command total, so
      // we count results conservatively against the number of HSET commands
      // we intended to write in this flush.
      const hsetsInFlush = queued;
      try {
        const results = await pipeline.exec();
        // results is Array<[Error|null, unknown]>. Per-command-tuple policy:
        // when ttl is set we queued (hset + expire) per record, so the result
        // array length is hsetsInFlush * 2. Each HSET tuple is at even index.
        const hasTtl = ttl && ttl > 0;
        let batchErrors = 0;
        if (Array.isArray(results)) {
          // Treat any non-null first-element tuple as an error against the
          // corresponding record (HSET position). The expire tuples (odd
          // indices when ttl is set) are inspected the same way — a failure
          // on either of the pair counts the record as errored exactly once.
          const stride = hasTtl ? 2 : 1;
          for (let j = 0; j < hsetsInFlush; j++) {
            const hsetTuple = results[j * stride];
            const expireTuple = hasTtl ? results[j * stride + 1] : null;
            const hsetErr = Array.isArray(hsetTuple) ? hsetTuple[0] : null;
            const expireErr = hasTtl && Array.isArray(expireTuple) ? expireTuple[0] : null;
            if (hsetErr != null || expireErr != null) {
              batchErrors++;
            }
          }
        }
        errors += batchErrors;
        loaded += hsetsInFlush - batchErrors;
      } catch (e) {
        // Transport-level failure — count every queued record in this flush
        // as an error and continue with the next batch.
        console.error(`\n  Pipeline transport error at batch ending record ${i + 1}: ${e.message}`);
        errors += hsetsInFlush;
      }
      // Reset only if more records remain — avoids creating an unused
      // empty pipeline after the final flush.
      if (!isLast) {
        pipeline = redis.pipeline(); // reset every flush — CR-01 core fix
      }
      queued = 0;

      // Progress bar for large datasets (>100 records)
      if (records.length > 100) {
        process.stdout.write(`\r  ${progressBar(i + 1, records.length)}`);
      }
    }
  }

  if (records.length > 100) process.stdout.write("\n");
  return { loaded, errors };
}

// ── JSONL streaming loader ───────────────────────────────────────────────────
async function loadJsonlToRedis(redis, filePath, prefix, keyField, ttl) {
  const PIPELINE_BATCH = 500;
  const PROGRESS_EVERY = 100_000;

  console.log(`\n  Loading JSONL (streaming): ${filePath}`);
  console.log(`  Prefix: "${prefix}" | Key field: "${keyField}"`);

  if (DRY_RUN) {
    // Count lines for dry-run validation
    let lineCount = 0;
    const rl = createInterface({
      input: fs.createReadStream(filePath, "utf-8"),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (line.trim()) lineCount++;
    }
    console.log(
      `  [dry-run] Would load ${lineCount.toLocaleString()} records — skipping Redis writes`
    );
    return { loaded: lineCount, errors: 0 };
  }

  let loaded = 0;
  let errors = 0;
  let lineNum = 0;
  let pipeline = redis.pipeline();
  let pipelineCount = 0;
  const startMs = Date.now();

  const rl = createInterface({
    input: fs.createReadStream(filePath, "utf-8"),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    lineNum++;

    let record;
    try {
      record = JSON.parse(line);
    } catch (e) {
      if (errors < 5) console.error(`\n  Parse error line ${lineNum}: ${e.message}`);
      errors++;
      continue;
    }

    const id = record[keyField] ?? String(lineNum);
    const key = `${prefix}${id}`;

    // Flatten nested objects for hset — stringify non-string values
    const fields = Object.entries(record).flatMap(([k, v]) => {
      if (typeof v === "object" && v !== null) return [k, JSON.stringify(v)];
      return [k, String(v)];
    });
    pipeline.hset(key, ...fields);
    if (ttl && ttl > 0) pipeline.expire(key, ttl);
    pipelineCount++;

    if (pipelineCount >= PIPELINE_BATCH) {
      try {
        await pipeline.exec();
        loaded += pipelineCount;
      } catch (e) {
        if (errors < 5) console.error(`\n  Pipeline error at line ${lineNum}: ${e.message}`);
        errors++;
      }
      pipeline = redis.pipeline();
      pipelineCount = 0;
    }

    if (lineNum % PROGRESS_EVERY === 0) {
      const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
      const rps = Math.floor(lineNum / ((Date.now() - startMs) / 1000));
      process.stdout.write(
        `\r  Loaded: ${lineNum.toLocaleString()} records | ${elapsed}s | ${rps.toLocaleString()} rec/s`
      );
    }
  }

  // Flush remaining
  if (pipelineCount > 0) {
    try {
      await pipeline.exec();
      loaded += pipelineCount;
    } catch (e) {
      console.error(`\n  Pipeline error (final flush): ${e.message}`);
      errors++;
    }
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  process.stdout.write(
    `\r  Loaded: ${loaded.toLocaleString()} records | ${elapsed}s                    \n`
  );

  return { loaded, errors };
}

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  k6 Framework — Redis Data Loader");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Redis: ${MASKED_URL}`);
  if (DRY_RUN) console.log("  Mode:  DRY RUN (no writes)");
  if (TTL) console.log(`  TTL:   ${TTL}s per key`);
  console.log("");

  // ── Validate all input files first ─────────────────────────────────────────
  const loads = [];

  if (args.users) {
    console.log(`  Validating: ${args.users}`);
    const records = loadFile(args.users);
    console.log(`  ✓ Users: ${records.length} records found`);
    loads.push({ records, prefix: "user:", label: "user" });
  }

  if (args.products) {
    console.log(`  Validating: ${args.products}`);
    const records = loadFile(args.products);
    console.log(`  ✓ Products: ${records.length} records found`);
    loads.push({ records, prefix: "product:", label: "product" });
  }

  if (args.file) {
    console.log(`  Validating: ${args.file}`);
    const records = loadFile(args.file);
    const prefix = args.prefix.endsWith(":") ? args.prefix : args.prefix + ":";
    console.log(`  ✓ ${path.basename(args.file)}: ${records.length} records found`);
    loads.push({ records, prefix, label: path.basename(args.file, path.extname(args.file)) });
  }

  // JSONL files are handled separately (streaming, not loaded into memory)
  let jsonlLoad = null;
  if (args.jsonl) {
    const jsonlPath = path.resolve(args.jsonl);
    if (!fs.existsSync(jsonlPath)) {
      console.error(`  Error: JSONL file not found: ${jsonlPath}`);
      process.exit(1);
    }
    const prefix = args.prefix.endsWith(":") ? args.prefix : args.prefix + ":";
    const keyField = args.key || "orderId";
    console.log(`  ✓ JSONL: ${path.basename(jsonlPath)} (streaming mode)`);
    jsonlLoad = { filePath: jsonlPath, prefix, keyField };
  }

  if (loads.length === 0 && !jsonlLoad) {
    console.log("  No valid files to load. Exiting.");
    process.exit(0);
  }

  if (DRY_RUN) {
    if (jsonlLoad) {
      // Count JSONL lines for validation
      const { loaded } = await loadJsonlToRedis(
        null,
        jsonlLoad.filePath,
        jsonlLoad.prefix,
        jsonlLoad.keyField,
        null
      );
      console.log(`  [dry-run] JSONL: ${loaded.toLocaleString()} records found`);
    }
    console.log("\n  [dry-run] Validation complete. All files are valid.");
    process.exit(0);
  }

  // ── Connect to Redis ────────────────────────────────────────────────────────
  const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    connectTimeout: 10_000,
    lazyConnect: false,
  });

  redis.on("error", (err) => {
    console.error(`\nRedis error: ${err.message}`);
  });

  try {
    await redis.ping();
    console.log("\n  ✓ Redis connection established");
  } catch (e) {
    console.error(`\nError: Cannot connect to Redis at ${MASKED_URL}`);
    console.error(`  ${e.message}`);
    console.error(
      "\nCheck that Redis is running. For Docker: docker compose --profile redis up -d"
    );
    await redis.quit();
    process.exit(1);
  }

  // ── Clear existing data ─────────────────────────────────────────────────────
  if (CLEAR) {
    console.log("\n  Clearing existing keys...");
    const prefixesToClear = loads.map((l) => l.prefix);
    if (jsonlLoad) prefixesToClear.push(jsonlLoad.prefix);
    for (const prefix of prefixesToClear) {
      let cursor = 0;
      let deleted = 0;
      do {
        const [nextCursor, keys] = await redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 100);
        cursor = parseInt(nextCursor, 10);
        if (keys.length > 0) {
          await redis.del(...keys);
          deleted += keys.length;
        }
      } while (cursor !== 0);
      console.log(`  ✓ Cleared ${deleted} keys with prefix "${prefix}"`);
    }
  }

  // ── Load data ───────────────────────────────────────────────────────────────
  let totalLoaded = 0;
  let totalErrors = 0;

  for (const { records, prefix, label } of loads) {
    const { loaded, errors } = await loadToRedis(redis, records, prefix, TTL, label);
    totalLoaded += loaded;
    totalErrors += errors;
    console.log(`  ✓ Loaded ${loaded} ${label} records${errors > 0 ? ` (${errors} errors)` : ""}`);
  }

  // ── Load JSONL data (streaming) ─────────────────────────────────────────────
  if (jsonlLoad) {
    const { loaded, errors } = await loadJsonlToRedis(
      redis,
      jsonlLoad.filePath,
      jsonlLoad.prefix,
      jsonlLoad.keyField,
      TTL
    );
    totalLoaded += loaded;
    totalErrors += errors;
    console.log(
      `  ✓ Loaded ${loaded.toLocaleString()} JSONL records${errors > 0 ? ` (${errors} errors)` : ""}`
    );
  }

  await redis.quit();

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Total loaded: ${totalLoaded} keys`);
  if (totalErrors > 0) {
    console.log(`  Errors:       ${totalErrors} batches failed`);
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  process.exit(totalErrors > 0 ? 1 : 0);
}

// CR-01: guard the CLI entry point so the script can be required from tests
// without triggering main()/process.exit side effects. Export the pure
// loader for direct unit testing.
module.exports = { loadToRedis, BATCH };

if (require.main === module) {
  main().catch((err) => {
    console.error(`\nFatal error: ${err.message}`);
    process.exit(1);
  });
}
