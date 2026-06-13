#!/usr/bin/env node
// bin/clean-redis-data.js — Standalone Redis data cleanup (Node.js, no k6 required)
//
// Deletes Redis keys by prefix pattern for test data cleanup.
// Uses ioredis (Node.js) and SCAN + DEL (safe, no KEYS command in production).
//
// Usage:
//   node bin/clean-redis-data.js --pattern="user:*"
//   node bin/clean-redis-data.js --all
//   node bin/clean-redis-data.js --pattern="product:*" --redis=redis://localhost:6379
//   node bin/clean-redis-data.js --pattern="user:*" --dry-run
//
// Options:
//   --pattern=<glob>   Delete keys matching this pattern (e.g. "user:*")
//   --all              Delete all framework-managed keys (user:, product:, rate:, stats:, token:, config:)
//   --redis=<url>      Redis URL (default: REDIS_URL env var or redis://localhost:6379)
//   --dry-run          Show what would be deleted without actually deleting
//   --yes              Skip confirmation prompt (for CI/CD use)
//
// Exit codes: 0 = success, 1 = error
//
// Security: --redis URL with credentials is never logged in full (CHK-SEC-107).

"use strict";

const { createInterface } = require("readline");

// ── Framework-managed key prefixes ────────────────────────────────────────────
const FRAMEWORK_PREFIXES = ["user:", "product:", "rate:", "stats:", "token:", "config:"];

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
    name: "clean-redis-data",
    description: "Delete Redis keys by prefix/pattern for test data cleanup (no k6 required)",
    usage: "node bin/clean-redis-data.js (--pattern=<glob> | --all) [options]",
    flags: [
      {
        flag: "--pattern=<glob>",
        description: 'Delete keys matching this pattern (e.g. "user:*")',
      },
      {
        flag: "--all",
        description:
          "Delete all framework-managed prefixes (user:, product:, rate:, stats:, token:, config:)",
      },
      {
        flag: "--redis=<url>",
        description: "Redis URL (default: REDIS_URL env or redis://localhost:6379)",
      },
      { flag: "--dry-run", description: "Show what would be deleted without deleting" },
      { flag: "--yes", description: "Skip confirmation prompt (also implied when CI=true)" },
      { flag: "--help, -h", description: "Show this help and exit" },
    ],
    examples: [
      'node bin/clean-redis-data.js --pattern="user:*" --dry-run',
      "node bin/clean-redis-data.js --all --yes --redis=redis://localhost:6379",
    ],
  });
  process.exit(0);
}

const REDIS_URL = args.redis || process.env.REDIS_URL || "redis://localhost:6379";
const DRY_RUN = args["dry-run"] === true || args["dry-run"] === "true";
const SKIP_CONFIRM = args.yes === true || args.yes === "true" || process.env.CI === "true";
const ALL = args.all === true || args.all === "true";

// Mask credentials for safe logging (CHK-SEC-107)
function maskUrl(url) {
  return url.replace(/(:\/\/)([^:@]+):([^@]+)@/, "$1***:***@");
}

const MASKED_URL = maskUrl(REDIS_URL);

// ── Validate args ─────────────────────────────────────────────────────────────
if (!args.pattern && !ALL) {
  console.error("Error: --pattern=<glob> or --all is required.");
  console.error('Usage: node bin/clean-redis-data.js --pattern="user:*"');
  console.error("       node bin/clean-redis-data.js --all");
  process.exit(1);
}

// Determine patterns to clean
const patterns = ALL ? FRAMEWORK_PREFIXES.map((p) => `${p}*`) : [args.pattern];

// ── Load ioredis ──────────────────────────────────────────────────────────────
let Redis;
try {
  Redis = require("ioredis");
} catch {
  console.error("Error: ioredis is not installed.");
  console.error("Install it with: npm install ioredis");
  process.exit(1);
}

// ── SCAN + DEL (safe for production) ─────────────────────────────────────────
async function scanAndDelete(redis, pattern, dryRun) {
  let cursor = 0;
  let totalDeleted = 0;
  let totalFound = 0;

  do {
    const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
    cursor = parseInt(nextCursor, 10);
    totalFound += keys.length;

    if (keys.length > 0) {
      if (!dryRun) {
        await redis.del(...keys);
        totalDeleted += keys.length;
      } else {
        // Show first 5 keys in dry-run mode
        const preview = keys.slice(0, 5);
        process.stdout.write(
          `\r  [dry-run] Found ${totalFound} keys (preview: ${preview.join(", ")}${keys.length > 5 ? "..." : ""})`
        );
      }

      if (!dryRun) {
        process.stdout.write(`\r  Deleted ${totalDeleted} keys...`);
      }
    }
  } while (cursor !== 0);

  if (totalFound > 0) process.stdout.write("\n");
  return { found: totalFound, deleted: dryRun ? 0 : totalDeleted };
}

// ── Confirmation prompt ───────────────────────────────────────────────────────
function askConfirmation(message) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  k6 Framework — Redis Data Cleanup");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Redis:    ${MASKED_URL}`);
  console.log(`  Patterns: ${patterns.join(", ")}`);
  if (DRY_RUN) console.log("  Mode:     DRY RUN (no deletes)");
  console.log("");

  // ── Connect ─────────────────────────────────────────────────────────────────
  const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    connectTimeout: 10_000,
    lazyConnect: false,
  });

  redis.on("error", (err) => {
    if (err.code !== "ECONNREFUSED") {
      console.error(`Redis error: ${err.message}`);
    }
  });

  try {
    await redis.ping();
    console.log("  ✓ Redis connection established\n");
  } catch (e) {
    console.error(`Error: Cannot connect to Redis at ${MASKED_URL}`);
    console.error(`  ${e.message}`);
    await redis.quit();
    process.exit(1);
  }

  // ── Pre-scan to count keys ──────────────────────────────────────────────────
  console.log("  Scanning keys...");
  let totalKeysFound = 0;
  const patternCounts = {};

  for (const pattern of patterns) {
    let cursor = 0;
    let count = 0;
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = parseInt(nextCursor, 10);
      count += keys.length;
    } while (cursor !== 0);
    patternCounts[pattern] = count;
    totalKeysFound += count;
    console.log(`  Pattern "${pattern}": ${count} keys found`);
  }

  if (totalKeysFound === 0) {
    console.log("\n  No keys found matching the specified patterns. Nothing to clean.");
    await redis.quit();
    process.exit(0);
  }

  // ── Confirmation ─────────────────────────────────────────────────────────────
  if (!DRY_RUN && !SKIP_CONFIRM) {
    console.log(`\n  ⚠️  About to delete ${totalKeysFound} keys from ${MASKED_URL}`);
    const confirmed = await askConfirmation(
      `  Are you sure you want to delete ${totalKeysFound} keys?`
    );
    if (!confirmed) {
      console.log("\n  Cancelled. No keys were deleted.");
      await redis.quit();
      process.exit(0);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────────
  console.log(DRY_RUN ? "\n  [dry-run] Simulating deletion..." : "\n  Deleting keys...");

  let grandTotalDeleted = 0;
  for (const pattern of patterns) {
    if (patternCounts[pattern] === 0) continue;
    process.stdout.write(`  ${pattern}: `);
    const { found, deleted } = await scanAndDelete(redis, pattern, DRY_RUN);
    if (DRY_RUN) {
      console.log(`  [dry-run] Would delete ${found} keys matching "${pattern}"`);
    } else {
      grandTotalDeleted += deleted;
      console.log(`  ✓ Deleted ${deleted} keys matching "${pattern}"`);
    }
  }

  await redis.quit();

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  if (DRY_RUN) {
    console.log(`  [dry-run] Would delete: ${totalKeysFound} keys`);
    console.log("  Run without --dry-run to execute deletion.");
  } else {
    console.log(`  Total deleted: ${grandTotalDeleted} keys`);
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  process.exit(0);
}

main().catch((err) => {
  console.error(`\nFatal error: ${err.message}`);
  process.exit(1);
});
