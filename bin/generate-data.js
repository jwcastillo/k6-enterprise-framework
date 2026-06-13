#!/usr/bin/env node
/**
 * T-061: generate-data.js — Standalone test data generator
 *
 * Generates realistic test datasets outside k6 context.
 * Uses streaming for large datasets to avoid OOM.
 *
 * Usage:
 *   node bin/generate-data.js --type=users --count=1000 --format=csv --output=./data/
 *   node bin/generate-data.js --type=products --count=500 --format=json --output=./data/
 *   node bin/generate-data.js --help
 */

"use strict";

const fs = require("fs");
const path = require("path");

// ── Argument parsing ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const opts = { type: null, count: 100, format: "csv", output: ".", help: false };

for (let i = 0; i < args.length; i++) {
  const [key, val] = args[i].split("=");
  switch (key) {
    case "--type":
      opts.type = val ?? args[++i];
      break;
    case "--count":
      opts.count = parseInt(val ?? args[++i], 10);
      break;
    case "--format":
      opts.format = val ?? args[++i];
      break;
    case "--output":
      opts.output = val ?? args[++i];
      break;
    case "--help":
    case "-h":
      opts.help = true;
      break;
  }
}

if (opts.help || !opts.type) {
  require("./_help").printHelp({
    name: "generate-data",
    description: "Generate realistic test datasets outside k6 context (T-061)",
    usage: "node bin/generate-data.js --type=<type> [options]",
    flags: [
      { flag: "--type=<t>", description: "Data type: users, products, transactions (required)" },
      {
        flag: "--count=<n>",
        description: "Number of records to generate (default: 100; streams when >10000)",
      },
      { flag: "--format=<f>", description: "Output format: csv or json (default: csv)" },
      { flag: "--output=<dir>", description: "Output directory (default: current directory)" },
      { flag: "--help, -h", description: "Show this help and exit" },
    ],
    examples: [
      "node bin/generate-data.js --type=users --count=1000 --format=csv --output=./data/",
      "node bin/generate-data.js --type=transactions --count=50000 --format=csv --output=./data/",
    ],
  });
  process.exit(opts.help ? 0 : 1);
}

const VALID_TYPES = ["users", "products", "transactions"];
const VALID_FORMATS = ["csv", "json"];

if (!VALID_TYPES.includes(opts.type)) {
  console.error(`Error: --type must be one of: ${VALID_TYPES.join(", ")}`);
  process.exit(1);
}
if (!VALID_FORMATS.includes(opts.format)) {
  console.error(`Error: --format must be one of: ${VALID_FORMATS.join(", ")}`);
  process.exit(1);
}
if (isNaN(opts.count) || opts.count < 1) {
  console.error("Error: --count must be a positive integer");
  process.exit(1);
}

// ── Generators ────────────────────────────────────────────────────────────────

const FIRST_NAMES = [
  "Alice",
  "Bob",
  "Carol",
  "David",
  "Emma",
  "Frank",
  "Grace",
  "Hector",
  "Iris",
  "Jack",
  "Karen",
  "Leo",
  "Maria",
  "Nick",
  "Olivia",
  "Paul",
  "Quinn",
  "Rachel",
  "Sam",
  "Tara",
];
const LAST_NAMES = [
  "Smith",
  "Jones",
  "Garcia",
  "Brown",
  "Wilson",
  "Davis",
  "Miller",
  "Anderson",
  "Taylor",
  "Thomas",
];
const CATEGORIES = [
  "Electronics",
  "Clothing",
  "Food",
  "Sports",
  "Books",
  "Home",
  "Toys",
  "Beauty",
  "Auto",
  "Garden",
];
const DOMAINS = ["gmail.com", "yahoo.com", "hotmail.com", "company.io", "example.com"];

let _counter = 1;

function uid() {
  return String(_counter++).padStart(8, "0");
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function rand(min, max) {
  return min + Math.random() * (max - min);
}
function isoDate(daysAgo) {
  const d = new Date(Date.now() - daysAgo * 86400000);
  return d.toISOString().slice(0, 10);
}

function generateUser(i) {
  const first = pick(FIRST_NAMES);
  const last = pick(LAST_NAMES);
  return {
    id: uid(),
    first_name: first,
    last_name: last,
    email: `${first.toLowerCase()}.${last.toLowerCase()}${i}@${pick(DOMAINS)}`,
    username: `${first.toLowerCase()}${i}`,
    created_at: isoDate(Math.floor(rand(0, 365))),
  };
}

function generateProduct(i) {
  const category = pick(CATEGORIES);
  return {
    id: uid(),
    name: `${category} Item ${i}`,
    category,
    price: rand(0.99, 999.99).toFixed(2),
    stock: Math.floor(rand(0, 1000)),
    sku: `SKU-${uid()}`,
    created_at: isoDate(Math.floor(rand(0, 365))),
  };
}

function generateTransaction(i) {
  return {
    id: uid(),
    user_id: uid(),
    product_id: uid(),
    amount: rand(0.99, 499.99).toFixed(2),
    currency: "USD",
    status: pick(["completed", "pending", "failed", "refunded"]),
    date: isoDate(Math.floor(rand(0, 90))),
  };
}

const GENERATORS = {
  users: {
    fn: generateUser,
    headers: ["id", "first_name", "last_name", "email", "username", "created_at"],
  },
  products: {
    fn: generateProduct,
    headers: ["id", "name", "category", "price", "stock", "sku", "created_at"],
  },
  transactions: {
    fn: generateTransaction,
    headers: ["id", "user_id", "product_id", "amount", "currency", "status", "date"],
  },
};

// ── Output helpers ────────────────────────────────────────────────────────────

function toCSVRow(obj, headers) {
  return headers
    .map((h) => {
      const v = String(obj[h] ?? "");
      return v.includes(",") ? `"${v}"` : v;
    })
    .join(",");
}

// ── Main (streaming for large datasets) ───────────────────────────────────────

async function main() {
  const { fn, headers } = GENERATORS[opts.type];
  const outDir = path.resolve(opts.output);
  const ext = opts.format;
  const outFile = path.join(outDir, `${opts.type}.${ext}`);
  const STREAM_THRESHOLD = 10_000;

  fs.mkdirSync(outDir, { recursive: true });

  console.log(
    `Generating ${opts.count.toLocaleString()} ${opts.type} (${opts.format.toUpperCase()})...`
  );

  const startMs = Date.now();
  const progressEvery = Math.max(1, Math.floor(opts.count / 10));
  let lastProgressMs = Date.now();
  const PROGRESS_INTERVAL_MS = 10_000;

  if (opts.count <= STREAM_THRESHOLD) {
    // In-memory for small datasets
    const records = Array.from({ length: opts.count }, (_, i) => fn(i + 1));
    if (opts.format === "csv") {
      const lines = [headers.join(","), ...records.map((r) => toCSVRow(r, headers))];
      fs.writeFileSync(outFile, lines.join("\n") + "\n");
    } else {
      fs.writeFileSync(outFile, JSON.stringify(records, null, 2));
    }
  } else {
    // Streaming for large datasets
    const stream = fs.createWriteStream(outFile, { encoding: "utf-8" });
    if (opts.format === "csv") {
      stream.write(headers.join(",") + "\n");
      for (let i = 0; i < opts.count; i++) {
        stream.write(toCSVRow(fn(i + 1), headers) + "\n");
        const now = Date.now();
        if ((i + 1) % progressEvery === 0 || now - lastProgressMs > PROGRESS_INTERVAL_MS) {
          const pct = (((i + 1) / opts.count) * 100).toFixed(0);
          process.stdout.write(
            `\r  Progress: ${(i + 1).toLocaleString()} / ${opts.count.toLocaleString()} (${pct}%)`
          );
          lastProgressMs = now;
        }
        // Yield to event loop periodically to avoid blocking
        if ((i + 1) % 5000 === 0) await new Promise((r) => setImmediate(r));
      }
    } else {
      stream.write("[\n");
      for (let i = 0; i < opts.count; i++) {
        const comma = i < opts.count - 1 ? "," : "";
        stream.write(JSON.stringify(fn(i + 1)) + comma + "\n");
        if ((i + 1) % progressEvery === 0) {
          const pct = (((i + 1) / opts.count) * 100).toFixed(0);
          process.stdout.write(
            `\r  Progress: ${(i + 1).toLocaleString()} / ${opts.count.toLocaleString()} (${pct}%)`
          );
        }
        if ((i + 1) % 5000 === 0) await new Promise((r) => setImmediate(r));
      }
      stream.write("]\n");
    }
    await new Promise((resolve, reject) => stream.end((err) => (err ? reject(err) : resolve())));
    process.stdout.write("\n");
  }

  const stat = fs.statSync(outFile);
  const sizeKB = (stat.size / 1024).toFixed(1);
  const elapsedS = ((Date.now() - startMs) / 1000).toFixed(1);

  console.log(`\n✓ Generated: ${outFile}`);
  console.log(`  Records : ${opts.count.toLocaleString()}`);
  console.log(`  Size    : ${sizeKB} KB`);
  console.log(`  Time    : ${elapsedS}s`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
